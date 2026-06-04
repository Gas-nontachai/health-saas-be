import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { z } from "zod";
import { prisma } from "../../../infra/prisma.js";
import { createSmtpMailer } from "./mailer.js";
import { hashPassword } from "./passwords.js";
import { assignDefaultUserRole } from "../rbac/sync.js";

type KeycloakUser = {
  id: string;
  email?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
};

const optionalNonEmptyString = z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional());

const keycloakMigrationConfigSchema = z.object({
  KEYCLOAK_USER_MIGRATION_ON_DEPLOY: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  KEYCLOAK_USER_MIGRATION_FORCE_EMAIL: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  KEYCLOAK_BASE_URL: z.string().url().optional(),
  KEYCLOAK_REALM: optionalNonEmptyString,
  KEYCLOAK_ADMIN_USERNAME: optionalNonEmptyString,
  KEYCLOAK_ADMIN_PASSWORD: optionalNonEmptyString,
  SMTP_HOST: optionalNonEmptyString,
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: optionalNonEmptyString,
  SMTP_PASSWORD: optionalNonEmptyString,
  SMTP_FROM: optionalNonEmptyString
});

type KeycloakMigrationConfig = z.infer<typeof keycloakMigrationConfigSchema>;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadKeycloakMigrationConfig();
  try {
    if (!config.KEYCLOAK_USER_MIGRATION_ON_DEPLOY) {
      console.log("Skipping Keycloak user migration because KEYCLOAK_USER_MIGRATION_ON_DEPLOY=false.");
    } else {
      await migrateKeycloakUsers(config);
    }
  } finally {
    await prisma.$disconnect();
  }
}

export async function migrateKeycloakUsers(config: KeycloakMigrationConfig): Promise<void> {
  assertKeycloakConfig(config);
  const mailer = createSmtpMailer(config);
  const adminToken = await getAdminToken(config);
  let migrated = 0;
  let skipped = 0;
  let emailed = 0;

  for (let first = 0; ; first += 100) {
    const users = await listKeycloakUsers(config, adminToken, first, 100);
    if (users.length === 0) break;

    for (const keycloakUser of users) {
      const email = (keycloakUser.email ?? keycloakUser.username)?.toLowerCase();
      if (!email || keycloakUser.enabled === false) {
        skipped += 1;
        continue;
      }

      const existing = await prisma.user.findFirst({
        where: { OR: [{ keycloakId: keycloakUser.id }, { email }] }
      });
      const shouldSendPassword = config.KEYCLOAK_USER_MIGRATION_FORCE_EMAIL || !existing?.temporaryPasswordSentAt;
      const temporaryPassword = shouldSendPassword ? generateTemporaryPassword() : null;
      const name = buildKeycloakName(keycloakUser);

      const user = existing
        ? await prisma.user.update({
            where: { id: existing.id },
            data: {
              keycloakId: existing.keycloakId ?? keycloakUser.id,
              email,
              name: name ?? existing.name,
              migratedFrom: existing.migratedFrom ?? "keycloak",
              migratedAt: existing.migratedAt ?? new Date(),
              ...(temporaryPassword
                ? {
                    passwordHash: await hashPassword(temporaryPassword),
                    passwordChangeRequired: true
                  }
                : {})
            }
          })
        : await prisma.user.create({
            data: {
              keycloakId: keycloakUser.id,
              email,
              name,
              passwordHash: await hashPassword(temporaryPassword ?? generateTemporaryPassword()),
              passwordChangeRequired: true,
              migratedFrom: "keycloak",
              migratedAt: new Date(),
              profile: { create: {} }
            }
          });

      await assignDefaultUserRole(prisma, user.id);
      await prisma.profile.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });

      if (temporaryPassword) {
        await mailer.sendTemporaryPassword(email, temporaryPassword);
        await prisma.user.update({ where: { id: user.id }, data: { temporaryPasswordSentAt: new Date() } });
        emailed += 1;
      }
      migrated += 1;
    }

    if (users.length < 100) break;
  }

  console.log(`Keycloak user migration complete. migrated=${migrated} emailed=${emailed} skipped=${skipped}`);
}

async function getAdminToken(config: RequiredKeycloakConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: "admin-cli",
    grant_type: "password",
    username: config.KEYCLOAK_ADMIN_USERNAME,
    password: config.KEYCLOAK_ADMIN_PASSWORD
  });

  const response = await fetch(`${config.KEYCLOAK_BASE_URL}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const data = (await response.json()) as { access_token?: string; error_description?: string };
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description ?? "Unable to get Keycloak admin token");
  }
  return data.access_token;
}

async function listKeycloakUsers(config: RequiredKeycloakConfig, adminToken: string, first: number, max: number): Promise<KeycloakUser[]> {
  const url = new URL(`${config.KEYCLOAK_BASE_URL}/admin/realms/${encodeURIComponent(config.KEYCLOAK_REALM)}/users`);
  url.searchParams.set("first", String(first));
  url.searchParams.set("max", String(max));

  const response = await fetch(url, { headers: { authorization: `Bearer ${adminToken}` } });
  if (!response.ok) throw new Error("Unable to list Keycloak users");
  return (await response.json()) as KeycloakUser[];
}

type RequiredKeycloakConfig = KeycloakMigrationConfig & {
  KEYCLOAK_BASE_URL: string;
  KEYCLOAK_REALM: string;
  KEYCLOAK_ADMIN_USERNAME: string;
  KEYCLOAK_ADMIN_PASSWORD: string;
};

function loadKeycloakMigrationConfig(): KeycloakMigrationConfig {
  return keycloakMigrationConfigSchema.parse(process.env);
}

function assertKeycloakConfig(config: KeycloakMigrationConfig): asserts config is RequiredKeycloakConfig {
  if (!config.KEYCLOAK_BASE_URL || !config.KEYCLOAK_REALM || !config.KEYCLOAK_ADMIN_USERNAME || !config.KEYCLOAK_ADMIN_PASSWORD) {
    throw new Error("KEYCLOAK_BASE_URL, KEYCLOAK_REALM, KEYCLOAK_ADMIN_USERNAME, and KEYCLOAK_ADMIN_PASSWORD are required for user migration");
  }
}

function buildKeycloakName(user: KeycloakUser): string | null {
  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username || null;
}

function generateTemporaryPassword(): string {
  return `Tmp-${randomBytes(18).toString("base64url")}`;
}
