import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppPrisma } from "../prisma.js";
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
    }, "expiresInDays must be one of 1, 3, 7, or 30")
  })
  .transform((value) => ({
    dataStartAt: new Date(value.startDate),
    dataEndAt: new Date(value.endDate),
    expiresInDays: value.expiresInDays
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
};

export async function registerSharedLinkRoutes(app: FastifyInstance, prisma: AppPrisma): Promise<void> {
  app.post("/shared-links", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createSharedLinkSchema.parse(request.body);
    const where = {
      userId: request.user.id,
      datetime: {
        gte: body.dataStartAt,
        lte: body.dataEndAt
      }
    };

    const recordCount = await prisma.record.count({ where });
    if (recordCount > MAX_SHARED_RECORDS) {
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

  app.get("/shared-links", { preHandler: app.authenticate }, async (request) => {
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

  app.post("/shared-links/:id/revoke", { preHandler: app.authenticate }, async (request) => {
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

    const where = {
      userId: sharedLink.userId,
      datetime: {
        gte: sharedLink.dataStartAt,
        lte: sharedLink.dataEndAt
      }
    };

    const totalCount = await prisma.record.count({ where });
    if (totalCount > MAX_SHARED_RECORDS) {
      throw new HttpError(400, "Shared link has too many records. Please ask the owner to create a shorter date range.");
    }

    const records = await prisma.record.findMany({
      where,
      orderBy: { datetime: "asc" },
      take: MAX_SHARED_RECORDS,
      select: {
        datetime: true,
        bloodSugar: true,
        medMorning: true,
        medEvening: true,
        note: true
      }
    });

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
        status: "active" as const
      },
      records: records.map((record) => ({
        datetime: record.datetime.toISOString(),
        bloodSugar: record.bloodSugar,
        medMorning: record.medMorning,
        medEvening: record.medEvening,
        note: record.note
      })),
      meta: {
        totalCount,
        returnedCount: records.length,
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
    createdAt: sharedLink.createdAt.toISOString()
  };
}

function getSharedLinkStatus(sharedLink: Pick<SharedLinkRow, "expiresAt" | "revokedAt">, now: Date): SharedLinkStatus {
  if (sharedLink.revokedAt) return "revoked";
  if (sharedLink.expiresAt <= now) return "expired";
  return "active";
}
