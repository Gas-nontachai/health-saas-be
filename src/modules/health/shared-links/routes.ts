import type { FastifyInstance } from "fastify";
import type { AppPrisma } from "../../../infra/prisma.js";
import { requirePermission } from "../../identity/rbac/authorize.js";
import { createSharedLinkSchema, idParamsSchema, publicTokenParamsSchema } from "./schemas.js";
import { createUserSharedLink, getPublicSharedLinkPayload, listUserSharedLinks, revokeUserSharedLink } from "./service.js";

export async function registerSharedLinkRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.post("/shared-links", { preHandler: [app.authenticate, requirePermission("sharedLinks.create.self")] }, async (request, reply) => { const response = await createUserSharedLink(prisma, request.user.id, createSharedLinkSchema.parse(request.body)); reply.status(201); return response; });
  app.get("/shared-links", { preHandler: [app.authenticate, requirePermission("sharedLinks.read.self")] }, async (request) => listUserSharedLinks(prisma, request.user.id));
  app.post("/shared-links/:id/revoke", { preHandler: [app.authenticate, requirePermission("sharedLinks.revoke.self")] }, async (request) => { const params = idParamsSchema.parse(request.params); return revokeUserSharedLink(prisma, request.user.id, params.id); });
  app.get("/public/shared-links/:token", async (request) => { const params = publicTokenParamsSchema.parse(request.params); return getPublicSharedLinkPayload(prisma, params.token); });
}
