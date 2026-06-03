import type { FastifyInstance } from "fastify";
import type { AppPrisma } from "../../../infra/prisma.js";
import { requirePermission } from "../../identity/rbac/authorize.js";
import { dashboardPreferenceBodySchema, dashboardQuerySchema } from "./schemas.js";
import { getDashboard, getDashboardPreferences, updateDashboardPreferences } from "./service.js";

export async function registerDashboardRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.get("/dashboard/preferences", { preHandler: [app.authenticate, requirePermission("dashboard.read.self")] }, async (request) => {
    return getDashboardPreferences(prisma, request.user.id);
  });

  app.put("/dashboard/preferences", { preHandler: [app.authenticate, requirePermission("dashboard.update.self")] }, async (request) => {
    const body = dashboardPreferenceBodySchema.parse(request.body);
    return updateDashboardPreferences(prisma, request.user.id, body.widgets);
  });

  app.get("/dashboard", { preHandler: [app.authenticate, requirePermission("dashboard.read.self")] }, async (request) => {
    const query = dashboardQuerySchema.parse(request.query);
    return getDashboard(prisma, request.user.id, query.range, query.widgets);
  });
}
