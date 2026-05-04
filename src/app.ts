import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type preHandlerHookHandler } from "fastify";
import type { AppConfig } from "./config.js";
import { createAuthenticate } from "./auth/authenticate.js";
import { createKeycloakAuthService, type KeycloakAuthService } from "./auth/keycloak.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerDashboardRoutes } from "./dashboard/routes.js";
import { registerExportRoutes } from "./export/routes.js";
import { registerProfileRoutes } from "./profiles/routes.js";
import type { AppPrisma } from "./prisma.js";
import { registerRecordRoutes } from "./records/routes.js";
import { registerErrorHandler } from "./shared/errors.js";

export type BuildAppOptions = {
  config: AppConfig;
  prisma: AppPrisma;
  authenticate?: preHandlerHookHandler;
  keycloakAuth?: KeycloakAuthService;
  logger?: boolean;
};

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? options.config.NODE_ENV !== "test" });

  registerErrorHandler(app);

  await app.register(helmet);
  await app.register(cors);
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute"
  });

  app.decorate("authenticate", options.authenticate ?? createAuthenticate(options.config, options.prisma));

  app.get("/health", async () => ({
    status: "ok",
    uptime: process.uptime()
  }));

  await registerAuthRoutes(app, options.keycloakAuth ?? createKeycloakAuthService(options.config));
  await registerRecordRoutes(app, options.prisma);
  await registerProfileRoutes(app, options.prisma);
  await registerDashboardRoutes(app, options.prisma);
  await registerExportRoutes(app, options.prisma);

  return app;
}
