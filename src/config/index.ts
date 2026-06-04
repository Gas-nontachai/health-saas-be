import "dotenv/config";
import { z } from "zod";

const optionalNonEmptyString = z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional());
const optionalUrl = z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  KEYCLOAK_BASE_URL: z.string().url().optional(),
  KEYCLOAK_REALM: z.string().min(1).optional(),
  KEYCLOAK_CLIENT_ID: z.string().min(1).optional(),
  KEYCLOAK_CLIENT_SECRET: z.string().optional(),
  KEYCLOAK_ADMIN_USERNAME: z.string().min(1).optional(),
  KEYCLOAK_ADMIN_PASSWORD: z.string().min(1).optional(),
  KEYCLOAK_JWKS_URL: z.string().url().optional(),
  KEYCLOAK_ISSUER: z.string().url().optional(),
  KEYCLOAK_AUDIENCE: z.string().optional(),
  KEYCLOAK_USER_MIGRATION_ON_DEPLOY: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  KEYCLOAK_USER_MIGRATION_FORCE_EMAIL: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM: z.string().min(1).optional(),
  RESET_OTP_SECRET: z.string().min(32).optional(),
  INITIAL_ADMIN_EMAIL: z.string().email().optional(),
  INITIAL_ADMIN_PASSWORD: z.string().min(8).optional(),
  INITIAL_ADMIN_BOOTSTRAP_ON_START: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  RBAC_SYNC_ON_START: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  BACKUP_CRON_SECRET: z.string().min(1).optional(),
  BACKUP_TEMP_DIR: z.string().min(1).default("/tmp/backups"),
  BACKUP_ENVIRONMENT: z.string().min(1).default("development"),
  BACKUP_PG_DUMP_PATH: optionalNonEmptyString,
  BACKUP_INCLUDE_EXCEL: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  BACKUP_INCLUDE_SQL: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SUPABASE_URL: optionalUrl,
  SUPABASE_SERVICE_ROLE_KEY: optionalNonEmptyString,
  SUPABASE_BACKUP_BUCKET: optionalNonEmptyString
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  return envSchema.parse(withDerivedKeycloakEnv(process.env));
}

function withDerivedKeycloakEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const issuerUrl = env.KEYCLOAK_ISSUER ? new URL(env.KEYCLOAK_ISSUER) : undefined;
  const realmFromIssuer = issuerUrl?.pathname.match(/\/realms\/([^/]+)/)?.[1];
  const baseUrlFromIssuer = issuerUrl ? `${issuerUrl.protocol}//${issuerUrl.host}` : undefined;

  return {
    ...env,
    JWT_SECRET: env.JWT_SECRET ?? (env.NODE_ENV === "production" ? undefined : "local-development-jwt-secret-at-least-32-chars"),
    KEYCLOAK_BASE_URL: env.KEYCLOAK_BASE_URL ?? baseUrlFromIssuer,
    KEYCLOAK_REALM: env.KEYCLOAK_REALM ?? realmFromIssuer,
    KEYCLOAK_CLIENT_ID: env.KEYCLOAK_CLIENT_ID ?? env.KEYCLOAK_AUDIENCE
  };
}
