import type { AppPrisma } from "../../../infra/prisma.js";
import { hashPassword } from "../auth/passwords.js";
import { bootstrapInitialAdmin } from "./sync.js";

export type BootstrapAdminInput = {
  prisma: AppPrisma;
  email: string;
  password: string;
  resetExistingPassword?: boolean;
};

export type BootstrapAdminResult = {
  email: string;
  createdUser: boolean;
  resetPassword: boolean;
};

export async function bootstrapAdminUser(input: BootstrapAdminInput): Promise<BootstrapAdminResult> {
  const email = input.email.toLowerCase();
  const existing = await input.prisma.user.findUnique({ where: { email } });
  const passwordHash = await hashPassword(input.password);
  let createdUser = false;
  let resetPassword = false;

  const user = existing
    ? await input.prisma.user.update({
        where: { id: existing.id },
        data: input.resetExistingPassword || !existing.passwordHash ? { passwordHash, passwordChangeRequired: false, passwordChangedAt: new Date() } : {}
      })
    : await input.prisma.user.create({
        data: {
          email,
          name: "Admin User",
          passwordHash,
          passwordChangedAt: new Date(),
          profile: { create: {} }
        }
      });

  createdUser = !existing;
  resetPassword = Boolean(existing && input.resetExistingPassword);
  await bootstrapInitialAdmin(input.prisma, user.id, email, email);

  return { email, createdUser, resetPassword };
}
