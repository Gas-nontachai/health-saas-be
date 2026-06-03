import type { FastifyInstance } from "fastify";
import type { AppPrisma } from "../../../infra/prisma.js";
import { composePreHandlers, requirePermission } from "../../identity/rbac/authorize.js";
import { exportQuerySchema, healthDashboardPreferenceBodySchema, healthDashboardQuerySchema } from "./schemas.js";
import { buildHealthExport, exportContentType, getHealthDashboard, getHealthDashboardPreferences, updateHealthDashboardPreferences } from "./service.js";

export async function registerHealthRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.get("/health/dashboard", { preHandler: [app.authenticate, requirePermission("dashboard.read.self")] }, async (request) => { const query = healthDashboardQuerySchema.parse(request.query); return getHealthDashboard(prisma, request.user.id, query.range, query.dataTypes, query.widgets); });
  app.get("/health/dashboard/preferences", { preHandler: [app.authenticate, requirePermission("dashboard.read.self")] }, async (request) => getHealthDashboardPreferences(prisma, request.user.id));
  app.put("/health/dashboard/preferences", { preHandler: [app.authenticate, requirePermission("dashboard.update.self")] }, async (request) => updateHealthDashboardPreferences(prisma, request.user.id, healthDashboardPreferenceBodySchema.parse(request.body)));
  app.get("/health/export", { preHandler: composePreHandlers(app.authenticate, requirePermission("export.read.self")) }, async (request, reply) => { const query = exportQuerySchema.parse(request.query); const { buffer, filename } = await buildHealthExport(prisma, request.user, query); reply.header("content-type", exportContentType(query.type)).header("content-disposition", `attachment; filename="${filename}"`); return buffer; });
}
