import type { AppPrisma } from "../../../infra/prisma.js";
export async function findUserProfileSummary(prisma: AppPrisma, userId: string) {
  const [user, profile] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true } }),
    prisma.profile.upsert({ where: { userId }, update: {}, create: { userId } })
  ]);
  return { user, profile };
}
export async function findUserName(prisma: AppPrisma, userId: string) { return prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } }); }
export async function updateUserIdentity(prisma: AppPrisma, userId: string, data: { email?: string; name?: string }) { return prisma.user.update({ where: { id: userId }, data }); }
export async function upsertProfile(prisma: AppPrisma, userId: string, data: { weight?: number | null; height?: number | null }) { return prisma.profile.upsert({ where: { userId }, update: data, create: { userId, weight: data.weight, height: data.height } }); }
export async function findUserEmailName(prisma: AppPrisma, userId: string) { return prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true } }); }
