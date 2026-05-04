import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppPrisma } from "../prisma.js";
import { HttpError } from "../shared/errors.js";
import { bloodSugarSchema, idParamsSchema, isoDatetimeSchema } from "../shared/validation.js";

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

export async function registerRecordRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.get("/records", { preHandler: app.authenticate }, async (request) => {
    return prisma.record.findMany({
      where: { userId: request.user.id },
      orderBy: { datetime: "desc" }
    });
  });

  app.post("/records", { preHandler: app.authenticate }, async (request, reply) => {
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

  app.put("/records/:id", { preHandler: app.authenticate }, async (request) => {
    const params = idParamsSchema.parse(request.params);
    const body = updateRecordSchema.parse(request.body);

    await assertRecordOwnership(prisma, params.id, request.user.id);

    return prisma.record.update({
      where: { id: params.id },
      data: {
        ...body,
        datetime: body.datetime ? new Date(body.datetime) : undefined
      }
    });
  });

  app.delete("/records/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    await assertRecordOwnership(prisma, params.id, request.user.id);
    await prisma.record.delete({ where: { id: params.id } });
    reply.status(204).send();
  });
}

async function assertRecordOwnership(prisma: AppPrisma, id: string, userId: string): Promise<void> {
  const record = await prisma.record.findFirst({
    where: { id, userId },
    select: { id: true }
  });

  if (!record) {
    throw new HttpError(404, "Record not found");
  }
}
