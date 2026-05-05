import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppPrisma } from "../prisma.js";
import { HttpError } from "../shared/errors.js";
import { buildExcel, buildPdf, type ExportContext } from "./builders.js";

const exportQuerySchema = z.object({
  type: z.enum(["excel", "pdf"])
});

export async function registerExportRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.get("/export", { preHandler: app.authenticate }, async (request, reply) => {
    const query = exportQuerySchema.parse(request.query);

    const [records, profile] = await Promise.all([
      prisma.record.findMany({
        where: { userId: request.user.id },
        orderBy: { datetime: "asc" },
        take: 1000,
        select: {
          datetime: true,
          bloodSugar: true,
          medMorning: true,
          medEvening: true,
          note: true
        }
      }),
      prisma.profile.findUnique({
        where: { userId: request.user.id },
        select: { weight: true, height: true }
      })
    ]);

    const ctx: ExportContext = {
      patientName: request.user.name ?? request.user.email,
      patientEmail: request.user.email,
      weight: profile?.weight ?? null,
      height: profile?.height ?? null,
      exportedAt: new Date()
    };

    if (query.type === "excel") {
      const buffer = await buildExcel(records, ctx);
      reply
        .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("content-disposition", "attachment; filename=\"blood-sugar-records.xlsx\"");
      return buffer;
    }

    if (query.type === "pdf") {
      const buffer = await buildPdf(records, ctx);
      reply.header("content-type", "application/pdf").header("content-disposition", "attachment; filename=\"blood-sugar-records.pdf\"");
      return buffer;
    }

    throw new HttpError(400, "Unsupported export type");
  });
}
