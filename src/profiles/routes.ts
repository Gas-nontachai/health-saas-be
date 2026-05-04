import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { KeycloakAuthService } from "../auth/keycloak.js";
import type { AppPrisma } from "../prisma.js";

const updateProfileSchema = z
  .object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    email: z.string().email().optional(),
    weight: z.number().positive().optional().nullable(),
    height: z.number().positive().optional().nullable()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required"
  });

export async function registerProfileRoutes(app: FastifyInstance, prisma: AppPrisma, keycloakAuth: KeycloakAuthService): Promise<void> {
  app.get("/profile", { preHandler: app.authenticate }, async (request) => {
    const [user, profile] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: request.user.id }, select: { email: true, name: true } }),
      prisma.profile.upsert({ where: { userId: request.user.id }, update: {}, create: { userId: request.user.id } })
    ]);
    return { ...profile, email: user.email, name: user.name };
  });

  app.put("/profile", { preHandler: app.authenticate }, async (request) => {
    const body = updateProfileSchema.parse(request.body);
    const { firstName, lastName, email, ...profileData } = body;

    // Update Keycloak if name or email changed
    if (firstName !== undefined || lastName !== undefined || email !== undefined) {
      await keycloakAuth.updateUser({
        keycloakId: request.user.keycloakId,
        firstName,
        lastName,
        email
      });

      // Sync to local DB
      const updateData: { email?: string; name?: string } = {};
      if (email !== undefined) updateData.email = email;
      if (firstName !== undefined || lastName !== undefined) {
        const currentUser = await prisma.user.findUniqueOrThrow({ where: { id: request.user.id }, select: { name: true } });
        const [currentFirst, ...rest] = (currentUser.name ?? "").split(" ");
        updateData.name = `${firstName ?? currentFirst} ${lastName ?? rest.join(" ")}`.trim();
      }
      if (Object.keys(updateData).length > 0) {
        await prisma.user.update({ where: { id: request.user.id }, data: updateData });
      }
    }

    // Update profile (weight/height)
    const profile = await prisma.profile.upsert({
      where: { userId: request.user.id },
      update: profileData,
      create: { userId: request.user.id, weight: profileData.weight, height: profileData.height }
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user.id }, select: { email: true, name: true } });
    return { ...profile, email: user.email, name: user.name };
  });
}
