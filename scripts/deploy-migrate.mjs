import { spawnSync } from "node:child_process";

run("npx", ["prisma", "migrate", "deploy"]);
run("node", ["dist/src/modules/identity/auth/import-old-database-cli.js"]);
run("node", ["dist/src/modules/identity/rbac/sync-cli.js"]);
run("node", ["dist/src/modules/identity/auth/migrate-keycloak-users-cli.js"]);
run("node", ["dist/src/modules/identity/auth/reset-non-admin-passwords-cli.js"]);

function run(command, args) {
  const label = [command, ...args].join(" ");
  console.log(`Running: ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
