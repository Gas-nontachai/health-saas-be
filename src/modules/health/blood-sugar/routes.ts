import type { FastifyInstance } from "fastify";
import type { AppPrisma } from "../../../infra/prisma.js";
import { requirePermission } from "../../identity/rbac/authorize.js";
import { createRecordSchema, dashboardQuerySchema, exportQuerySchema, idParamsSchema, paginationSchema, updateRecordSchema } from "./schemas.js";
import { buildLegacyBloodSugarExport, legacyBloodSugarExportHeaders } from "../export/service.js";
import { createUserBloodSugarRecord, deleteUserBloodSugarRecord, findBloodSugarRecords, listBloodSugarEntries, updateUserBloodSugarRecord } from "./service.js";

export async function registerHealthBloodSugarRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.get("/health/blood-sugar/entries", { preHandler: [app.authenticate, requirePermission("records.read.self")] }, async (request) => listBloodSugarEntries(prisma, request.user.id, paginationSchema.parse(request.query)));
  app.post("/health/blood-sugar/entries", { preHandler: [app.authenticate, requirePermission("records.create.self")] }, async (request, reply) => { const record = await createUserBloodSugarRecord(prisma, request.user.id, createRecordSchema.parse(request.body)); reply.status(201); return record; });
  app.put("/health/blood-sugar/entries/:id", { preHandler: [app.authenticate, requirePermission("records.update.self")] }, async (request) => { const params = idParamsSchema.parse(request.params); return updateUserBloodSugarRecord(prisma, request.user.id, params.id, updateRecordSchema.parse(request.body)); });
  app.delete("/health/blood-sugar/entries/:id", { preHandler: [app.authenticate, requirePermission("records.delete.self")] }, async (request, reply) => { const params = idParamsSchema.parse(request.params); await deleteUserBloodSugarRecord(prisma, request.user.id, params.id); reply.status(204).send(); });
  app.get("/health/blood-sugar/dashboard", { preHandler: [app.authenticate, requirePermission("dashboard.read.self")] }, async (request) => { const { range } = dashboardQuerySchema.parse(request.query); const records = await findBloodSugarRecords(prisma, request.user.id, range); return { range, dataType: "bloodSugar", records }; });
  app.get("/health/blood-sugar/export", { preHandler: [app.authenticate, requirePermission("export.read.self")] }, async (request, reply) => {
    const { type } = exportQuerySchema.parse(request.query);
    const { buffer, filename } = await buildLegacyBloodSugarExport(prisma, request.user, type);
    const headers = legacyBloodSugarExportHeaders(type, filename);
    reply.header("content-type", headers.contentType).header("content-disposition", headers.disposition);
    return buffer;
  });
}
