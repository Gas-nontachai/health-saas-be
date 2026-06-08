import "dotenv/config";
import { z } from "zod";

const optionalNonEmptyString = z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional());
const optionalUrl = z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  RESEND_API_KEY: optionalNonEmptyString,
  MAIL_FROM: optionalNonEmptyString,
  MAIL_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
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
  return envSchema.parse({
    ...process.env,
    JWT_SECRET: process.env.JWT_SECRET ?? (process.env.NODE_ENV === "production" ? undefined : "local-development-jwt-secret-at-least-32-chars")
  });
}
