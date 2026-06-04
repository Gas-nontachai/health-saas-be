import { fileURLToPath } from "node:url";
import "dotenv/config";
import { prisma } from "../../../infra/prisma.js";
import { ADMIN_ROLE_NAME } from "../rbac/sync.js";
import { hashPassword } from "./passwords.js";

const DEFAULT_PASSWORD = "health1234";
const DEPLOY_FLAG = "RESET_ALL_NON_ADMIN_PASSWORDS_ON_DEPLOY";
const PASSWORD_ENV = "NON_ADMIN_PASSWORD_RESET_PASSWORD";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  try {
    if (!options.force && process.env[DEPLOY_FLAG] !== "true") {
      console.log(`Skipping non-admin password reset because ${DEPLOY_FLAG} is not true.`);
      process.exit(0);
    }

    const result = await resetNonAdminPasswords({
      password: options.password ?? process.env[PASSWORD_ENV] ?? DEFAULT_PASSWORD,
      initialAdminEmail: process.env.INITIAL_ADMIN_EMAIL
    });
    console.log(
      `Non-admin password reset complete. updated=${result.updated} skippedAdmins=${result.skippedAdmins} password=${result.password}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

export async function resetNonAdminPasswords(input: {
  password: string;
  initialAdminEmail?: string;
}): Promise<{ updated: number; skippedAdmins: number; password: string }> {
  const initialAdminEmail = input.initialAdminEmail?.trim().toLowerCase();
  const users = await prisma.user.findMany({
    where: {
      ...(initialAdminEmail ? { email: { not: initialAdminEmail } } : {}),
      roles: {
        none: {
          role: {
            name: ADMIN_ROLE_NAME
          }
        }
      }
    },
    select: {
      id: true
    }
  });

  for (const user of users) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(input.password),
        passwordChangeRequired: false,
        passwordChangedAt: new Date(),
        temporaryPasswordSentAt: null
      }
    });
  }

  return {
    updated: users.length,
    skippedAdmins: initialAdminEmail ? 1 : 0,
    password: input.password
  };
}

function parseArgs(argv: string[]): { help: boolean; force: boolean; password?: string } {
  let help = false;
  let force = false;
  let password: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case "--help":
        help = true;
        break;
      case "--force":
        force = true;
        break;
      case "--password":
        password = requireValue("password", argv[index + 1]);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return { help, force, password };
}

function requireValue(name: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for --${name}`);
  }

  return value;
}

function printHelp(): void {
  console.log(`Reset every non-admin local password to the same value.

Usage:
  npm run password:reset-non-admins -- --force --password health1234

Deploy behavior:
  - This script is called during deploy.
  - It runs only when ${DEPLOY_FLAG}=true.
  - The password defaults to ${PASSWORD_ENV} or ${DEFAULT_PASSWORD}.

Options:
  --force                Run immediately without checking ${DEPLOY_FLAG}.
  --password <value>     Override the reset password.
  --help                 Show this message.`);
}