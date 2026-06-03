import type { AppPrisma } from "../../../infra/prisma.js";
import { HttpError } from "../../../common/errors.js";
import { buildBloodSugarSummary } from "../blood-sugar/service.js";
import { includesDataType } from "../overview/types.js";
import { buildWeightForecastResponse, findWeightGoal } from "../weight/service.js";
import { serializeMetricEntry, toDateOnly, WEIGHT_METRIC_TYPE } from "../weight/forecast.js";
import { MAX_SHARED_RECORDS, MS_PER_DAY } from "./constants.js";
import { bloodWhere, countBloodRecords, countWeightEntries, createSharedLink, findOwnedSharedLink, findPublicBloodRecords, findPublicSharedLink, findPublicWeightEntries, findSharedLinks, revokeSharedLink, weightWhere } from "./repository.js";
import type { CreateSharedLinkInput } from "./schemas.js";
import { getSharedLinkDataTypes, getSharedLinkStatus, serializeSharedLink } from "./serializer.js";
import { generateToken } from "./token.js";

export async function createUserSharedLink(prisma: AppPrisma, userId: string, body: CreateSharedLinkInput, now = new Date()) {
  const wantsBloodSugar = includesDataType(body.dataTypes, "bloodSugar");
  const wantsWeight = includesDataType(body.dataTypes, "weight");
  const blood = bloodWhere(userId, body.dataStartAt, body.dataEndAt);
  const weight = weightWhere(userId, body.dataStartAt, body.dataEndAt, WEIGHT_METRIC_TYPE, toDateOnly);
  const [recordCount, weightCount] = await Promise.all([wantsBloodSugar ? countBloodRecords(prisma, blood) : Promise.resolve(0), wantsWeight ? countWeightEntries(prisma, weight) : Promise.resolve(0)]);
  if (recordCount + weightCount > MAX_SHARED_RECORDS) throw new HttpError(400, "Selected date range has too many records. Please choose a shorter range.");
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + body.expiresInDays * MS_PER_DAY);
  const sharedLink = await createSharedLink(prisma, userId, body, token, expiresAt);
  return { ...serializeSharedLink(sharedLink, now), publicPath: `/shared/${token}`, token };
}
export async function listUserSharedLinks(prisma: AppPrisma, userId: string, now = new Date()) { return { data: (await findSharedLinks(prisma, userId)).map((sharedLink) => serializeSharedLink(sharedLink, now)) }; }
export async function revokeUserSharedLink(prisma: AppPrisma, userId: string, id: string, now = new Date()) { const existing = await findOwnedSharedLink(prisma, id, userId); if (!existing) throw new HttpError(404, "Shared link not found"); if (existing.revokedAt) return serializeSharedLink(existing, now); const revokedAt = new Date(); return serializeSharedLink(await revokeSharedLink(prisma, id, revokedAt), revokedAt); }
export async function getPublicSharedLinkPayload(prisma: AppPrisma, token: string, now = new Date()) {
  const sharedLink = await findPublicSharedLink(prisma, token);
  if (!sharedLink || getSharedLinkStatus(sharedLink, now) !== "active") throw new HttpError(404, "Shared link not found");
  const dataTypes = getSharedLinkDataTypes(sharedLink.dataTypes);
  const wantsBloodSugar = includesDataType(dataTypes, "bloodSugar");
  const wantsWeight = includesDataType(dataTypes, "weight");
  const blood = bloodWhere(sharedLink.userId, sharedLink.dataStartAt, sharedLink.dataEndAt);
  const weight = weightWhere(sharedLink.userId, sharedLink.dataStartAt, sharedLink.dataEndAt, WEIGHT_METRIC_TYPE, toDateOnly);
  const [bloodCount, weightCount] = await Promise.all([wantsBloodSugar ? countBloodRecords(prisma, blood) : Promise.resolve(0), wantsWeight ? countWeightEntries(prisma, weight) : Promise.resolve(0)]);
  const totalCount = bloodCount + weightCount;
  if (totalCount > MAX_SHARED_RECORDS) throw new HttpError(400, "Shared link has too many records. Please ask the owner to create a shorter date range.");
  const [records, weightEntries, weightGoal] = await Promise.all([wantsBloodSugar ? findPublicBloodRecords(prisma, blood) : Promise.resolve([]), wantsWeight ? findPublicWeightEntries(prisma, weight) : Promise.resolve([]), wantsWeight ? findWeightGoal(prisma, sharedLink.userId) : Promise.resolve(null)]);
  const serializedRecords = records.map((record) => ({ datetime: record.datetime.toISOString(), bloodSugar: record.bloodSugar, medMorning: record.medMorning, medEvening: record.medEvening, note: record.note }));
  const forecast = wantsWeight ? buildWeightForecastResponse("all", weightGoal, weightEntries) : null;
  return {
    patient: { name: sharedLink.user.name, email: sharedLink.user.email, weight: sharedLink.user.profile?.weight ?? null, height: sharedLink.user.profile?.height ?? null },
    sharedLink: { dataStartAt: sharedLink.dataStartAt.toISOString(), dataEndAt: sharedLink.dataEndAt.toISOString(), expiresAt: sharedLink.expiresAt.toISOString(), status: "active" as const, dataTypes },
    ...(wantsBloodSugar ? { records: serializedRecords } : {}),
    data: {
      ...(wantsBloodSugar ? { bloodSugar: { records: serializedRecords, summary: buildBloodSugarSummary(records) } } : {}),
      ...(wantsWeight ? { weight: { entries: weightEntries.map(serializeMetricEntry), goal: forecast?.goal ?? null, forecastSummary: forecast } } : {})
    },
    meta: { totalCount, returnedCount: records.length + weightEntries.length, limit: MAX_SHARED_RECORDS }
  };
}
