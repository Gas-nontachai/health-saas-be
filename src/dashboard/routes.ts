import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppPrisma } from "../prisma.js";

const dashboardQuerySchema = z.object({
  range: z.enum(["7d", "30d", "all"]).default("30d")
});

export async function registerDashboardRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.get("/dashboard", { preHandler: app.authenticate }, async (request) => {
    const query = dashboardQuerySchema.parse(request.query);
    const datetimeFilter = getDatetimeFilter(query.range);

    const where = {
      userId: request.user.id,
      ...(datetimeFilter ? { datetime: datetimeFilter } : {})
    };

    const [stats, records] = await Promise.all([
      prisma.record.aggregate({
        where,
        _avg: { bloodSugar: true },
        _min: { bloodSugar: true },
        _max: { bloodSugar: true }
      }),
      prisma.record.findMany({
        where,
        orderBy: { datetime: "asc" },
        select: { datetime: true, bloodSugar: true }
      })
    ]);

    return {
      avg: stats._avg.bloodSugar,
      min: stats._min.bloodSugar,
      max: stats._max.bloodSugar,
      trend: records.map((record) => ({
        datetime: record.datetime.toISOString(),
        value: record.bloodSugar
      }))
    };
  });
}

function getDatetimeFilter(range: "7d" | "30d" | "all"): { gte: Date } | undefined {
  if (range === "all") {
    return undefined;
  }

  const days = range === "7d" ? 7 : 30;
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days);
  return { gte: start };
}
