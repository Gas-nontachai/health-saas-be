import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { prisma } from "../../../infra/prisma.js";
import { hashPassword } from "./passwords.js";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  try {
    const result = await resetTemporaryPassword(options.email);
    console.log(`Temporary password reset for ${result.email}`);
    console.log(`temporaryPassword=${result.temporaryPassword}`);
    console.log("passwordChangeRequired=true");
  } finally {
    await prisma.$disconnect();
  }
}

export async function resetTemporaryPassword(email: string): Promise<{ email: string; temporaryPassword: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("Email is required");
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true, email: true } });
  if (!user) {
    throw new Error(`User not found for email: ${normalizedEmail}`);
  }

  const temporaryPassword = generateTemporaryPassword();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(temporaryPassword),
      passwordChangeRequired: true,
      passwordChangedAt: null,
      temporaryPasswordSentAt: null
    }
  });

  return { email: user.email, temporaryPassword };
}

function generateTemporaryPassword(): string {
  return `Tmp-${randomBytes(18).toString("base64url")}`;
}

function parseArgs(argv: string[]): { email: string; help: boolean } {
  let email = "";
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case "--help":
        help = true;
        break;
      case "--email":
        email = requireValue("email", argv[index + 1]);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!help && !email) {
    throw new Error("Missing required argument: --email");
  }

  return { email, help };
}

function requireValue(name: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for --${name}`);
  }

  return value;
}

function printHelp(): void {
  console.log(`Reset a user's local temporary password and print the new value.

Usage:
  npm run password:reset-temp -- --email user@example.com

Options:
  --email <email>   User email to reset.
  --help            Show this message.`);
}