import type { FastifyInstance } from "fastify";
import type { KeycloakAuthService } from "../auth/keycloak.js";
import type { AppPrisma } from "../../../infra/prisma.js";
import { requirePermission } from "../rbac/authorize.js";
import { updateProfileSchema } from "./schemas.js";
import { getProfile, updateProfile } from "./service.js";
export async function registerProfileRoutes(app: FastifyInstance, prisma: AppPrisma, keycloakAuth: KeycloakAuthService): Promise<void> {
  app.get("/profile", { preHandler: [app.authenticate, requirePermission("profile.read.self")] }, async (request) => getProfile(prisma, request.user.id));
  app.put("/profile", { preHandler: [app.authenticate, requirePermission("profile.update.self")] }, async (request) => updateProfile(prisma, keycloakAuth, request.user, updateProfileSchema.parse(request.body)));
}
