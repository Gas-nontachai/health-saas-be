import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildExcel, buildPdf, type ExportContext } from "../../export/builders.js";
import type { AppPrisma } from "../../prisma.js";
import { requirePermission } from "../../rbac/authorize.js";
import { HttpError } from "../../shared/errors.js";
import { bloodSugarSchema, idParamsSchema, isoDatetimeSchema } from "../../shared/validation.js";
import { exportTypeSchema, healthRangeSchema, paginationSchema } from "../schemas.js";
import { findBloodSugarRecords } from "./service.js";

const createRecordSchema = z.object({
  datetime: isoDatetimeSchema,
  bloodSugar: bloodSugarSchema,
  medMorning: z.number().int().nonnegative().optional().nullable(),
  medEvening: z.number().int().nonnegative().optional().nullable(),
  note: z.string().max(1000).optional().nullable()
});

const updateRecordSchema = createRecordSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required"
});

const dashboardQuerySchema = z.object({
  range: healthRangeSchema
});

const exportQuerySchema = z.object({
  type: exportTypeSchema
});

export async function registerHealthBloodSugarRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.get("/health/blood-sugar/entries", { preHandler: [app.authenticate, requirePermission("records.read.self")] }, async (request) => {
    const { cursor, limit } = paginationSchema.parse(request.query);
    const where = { userId: request.user.id };
    const [records, totalCount] = await Promise.all([
      prisma.record.findMany({
        where,
        orderBy: { datetime: "desc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
      }),
      prisma.record.count({ where })
    ]);
    const hasMore = records.length > limit;
    if (hasMore) records.pop();
    return { data: records, nextCursor: hasMore ? records[records.length - 1].id : null, totalCount };
  });

  app.post("/health/blood-sugar/entries", { preHandler: [app.authenticate, requirePermission("records.create.self")] }, async (request, reply) => {
    const body = createRecordSchema.parse(request.body);
    const record = await prisma.record.create({
      data: {
        userId: request.user.id,
        datetime: new Date(body.datetime),
        bloodSugar: body.bloodSugar,
        medMorning: body.medMorning,
        medEvening: body.medEvening,
        note: body.note
      }
    });
    reply.status(201);
    return record;
  });

  app.put("/health/blood-sugar/entries/:id", { preHandler: [app.authenticate, requirePermission("records.update.self")] }, async (request) => {
    const params = idParamsSchema.parse(request.params);
    const body = updateRecordSchema.parse(request.body);
    await assertRecordOwnership(prisma, params.id, request.user.id);
    return prisma.record.update({
      where: { id: params.id },
      data: { ...body, datetime: body.datetime ? new Date(body.datetime) : undefined }
    });
  });

  app.delete("/health/blood-sugar/entries/:id", { preHandler: [app.authenticate, requirePermission("records.delete.self")] }, async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    await assertRecordOwnership(prisma, params.id, request.user.id);
    await prisma.record.delete({ where: { id: params.id } });
    reply.status(204).send();
  });

  app.get("/health/blood-sugar/dashboard", { preHandler: [app.authenticate, requirePermission("dashboard.read.self")] }, async (request) => {
    const { range } = dashboardQuerySchema.parse(request.query);
    const records = await findBloodSugarRecords(prisma, request.user.id, range);
    return {
      range,
      dataType: "bloodSugar",
      records
    };
  });

  app.get("/health/blood-sugar/export", { preHandler: [app.authenticate, requirePermission("export.read.self")] }, async (request, reply) => {
    const { type } = exportQuerySchema.parse(request.query);
    const [records, profile] = await Promise.all([
      prisma.record.findMany({
        where: { userId: request.user.id },
        orderBy: { datetime: "asc" },
        take: 1000,
        select: { datetime: true, bloodSugar: true, medMorning: true, medEvening: true, note: true }
      }),
      prisma.profile.findUnique({ where: { userId: request.user.id }, select: { weight: true, height: true } })
    ]);
    const ctx: ExportContext = {
      patientName: request.user.name ?? request.user.email,
      patientEmail: request.user.email,
      weight: profile?.weight ?? null,
      height: profile?.height ?? null,
      exportedAt: new Date()
    };
    if (type === "excel") {
      const buffer = await buildExcel(records, ctx);
      reply
        .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("content-disposition", "attachment; filename=\"blood-sugar-records.xlsx\"");
      return buffer;
    }
    const buffer = await buildPdf(records, ctx);
    reply.header("content-type", "application/pdf").header("content-disposition", "attachment; filename=\"blood-sugar-records.pdf\"");
    return buffer;
  });
}

async function assertRecordOwnership(prisma: AppPrisma, id: string, userId: string): Promise<void> {
  const record = await prisma.record.findFirst({ where: { id, userId }, select: { id: true } });
  if (!record) throw new HttpError(404, "Record not found");
}
