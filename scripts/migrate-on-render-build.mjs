import { spawnSync } from "node:child_process";

if (process.env.SKIP_PRISMA_MIGRATE === "1") {
  console.log("Skipping Prisma migration because SKIP_PRISMA_MIGRATE=1.");
  process.exit(0);
}

const shouldRunMigration = process.env.NODE_ENV === "production" && Boolean(process.env.DATABASE_URL);

if (!shouldRunMigration) {
  console.log("Skipping Prisma migration during build.");
  process.exit(0);
}

console.log("Running Prisma migrations during production build.");

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: process.platform === "win32"
});

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

console.log("Syncing permission catalog.");

const syncResult = spawnSync("node", ["dist/src/rbac/sync-cli.js"], {
  stdio: "inherit",
  shell: process.platform === "win32"
});

process.exit(syncResult.status ?? 1);
