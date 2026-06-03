import type { KeycloakAuthService } from "../auth/keycloak.js";
import type { AppPrisma } from "../../../infra/prisma.js";
import { bootstrapInitialAdmin } from "./sync.js";

export type BootstrapAdminInput = {
  prisma: AppPrisma;
  keycloakAuth: KeycloakAuthService;
  email: string;
  password: string;
  resetExistingPassword?: boolean;
};

export type BootstrapAdminResult = {
  email: string;
  createdKeycloakUser: boolean;
  resetPassword: boolean;
};

export async function bootstrapAdminUser(input: BootstrapAdminInput): Promise<BootstrapAdminResult> {
  const email = input.email.toLowerCase();
  let keycloakUser = await input.keycloakAuth.findUserByEmail(email);
  let createdKeycloakUser = false;
  let resetPassword = false;

  if (!keycloakUser) {
    await input.keycloakAuth.register({
      email,
      password: input.password,
      firstName: "Admin",
      lastName: "User"
    });
    keycloakUser = await input.keycloakAuth.findUserByEmail(email);
    createdKeycloakUser = true;
  } else if (input.resetExistingPassword) {
    await input.keycloakAuth.setPassword(keycloakUser.id, input.password);
    resetPassword = true;
  }

  if (!keycloakUser) {
    throw new Error(`Unable to create or find Keycloak admin user: ${email}`);
  }

  const user = await input.prisma.user.upsert({
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

  await bootstrapInitialAdmin(input.prisma, user.id, email, email);

  return { email, createdKeycloakUser, resetPassword };
}
