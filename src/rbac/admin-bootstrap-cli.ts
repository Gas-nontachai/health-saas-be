import { createKeycloakAuthService } from "../auth/keycloak.js";
import { loadConfig } from "../config.js";
import { prisma } from "../prisma.js";
import { bootstrapInitialAdmin, syncPermissions } from "./sync.js";

const config = loadConfig();

if (!config.INITIAL_ADMIN_EMAIL || !config.INITIAL_ADMIN_PASSWORD) {
  throw new Error("INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD are required for admin bootstrap");
}

const keycloakAuth = createKeycloakAuthService(config);
const email = config.INITIAL_ADMIN_EMAIL.toLowerCase();

try {
  await syncPermissions(prisma);

  let keycloakUser = await keycloakAuth.findUserByEmail(email);
  if (!keycloakUser) {
    await keycloakAuth.register({
      email,
      password: config.INITIAL_ADMIN_PASSWORD,
      firstName: "Admin",
      lastName: "User"
    });
    keycloakUser = await keycloakAuth.findUserByEmail(email);
  } else {
    await keycloakAuth.setPassword(keycloakUser.id, config.INITIAL_ADMIN_PASSWORD);
  }

  if (!keycloakUser) {
    throw new Error(`Unable to create or find Keycloak admin user: ${email}`);
  }

  const user = await prisma.user.upsert({
    where: { keycloakId: keycloakUser.id },
    update: {
      email,
      name: keycloakUser.username ?? "Admin User"
    },
    create: {
      keycloakId: keycloakUser.id,
      email,
      name: keycloakUser.username ?? "Admin User",
      profile: {
        create: {}
      }
    }
  });

  await bootstrapInitialAdmin(prisma, user.id, email, email);

  console.log(`Bootstrapped admin user: ${email}`);
} finally {
  await prisma.$disconnect();
}
