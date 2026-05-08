import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type preHandlerHookHandler } from "fastify";
import type { AppConfig } from "./config.js";
import { createAuthenticate } from "./auth/authenticate.js";
import { createKeycloakAuthService, type KeycloakAuthService } from "./auth/keycloak.js";
import { createSmtpMailer, type Mailer } from "./auth/mailer.js";
import { createPasswordResetService, type PasswordResetService } from "./auth/password-reset.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerDashboardRoutes } from "./dashboard/routes.js";
import { registerExportRoutes } from "./export/routes.js";
import { registerProfileRoutes } from "./profiles/routes.js";
import type { AppPrisma } from "./prisma.js";
import { registerRecordRoutes } from "./records/routes.js";
import { registerErrorHandler } from "./shared/errors.js";
import { registerSharedLinkRoutes } from "./shared-links/routes.js";

export type BuildAppOptions = {
  config: AppConfig;
  prisma: AppPrisma;
  authenticate?: preHandlerHookHandler;
  keycloakAuth?: KeycloakAuthService;
  mailer?: Mailer;
  passwordReset?: PasswordResetService;
  logger?: boolean;
};

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? options.config.NODE_ENV !== "test" });

  registerErrorHandler(app);

  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]
  });
  await app.register(helmet, {
    crossOriginResourcePolicy: { policy: "cross-origin" }
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute"
  });

  app.decorate("authenticate", options.authenticate ?? createAuthenticate(options.config, options.prisma));
  const keycloakAuth = options.keycloakAuth ?? createKeycloakAuthService(options.config);
  const mailer = options.mailer ?? createSmtpMailer(options.config);
  const passwordReset = options.passwordReset ?? createPasswordResetService(options.config, options.prisma, keycloakAuth, mailer);

  app.get("/health", async () => ({
    status: "ok",
    uptime: process.uptime()
  }));

  await registerAuthRoutes(app, keycloakAuth, passwordReset);
  await registerRecordRoutes(app, options.prisma);
  await registerProfileRoutes(app, options.prisma, keycloakAuth);
  await registerDashboardRoutes(app, options.prisma);
  await registerExportRoutes(app, options.prisma);
  await registerSharedLinkRoutes(app, options.prisma);

  return app;
}
