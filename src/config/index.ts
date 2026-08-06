import "dotenv/config";
import { z } from "zod";

const optionalNonEmptyString = z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional());
const optionalUrl = z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional());
const booleanString = (defaultValue: "true" | "false") => z.enum(["true", "false"]).default(defaultValue).transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  AUTH_ALLOWED_ORIGINS: z.string().default("http://localhost:5173"),
  AUTH_REFRESH_COOKIE_NAME: z.string().min(1).default("refresh_token"),
  AUTH_REFRESH_COOKIE_PATH: z.string().startsWith("/").default("/auth"),
  AUTH_REFRESH_COOKIE_DOMAIN: optionalNonEmptyString,
  AUTH_REFRESH_COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  AUTH_REFRESH_COOKIE_SECURE: booleanString("false"),
  AUTH_LEGACY_JSON_REFRESH_ENABLED: booleanString("true"),
  AUTH_SESSION_CLEANUP_RETENTION_SECONDS: z.coerce.number().int().nonnegative().default(60 * 60 * 24 * 7),
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
}).superRefine((config, context) => {
  if (config.NODE_ENV === "production" && !config.AUTH_REFRESH_COOKIE_SECURE) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["AUTH_REFRESH_COOKIE_SECURE"], message: "must be true in production" });
  }
  if (config.AUTH_REFRESH_COOKIE_SAME_SITE === "none" && !config.AUTH_REFRESH_COOKIE_SECURE) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["AUTH_REFRESH_COOKIE_SECURE"], message: "must be true when SameSite=None" });
  }
  if (config.AUTH_ALLOWED_ORIGINS.split(",").some((origin) => origin.trim() === "*")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["AUTH_ALLOWED_ORIGINS"], message: "must not contain wildcard origins" });
  }
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const isProduction = process.env.NODE_ENV === "production";
  return envSchema.parse({
    ...process.env,
    AUTH_REFRESH_COOKIE_SAME_SITE: process.env.AUTH_REFRESH_COOKIE_SAME_SITE ?? (isProduction ? "none" : "lax"),
    AUTH_REFRESH_COOKIE_SECURE: process.env.AUTH_REFRESH_COOKIE_SECURE ?? (isProduction ? "true" : "false"),
    JWT_SECRET: process.env.JWT_SECRET ?? (process.env.NODE_ENV === "production" ? undefined : "local-development-jwt-secret-at-least-32-chars")
  });
}
