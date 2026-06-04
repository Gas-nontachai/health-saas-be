import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { AppConfig } from "../../../config/index.js";
import { HttpError } from "../../../common/errors.js";
import type { AppPrisma } from "../../../infra/prisma.js";
import { getUserRolePermissions } from "../rbac/authorize.js";
import { assignDefaultUserRole } from "../rbac/sync.js";
import { hashPassword, verifyPassword } from "./passwords.js";

export type RegisterInput = {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type ResetPasswordInput = {
  userId: string;
  currentPassword: string;
  newPassword: string;
};

export type LocalAuthService = {
  register(input: RegisterInput): Promise<TokenResponse>;
  login(input: LoginInput): Promise<TokenResponse>;
  refreshToken(refreshToken: string): Promise<TokenResponse>;
  resetPassword(input: ResetPasswordInput): Promise<void>;
  changeRequiredPassword(input: ResetPasswordInput): Promise<void>;
};

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: "Bearer";
  requiresPasswordChange: boolean;
  user: {
    id: string;
    email: string;
    name: string | null;
    roles: string[];
    permissions: string[];
  };
};

type LocalTokenPayload = JWTPayload & {
  typ?: "access" | "refresh";
};

export function createLocalAuthService(config: AppConfig, prisma: AppPrisma): LocalAuthService {
  return {
    async register(input) {
      const email = input.email.toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) throw new HttpError(409, "User already exists");

      const user = await prisma.user.create({
        data: {
          email,
          name: buildName(input.firstName, input.lastName),
          passwordHash: await hashPassword(input.password),
          passwordChangedAt: new Date(),
          profile: { create: {} }
        }
      });
      await assignDefaultUserRole(prisma, user.id);
      return issueTokenResponse(config, prisma, user.id);
    },

    async login(input) {
      const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
      if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
        throw new HttpError(401, "Invalid email or password");
      }
      return issueTokenResponse(config, prisma, user.id);
    },

    async refreshToken(refreshToken) {
      const payload = await verifyLocalToken(config, refreshToken, "refresh");
      return issueTokenResponse(config, prisma, String(payload.sub));
    },

    async resetPassword(input) {
      await updatePassword(prisma, input, false);
    },

    async changeRequiredPassword(input) {
      await updatePassword(prisma, input, true);
    }
  };
}

export async function verifyLocalToken(config: AppConfig, token: string, type: "access" | "refresh"): Promise<LocalTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, secretKey(config));
    const localPayload = payload as LocalTokenPayload;
    if (localPayload.typ !== type || !localPayload.sub) throw new Error("Invalid token type");
    return localPayload;
  } catch {
    throw new HttpError(401, "Invalid bearer token");
  }
}

export async function issueTokenResponse(config: AppConfig, prisma: AppPrisma, userId: string): Promise<TokenResponse> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, name: true, passwordChangeRequired: true } });
  const { roles, permissions } = await getUserRolePermissions(prisma, user.id);
  const access_token = await signToken(config, user.id, "access", config.ACCESS_TOKEN_TTL_SECONDS);
  const refresh_token = await signToken(config, user.id, "refresh", config.REFRESH_TOKEN_TTL_SECONDS);

  return {
    access_token,
    expires_in: config.ACCESS_TOKEN_TTL_SECONDS,
    refresh_token,
    token_type: "Bearer",
    requiresPasswordChange: user.passwordChangeRequired,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      roles,
      permissions
    }
  };
}

async function updatePassword(prisma: AppPrisma, input: ResetPasswordInput, clearRequiredFlag: boolean): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user?.passwordHash || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new HttpError(401, "Invalid current password");
  }
  if (await verifyPassword(input.newPassword, user.passwordHash)) {
    throw new HttpError(400, "New password must be different from current password");
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(input.newPassword),
      passwordChangedAt: new Date(),
      passwordChangeRequired: clearRequiredFlag ? false : user.passwordChangeRequired
    }
  });
}

async function signToken(config: AppConfig, userId: string, type: "access" | "refresh", ttlSeconds: number): Promise<string> {
  return new SignJWT({ typ: type })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretKey(config));
}

function secretKey(config: AppConfig): Uint8Array {
  return new TextEncoder().encode(config.JWT_SECRET);
}

function buildName(firstName?: string, lastName?: string): string | null {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name || null;
}
