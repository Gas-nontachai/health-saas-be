import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { AppConfig } from "../../../config/index.js";
import { HttpError } from "../../../common/errors.js";
import type { AppPrisma } from "../../../infra/prisma.js";
import { getUserRolePermissions } from "../rbac/authorize.js";
import { assignDefaultUserRole } from "../rbac/sync.js";
import { hashPassword, verifyPassword } from "./passwords.js";

export type RegisterInput = { email: string; password: string; firstName?: string; lastName?: string };
export type LoginInput = { email: string; password: string };
export type ResetPasswordInput = { userId: string; currentPassword: string; newPassword: string };

export type AccessTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: "Bearer";
  requiresPasswordChange: boolean;
  user: { id: string; email: string; name: string | null; roles: string[]; permissions: string[] };
};

export type AuthResult = { response: AccessTokenResponse; refreshToken: string };
export type RefreshResult = AuthResult | { reuseDetected: true };

export type LocalAuthService = {
  register(input: RegisterInput): Promise<AuthResult>;
  login(input: LoginInput): Promise<AuthResult>;
  refreshToken(refreshToken: string): Promise<RefreshResult>;
  refreshLegacyToken(refreshToken: string): Promise<AuthResult>;
  logout(refreshToken: string): Promise<void>;
  cleanupExpiredSessions(): Promise<number>;
  resetPassword(input: ResetPasswordInput): Promise<void>;
  changeRequiredPassword(input: ResetPasswordInput): Promise<void>;
};

type LocalTokenPayload = JWTPayload & { typ?: "access" | "refresh" };

export function createLocalAuthService(config: AppConfig, prisma: AppPrisma): LocalAuthService {
  return {
    async register(input) {
      const email = input.email.toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) throw new HttpError(409, "User already exists");
      const user = await prisma.user.create({
        data: { email, name: buildName(input.firstName, input.lastName), passwordHash: await hashPassword(input.password), passwordChangedAt: new Date(), profile: { create: {} } }
      });
      await assignDefaultUserRole(prisma, user.id);
      return issueAuthResult(config, prisma, user.id);
    },

    async login(input) {
      const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
      if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) throw new HttpError(401, "Invalid email or password");
      return issueAuthResult(config, prisma, user.id);
    },

    async refreshToken(refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      const now = new Date();
      return prisma.$transaction(async (tx) => {
        const consumed = await tx.refreshSession.updateMany({
          where: { tokenHash, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now }
        });
        if (consumed.count !== 1) {
          const existing = await tx.refreshSession.findUnique({ where: { tokenHash } });
          if (existing?.usedAt) {
            await tx.refreshSession.updateMany({ where: { familyId: existing.familyId, revokedAt: null }, data: { revokedAt: now } });
            return { reuseDetected: true } as const;
          }
          throw new HttpError(401, "Invalid or expired refresh session");
        }
        const current = await tx.refreshSession.findUniqueOrThrow({ where: { tokenHash } });
        const nextToken = createRefreshToken();
        await tx.refreshSession.create({
          data: { userId: current.userId, familyId: current.familyId, tokenHash: hashRefreshToken(nextToken), expiresAt: refreshExpiry(config) }
        });
        return { response: await issueAccessTokenResponse(config, tx as AppPrisma, current.userId), refreshToken: nextToken };
      });
    },

    async refreshLegacyToken(refreshToken) {
      const payload = await verifyLocalToken(config, refreshToken, "refresh");
      return issueAuthResult(config, prisma, String(payload.sub));
    },

    async logout(refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      await prisma.$transaction(async (tx) => {
        const session = await tx.refreshSession.findUnique({ where: { tokenHash } });
        if (session) await tx.refreshSession.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      });
    },

    async cleanupExpiredSessions() {
      const cutoff = new Date(Date.now() - config.AUTH_SESSION_CLEANUP_RETENTION_SECONDS * 1000);
      const result = await prisma.refreshSession.deleteMany({ where: { expiresAt: { lt: cutoff } } });
      return result.count;
    },

    async resetPassword(input) { await updatePassword(prisma, input, false); },
    async changeRequiredPassword(input) { await updatePassword(prisma, input, true); }
  };
}

export async function verifyLocalToken(config: AppConfig, token: string, type: "access" | "refresh"): Promise<LocalTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, secretKey(config));
    const localPayload = payload as LocalTokenPayload;
    if (localPayload.typ !== type || !localPayload.sub) throw new Error("Invalid token type");
    return localPayload;
  } catch { throw new HttpError(401, "Invalid bearer token"); }
}

async function issueAuthResult(config: AppConfig, prisma: AppPrisma, userId: string): Promise<AuthResult> {
  const cleanupCutoff = new Date(Date.now() - config.AUTH_SESSION_CLEANUP_RETENTION_SECONDS * 1000);
  await prisma.refreshSession.deleteMany({ where: { expiresAt: { lt: cleanupCutoff } } });
  const refreshToken = createRefreshToken();
  await prisma.refreshSession.create({
    data: { userId, familyId: randomUUID(), tokenHash: hashRefreshToken(refreshToken), expiresAt: refreshExpiry(config) }
  });
  return { response: await issueAccessTokenResponse(config, prisma, userId), refreshToken };
}

async function issueAccessTokenResponse(config: AppConfig, prisma: AppPrisma, userId: string): Promise<AccessTokenResponse> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, name: true, passwordChangeRequired: true } });
  const { roles, permissions } = await getUserRolePermissions(prisma, user.id);
  return {
    access_token: await signAccessToken(config, user.id), expires_in: config.ACCESS_TOKEN_TTL_SECONDS, token_type: "Bearer",
    requiresPasswordChange: user.passwordChangeRequired,
    user: { id: user.id, email: user.email, name: user.name, roles, permissions }
  };
}

async function updatePassword(prisma: AppPrisma, input: ResetPasswordInput, clearRequiredFlag: boolean): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user?.passwordHash || !(await verifyPassword(input.currentPassword, user.passwordHash))) throw new HttpError(401, "Invalid current password");
  if (await verifyPassword(input.newPassword, user.passwordHash)) throw new HttpError(400, "New password must be different from current password");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.newPassword), passwordChangedAt: new Date(), passwordChangeRequired: clearRequiredFlag ? false : user.passwordChangeRequired } });
}

async function signAccessToken(config: AppConfig, userId: string): Promise<string> {
  return new SignJWT({ typ: "access" }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`).sign(secretKey(config));
}

function createRefreshToken(): string { return randomBytes(32).toString("base64url"); }
export function hashRefreshToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function refreshExpiry(config: AppConfig): Date { return new Date(Date.now() + config.REFRESH_TOKEN_TTL_SECONDS * 1000); }
function secretKey(config: AppConfig): Uint8Array { return new TextEncoder().encode(config.JWT_SECRET); }
function buildName(firstName?: string, lastName?: string): string | null { return [firstName, lastName].filter(Boolean).join(" ").trim() || null; }
