import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type preHandlerHookHandler } from "fastify";
import type { AppConfig } from "./config/index.js";
import { createAuthenticate } from "./modules/identity/auth/authenticate.js";
import { createKeycloakAuthService, type KeycloakAuthService } from "./modules/identity/auth/keycloak.js";
import { createSmtpMailer, type Mailer } from "./modules/identity/auth/mailer.js";
import { createPasswordResetService, type PasswordResetService } from "./modules/identity/auth/password-reset.js";
import { registerAuthRoutes } from "./modules/identity/auth/routes.js";
import { registerBackofficeRoutes } from "./modules/backoffice/routes.js";
import { registerDashboardRoutes } from "./modules/health/dashboard/routes.js";
import { registerExportRoutes } from "./modules/health/export/routes.js";
import { registerHealthRoutes } from "./modules/health/overview/routes.js";
import { registerHealthBloodSugarRoutes } from "./modules/health/blood-sugar/routes.js";
import { registerHealthWeightRoutes } from "./modules/health/weight/routes.js";
import { registerHealthProgressRoutes } from "./modules/health/progress/routes.js";
import { registerProfileRoutes } from "./modules/identity/users/routes.js";
import type { AppPrisma } from "./infra/prisma.js";
import { bootstrapAdminUser } from "./modules/identity/rbac/admin-bootstrap.js";
import { syncPermissions as syncPermissionCatalog } from "./modules/identity/rbac/sync.js";
import { registerRecordRoutes } from "./modules/health/blood-sugar/legacy-records.routes.js";
import { registerErrorHandler } from "./common/errors.js";
import { registerSharedLinkRoutes } from "./modules/health/shared-links/routes.js";

export type BuildAppOptions = {
  config: AppConfig;
  prisma: AppPrisma;
  authenticate?: preHandlerHookHandler;
  keycloakAuth?: KeycloakAuthService;
  mailer?: Mailer;
  passwordReset?: PasswordResetService;
  syncPermissions?: (prisma: AppPrisma) => Promise<unknown>;
  syncPermissionsOnStart?: boolean;
  bootstrapInitialAdmin?: (prisma: AppPrisma, keycloakAuth: KeycloakAuthService) => Promise<unknown>;
  bootstrapInitialAdminOnStart?: boolean;
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
  const shouldSyncPermissions = options.syncPermissionsOnStart ?? options.config.RBAC_SYNC_ON_START;

  if (shouldSyncPermissions) {
    await (options.syncPermissions ?? syncPermissionCatalog)(options.prisma);
  }

  const shouldBootstrapInitialAdmin =
    options.bootstrapInitialAdminOnStart ??
    (options.config.INITIAL_ADMIN_BOOTSTRAP_ON_START && Boolean(options.config.INITIAL_ADMIN_EMAIL && options.config.INITIAL_ADMIN_PASSWORD));

  if (shouldBootstrapInitialAdmin) {
    await (
      options.bootstrapInitialAdmin ??
      (async (prisma, keycloakAuth) => {
        if (!options.config.INITIAL_ADMIN_EMAIL || !options.config.INITIAL_ADMIN_PASSWORD) return;
        await bootstrapAdminUser({
          prisma,
          keycloakAuth,
          email: options.config.INITIAL_ADMIN_EMAIL,
          password: options.config.INITIAL_ADMIN_PASSWORD,
          resetExistingPassword: false
        });
      })
    )(options.prisma, keycloakAuth);
  }

  app.get("/health", async () => ({
    status: "ok",
    uptime: process.uptime()
  }));

  await registerAuthRoutes(app, keycloakAuth, passwordReset);
  await registerRecordRoutes(app, options.prisma);
  await registerProfileRoutes(app, options.prisma, keycloakAuth);
  await registerDashboardRoutes(app, options.prisma);
  await registerHealthBloodSugarRoutes(app, options.prisma);
  await registerHealthWeightRoutes(app, options.prisma);
  await registerHealthRoutes(app, options.prisma);
  await registerHealthProgressRoutes(app, options.prisma);
  await registerExportRoutes(app, options.prisma);
  await registerSharedLinkRoutes(app, options.prisma);
  await registerBackofficeRoutes(app, options.prisma, keycloakAuth);

  return app;
}
