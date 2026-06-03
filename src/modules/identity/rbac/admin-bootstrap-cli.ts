import { createKeycloakAuthService } from "../auth/keycloak.js";
import { loadConfig } from "../../../config/index.js";
import { prisma } from "../../../infra/prisma.js";
import { bootstrapAdminUser } from "./admin-bootstrap.js";
import { syncPermissions } from "./sync.js";

const config = loadConfig();

if (!config.INITIAL_ADMIN_EMAIL || !config.INITIAL_ADMIN_PASSWORD) {
  throw new Error("INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD are required for admin bootstrap");
}

const keycloakAuth = createKeycloakAuthService(config);
const email = config.INITIAL_ADMIN_EMAIL.toLowerCase();

try {
  await syncPermissions(prisma);

  await bootstrapAdminUser({
    prisma,
    keycloakAuth,
    email,
    password: config.INITIAL_ADMIN_PASSWORD,
    resetExistingPassword: true
  });

  console.log(`Bootstrapped admin user: ${email}`);
} finally {
  await prisma.$disconnect();
}
