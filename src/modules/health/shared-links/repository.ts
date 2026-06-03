import type { AppPrisma } from "../../../infra/prisma.js";
import { MAX_SHARED_RECORDS } from "./constants.js";
import type { CreateSharedLinkInput } from "./schemas.js";
import { hashToken } from "./token.js";
export const sharedLinkSelect = { id: true, userId: true, publicToken: true, dataStartAt: true, dataEndAt: true, expiresAt: true, revokedAt: true, createdAt: true, dataTypes: true } as const;
export function bloodWhere(userId: string, start: Date, end: Date) { return { userId, datetime: { gte: start, lte: end } }; }
export function weightWhere(userId: string, start: Date, end: Date, metricType: string, toDateOnly: (value: string) => Date) { return { userId, metricType, date: { gte: toDateOnly(start.toISOString().slice(0, 10)), lte: toDateOnly(end.toISOString().slice(0, 10)) } }; }
export async function countBloodRecords(prisma: AppPrisma, where: ReturnType<typeof bloodWhere>) { return prisma.record.count({ where }); }
export async function countWeightEntries(prisma: AppPrisma, where: ReturnType<typeof weightWhere>) { return prisma.healthMetricEntry.count({ where }); }
export async function createSharedLink(prisma: AppPrisma, userId: string, body: CreateSharedLinkInput, token: string, expiresAt: Date) { return prisma.sharedLink.create({ data: { userId, tokenHash: hashToken(token), publicToken: token, dataStartAt: body.dataStartAt, dataEndAt: body.dataEndAt, dataTypes: body.dataTypes, expiresAt }, select: sharedLinkSelect }); }
export async function findSharedLinks(prisma: AppPrisma, userId: string) { return prisma.sharedLink.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: sharedLinkSelect }); }
export async function findOwnedSharedLink(prisma: AppPrisma, id: string, userId: string) { return prisma.sharedLink.findFirst({ where: { id, userId }, select: sharedLinkSelect }); }
export async function revokeSharedLink(prisma: AppPrisma, id: string, revokedAt: Date) { return prisma.sharedLink.update({ where: { id }, data: { revokedAt }, select: sharedLinkSelect }); }
export async function findPublicSharedLink(prisma: AppPrisma, token: string) { return prisma.sharedLink.findUnique({ where: { tokenHash: hashToken(token) }, select: { ...sharedLinkSelect, user: { select: { name: true, email: true, profile: { select: { weight: true, height: true } } } } } }); }
export async function findPublicBloodRecords(prisma: AppPrisma, where: ReturnType<typeof bloodWhere>) { return prisma.record.findMany({ where, orderBy: { datetime: "asc" }, take: MAX_SHARED_RECORDS, select: { datetime: true, bloodSugar: true, medMorning: true, medEvening: true, note: true } }); }
export async function findPublicWeightEntries(prisma: AppPrisma, where: ReturnType<typeof weightWhere>) { return prisma.healthMetricEntry.findMany({ where, orderBy: { date: "asc" }, take: MAX_SHARED_RECORDS }); }
