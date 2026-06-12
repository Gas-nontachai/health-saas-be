import type { FastifyInstance } from "fastify";
import type { AppPrisma } from "../../../infra/prisma.js";
import { requirePermission } from "../../identity/rbac/authorize.js";
import { exportQuerySchema } from "./schemas.js";
import { buildLegacyBloodSugarExport, legacyBloodSugarExportHeaders } from "./service.js";

export async function registerExportRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.get("/export", { preHandler: [app.authenticate, requirePermission("export.read.self")] }, async (request, reply) => {
    const { type } = exportQuerySchema.parse(request.query);
    const { buffer, filename } = await buildLegacyBloodSugarExport(prisma, request.user, type);
    const headers = legacyBloodSugarExportHeaders(type, filename);
    reply.header("content-type", headers.contentType).header("content-disposition", headers.disposition);
    return buffer;
  });
}
