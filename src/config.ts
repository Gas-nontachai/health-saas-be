import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  KEYCLOAK_BASE_URL: z.string().url(),
  KEYCLOAK_REALM: z.string().min(1),
  KEYCLOAK_CLIENT_ID: z.string().min(1),
  KEYCLOAK_CLIENT_SECRET: z.string().optional(),
  KEYCLOAK_ADMIN_USERNAME: z.string().min(1),
  KEYCLOAK_ADMIN_PASSWORD: z.string().min(1),
  KEYCLOAK_JWKS_URL: z.string().url(),
  KEYCLOAK_ISSUER: z.string().url().optional(),
  KEYCLOAK_AUDIENCE: z.string().optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM: z.string().min(1).optional(),
  RESET_OTP_SECRET: z.string().min(32).optional()
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
    KEYCLOAK_BASE_URL: env.KEYCLOAK_BASE_URL ?? baseUrlFromIssuer,
    KEYCLOAK_REALM: env.KEYCLOAK_REALM ?? realmFromIssuer,
    KEYCLOAK_CLIENT_ID: env.KEYCLOAK_CLIENT_ID ?? env.KEYCLOAK_AUDIENCE
  };
}
