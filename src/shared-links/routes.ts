import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildBloodSugarSummary } from "../health/blood-sugar/service.js";
import { sharedLinkDataTypesSchema, normalizeHealthDataTypes } from "../health/schemas.js";
import { includesDataType, type HealthDataType } from "../health/types.js";
import { buildWeightForecastResponse, findWeightGoal } from "../health/weight/service.js";
import { serializeMetricEntry, toDateOnly, WEIGHT_METRIC_TYPE } from "../health/weight/forecast.js";
import type { AppPrisma } from "../prisma.js";
import { requirePermission } from "../rbac/authorize.js";
import { HttpError } from "../shared/errors.js";
import { idParamsSchema, isoDatetimeSchema } from "../shared/validation.js";

const ALLOWED_EXPIRY_DAYS = [1, 3, 7, 30] as const;
const MAX_SHARED_RANGE_DAYS = 90;
const MAX_SHARED_RECORDS = 1000;
const MS_PER_DAY = 86_400_000;

const createSharedLinkSchema = z
  .object({
    startDate: isoDatetimeSchema,
    endDate: isoDatetimeSchema,
    expiresInDays: z.number().int().refine((value): value is (typeof ALLOWED_EXPIRY_DAYS)[number] => {
      return ALLOWED_EXPIRY_DAYS.includes(value as (typeof ALLOWED_EXPIRY_DAYS)[number]);
    }, "expiresInDays must be one of 1, 3, 7, or 30"),
    dataTypes: sharedLinkDataTypesSchema.default(["bloodSugar"])
  })
  .transform((value) => ({
    dataStartAt: new Date(value.startDate),
    dataEndAt: new Date(value.endDate),
    expiresInDays: value.expiresInDays,
    dataTypes: value.dataTypes
  }))
  .superRefine((value, ctx) => {
    if (value.dataStartAt > value.dataEndAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "endDate must be after or equal to startDate"
      });
    }

    if (value.dataEndAt.getTime() - value.dataStartAt.getTime() > MAX_SHARED_RANGE_DAYS * MS_PER_DAY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: `Shared data range cannot exceed ${MAX_SHARED_RANGE_DAYS} days`
      });
    }
  });

const publicTokenParamsSchema = z.object({
  token: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/)
});

type SharedLinkStatus = "active" | "expired" | "revoked";

type SharedLinkRow = {
  id: string;
  publicToken: string | null;
  dataStartAt: Date;
  dataEndAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  dataTypes?: unknown;
};

export async function registerSharedLinkRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.post("/shared-links", { preHandler: [app.authenticate, requirePermission("sharedLinks.create.self")] }, async (request, reply) => {
    const body = createSharedLinkSchema.parse(request.body);
    const wantsBloodSugar = includesDataType(body.dataTypes, "bloodSugar");
    const wantsWeight = includesDataType(body.dataTypes, "weight");

    const [recordCount, weightCount] = await Promise.all([
      wantsBloodSugar
        ? prisma.record.count({
            where: {
              userId: request.user.id,
              datetime: { gte: body.dataStartAt, lte: body.dataEndAt }
            }
          })
        : Promise.resolve(0),
      wantsWeight
        ? prisma.healthMetricEntry.count({
            where: {
              userId: request.user.id,
              metricType: WEIGHT_METRIC_TYPE,
              date: { gte: toDateOnly(body.dataStartAt.toISOString().slice(0, 10)), lte: toDateOnly(body.dataEndAt.toISOString().slice(0, 10)) }
            }
          })
        : Promise.resolve(0)
    ]);
    if (recordCount + weightCount > MAX_SHARED_RECORDS) {
      throw new HttpError(400, `Selected date range has too many records. Please choose a shorter range.`);
    }

    const token = generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + body.expiresInDays * MS_PER_DAY);
    const sharedLink = await prisma.sharedLink.create({
      data: {
        userId: request.user.id,
        tokenHash: hashToken(token),
        publicToken: token,
        dataStartAt: body.dataStartAt,
        dataEndAt: body.dataEndAt,
        dataTypes: body.dataTypes,
        expiresAt
      },
      select: sharedLinkSelect
    });

    reply.status(201);
    return {
      ...serializeSharedLink(sharedLink, now),
      publicPath: `/shared/${token}`,
      token
    };
  });

  app.get("/shared-links", { preHandler: [app.authenticate, requirePermission("sharedLinks.read.self")] }, async (request) => {
    const now = new Date();
    const sharedLinks = await prisma.sharedLink.findMany({
      where: { userId: request.user.id },
      orderBy: { createdAt: "desc" },
      select: sharedLinkSelect
    });

    return {
      data: sharedLinks.map((sharedLink) => serializeSharedLink(sharedLink, now))
    };
  });

  app.post("/shared-links/:id/revoke", { preHandler: [app.authenticate, requirePermission("sharedLinks.revoke.self")] }, async (request) => {
    const params = idParamsSchema.parse(request.params);
    const existing = await prisma.sharedLink.findFirst({
      where: { id: params.id, userId: request.user.id },
      select: sharedLinkSelect
    });

    if (!existing) {
      throw new HttpError(404, "Shared link not found");
    }

    if (existing.revokedAt) {
      return serializeSharedLink(existing, new Date());
    }

    const revokedAt = new Date();
    const sharedLink = await prisma.sharedLink.update({
      where: { id: params.id },
      data: { revokedAt },
      select: sharedLinkSelect
    });

    return serializeSharedLink(sharedLink, revokedAt);
  });

  app.get("/public/shared-links/:token", async (request) => {
    const params = publicTokenParamsSchema.parse(request.params);
    const now = new Date();
    const sharedLink = await prisma.sharedLink.findUnique({
      where: { tokenHash: hashToken(params.token) },
      select: {
        ...sharedLinkSelect,
        user: {
          select: {
            name: true,
            email: true,
            profile: {
              select: {
                weight: true,
                height: true
              }
            }
          }
        }
      }
    });

    if (!sharedLink || getSharedLinkStatus(sharedLink, now) !== "active") {
      throw new HttpError(404, "Shared link not found");
    }

    const dataTypes = getSharedLinkDataTypes(sharedLink.dataTypes);
    const wantsBloodSugar = includesDataType(dataTypes, "bloodSugar");
    const wantsWeight = includesDataType(dataTypes, "weight");

    const bloodWhere = {
      userId: sharedLink.userId,
      datetime: { gte: sharedLink.dataStartAt, lte: sharedLink.dataEndAt }
    };
    const weightWhere = {
      userId: sharedLink.userId,
      metricType: WEIGHT_METRIC_TYPE,
      date: { gte: toDateOnly(sharedLink.dataStartAt.toISOString().slice(0, 10)), lte: toDateOnly(sharedLink.dataEndAt.toISOString().slice(0, 10)) }
    };

    const [bloodCount, weightCount] = await Promise.all([
      wantsBloodSugar ? prisma.record.count({ where: bloodWhere }) : Promise.resolve(0),
      wantsWeight ? prisma.healthMetricEntry.count({ where: weightWhere }) : Promise.resolve(0)
    ]);
    const totalCount = bloodCount + weightCount;
    if (totalCount > MAX_SHARED_RECORDS) {
      throw new HttpError(400, "Shared link has too many records. Please ask the owner to create a shorter date range.");
    }

    const [records, weightEntries, weightGoal] = await Promise.all([
      wantsBloodSugar
        ? prisma.record.findMany({
            where: bloodWhere,
            orderBy: { datetime: "asc" },
            take: MAX_SHARED_RECORDS,
            select: { datetime: true, bloodSugar: true, medMorning: true, medEvening: true, note: true }
          })
        : Promise.resolve([]),
      wantsWeight ? prisma.healthMetricEntry.findMany({ where: weightWhere, orderBy: { date: "asc" }, take: MAX_SHARED_RECORDS }) : Promise.resolve([]),
      wantsWeight ? findWeightGoal(prisma, sharedLink.userId) : Promise.resolve(null)
    ]);

    const serializedRecords = records.map((record) => ({
      datetime: record.datetime.toISOString(),
      bloodSugar: record.bloodSugar,
      medMorning: record.medMorning,
      medEvening: record.medEvening,
      note: record.note
    }));
    const forecast = wantsWeight ? buildWeightForecastResponse("all", weightGoal, weightEntries) : null;

    return {
      patient: {
        name: sharedLink.user.name,
        email: sharedLink.user.email,
        weight: sharedLink.user.profile?.weight ?? null,
        height: sharedLink.user.profile?.height ?? null
      },
      sharedLink: {
        dataStartAt: sharedLink.dataStartAt.toISOString(),
        dataEndAt: sharedLink.dataEndAt.toISOString(),
        expiresAt: sharedLink.expiresAt.toISOString(),
        status: "active" as const,
        dataTypes
      },
      ...(wantsBloodSugar ? { records: serializedRecords } : {}),
      data: {
        ...(wantsBloodSugar
          ? {
              bloodSugar: {
                records: serializedRecords,
                summary: buildBloodSugarSummary(records)
              }
            }
          : {}),
        ...(wantsWeight
          ? {
              weight: {
                entries: weightEntries.map(serializeMetricEntry),
                goal: forecast?.goal ?? null,
                forecastSummary: forecast
              }
            }
          : {})
      },
      meta: {
        totalCount,
        returnedCount: records.length + weightEntries.length,
        limit: MAX_SHARED_RECORDS
      }
    };
  });
}

const sharedLinkSelect = {
  id: true,
  userId: true,
  publicToken: true,
  dataStartAt: true,
  dataEndAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true
  ,
  dataTypes: true
} as const;

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function serializeSharedLink(sharedLink: SharedLinkRow, now: Date) {
  const status = getSharedLinkStatus(sharedLink, now);

  return {
    id: sharedLink.id,
    publicPath: status === "active" && sharedLink.publicToken ? `/shared/${sharedLink.publicToken}` : null,
    dataStartAt: sharedLink.dataStartAt.toISOString(),
    dataEndAt: sharedLink.dataEndAt.toISOString(),
    expiresAt: sharedLink.expiresAt.toISOString(),
    revokedAt: sharedLink.revokedAt?.toISOString() ?? null,
    status,
    dataTypes: getSharedLinkDataTypes(sharedLink.dataTypes),
    createdAt: sharedLink.createdAt.toISOString()
  };
}

function getSharedLinkStatus(sharedLink: Pick<SharedLinkRow, "expiresAt" | "revokedAt">, now: Date): SharedLinkStatus {
  if (sharedLink.revokedAt) return "revoked";
  if (sharedLink.expiresAt <= now) return "expired";
  return "active";
}

function getSharedLinkDataTypes(value: unknown): HealthDataType[] {
  if (!Array.isArray(value)) return ["bloodSugar"];
  try {
    return normalizeHealthDataTypes(value.filter((item): item is string => typeof item === "string"));
  } catch {
    return ["bloodSugar"];
  }
}
