import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppPrisma } from "../prisma.js";

const updateProfileSchema = z
  .object({
    weight: z.number().positive().optional().nullable(),
    height: z.number().positive().optional().nullable()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required"
  });

export async function registerProfileRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.get("/profile", { preHandler: app.authenticate }, async (request) => {
    return prisma.profile.upsert({
      where: { userId: request.user.id },
      update: {},
      create: { userId: request.user.id }
    });
  });

  app.put("/profile", { preHandler: app.authenticate }, async (request) => {
    const body = updateProfileSchema.parse(request.body);
    return prisma.profile.upsert({
      where: { userId: request.user.id },
      update: body,
      create: {
        userId: request.user.id,
        weight: body.weight,
        height: body.height
      }
    });
  });
}
