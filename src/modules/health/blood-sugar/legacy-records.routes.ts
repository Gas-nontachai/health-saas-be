import type { FastifyInstance } from "fastify";
import type { AppPrisma } from "../../../infra/prisma.js";
import { requirePermission } from "../../identity/rbac/authorize.js";
import { createRecordSchema, idParamsSchema, paginationSchema, updateRecordSchema } from "./legacy-records.schemas.js";
import { createUserRecord, deleteUserRecord, listRecords, updateUserRecord } from "./legacy-records.service.js";

export async function registerRecordRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.get("/records", { preHandler: [app.authenticate, requirePermission("records.read.self")] }, async (request) => listRecords(prisma, request.user.id, paginationSchema.parse(request.query)));
  app.post("/records", { preHandler: [app.authenticate, requirePermission("records.create.self")] }, async (request, reply) => { const record = await createUserRecord(prisma, request.user.id, createRecordSchema.parse(request.body)); reply.status(201); return record; });
  app.put("/records/:id", { preHandler: [app.authenticate, requirePermission("records.update.self")] }, async (request) => { const params = idParamsSchema.parse(request.params); return updateUserRecord(prisma, request.user.id, params.id, updateRecordSchema.parse(request.body)); });
  app.delete("/records/:id", { preHandler: [app.authenticate, requirePermission("records.delete.self")] }, async (request, reply) => { const params = idParamsSchema.parse(request.params); await deleteUserRecord(prisma, request.user.id, params.id); reply.status(204).send(); });
}
