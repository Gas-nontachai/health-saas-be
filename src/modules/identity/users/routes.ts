import type { FastifyInstance } from "fastify";
import type { AppPrisma } from "../../../infra/prisma.js";
import { requirePermission } from "../rbac/authorize.js";
import { updateProfileSchema } from "./schemas.js";
import { getProfile, updateProfile } from "./service.js";
export async function registerProfileRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.get("/profile", { preHandler: [app.authenticate, requirePermission("profile.read.self")] }, async (request) => getProfile(prisma, request.user.id));
  app.put("/profile", { preHandler: [app.authenticate, requirePermission("profile.update.self")] }, async (request) => updateProfile(prisma, request.user, updateProfileSchema.parse(request.body)));
}
