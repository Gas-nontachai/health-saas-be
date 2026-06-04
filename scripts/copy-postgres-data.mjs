import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import dotenv from "dotenv";

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

loadEnvFile(options.envFile);

const sourceUrl = ensureSslMode(
  options.sourceUrl ?? process.env.SOURCE_DATABASE_URL ?? process.env.OLD_DATABASE_URL
);
const targetUrl = ensureSslMode(
  options.targetUrl ?? process.env.TARGET_DIRECT_URL ?? process.env.DIRECT_URL
);
const schema = options.schema ?? "public";
const includePrismaMigrations = Boolean(options.includePrismaMigrations);
const shouldTruncateTarget = !options.keepTargetData;

if (!sourceUrl) {
  fail("Missing source database URL. Pass --source-url or set SOURCE_DATABASE_URL/OLD_DATABASE_URL.");
}

if (!targetUrl) {
  fail("Missing target database URL. Pass --target-url or set TARGET_DIRECT_URL/DIRECT_URL.");
}

const postgresBinDir = resolvePostgresBinDir(process.env.BACKUP_PG_DUMP_PATH);
const pgDump = resolveCommand(postgresBinDir, "pg_dump");
const pgRestore = resolveCommand(postgresBinDir, "pg_restore");
const psql = resolveCommand(postgresBinDir, "psql");

assertCommandAvailable(pgDump, ["--version"]);
assertCommandAvailable(pgRestore, ["--version"]);
assertCommandAvailable(psql, ["--version"]);

const excludedTable = `${schema}._prisma_migrations`;
const tableNames = readTableNames({
  psql,
  sourceUrl,
  schema,
  includePrismaMigrations
});

if (tableNames.length === 0) {
  console.log(`No tables found in schema ${schema}. Nothing to copy.`);
  process.exit(0);
}

const tempDir = mkdtempSync(join(tmpdir(), "health-saas-copy-"));
const dumpFile = join(tempDir, `${schema}.dump`);

try {
  console.log(`Dumping ${tableNames.length} tables from ${schema} schema...`);
  const dumpArgs = [
    "--dbname",
    sourceUrl,
    "--format=custom",
    "--data-only",
    "--no-owner",
    "--no-privileges",
    "--schema",
    schema,
    "--file",
    dumpFile
  ];

  if (!includePrismaMigrations) {
    dumpArgs.push("--exclude-table", excludedTable);
  }

  run(pgDump, dumpArgs);

  if (shouldTruncateTarget) {
    console.log(`Truncating target tables in ${schema} schema...`);
    const truncateSql = `TRUNCATE TABLE ${tableNames.join(", ")} RESTART IDENTITY CASCADE;`;
    run(psql, ["--dbname", targetUrl, "-v", "ON_ERROR_STOP=1", "-c", truncateSql]);
  }

  console.log("Restoring data into target database...");
  run(pgRestore, [
    "--dbname",
    targetUrl,
    "--data-only",
    "--no-owner",
    "--no-privileges",
    "--disable-triggers",
    dumpFile
  ]);

  console.log("Data copy completed successfully.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      fail(`Unknown argument: ${argument}`);
    }

    const key = argument.slice(2);
    const nextValue = argv[index + 1];

    switch (key) {
      case "help":
        parsed.help = true;
        break;
      case "keep-target-data":
        parsed.keepTargetData = true;
        break;
      case "include-prisma-migrations":
        parsed.includePrismaMigrations = true;
        break;
      case "source-url":
        parsed.sourceUrl = requireValue(key, nextValue);
        index += 1;
        break;
      case "target-url":
        parsed.targetUrl = requireValue(key, nextValue);
        index += 1;
        break;
      case "env-file":
        parsed.envFile = requireValue(key, nextValue);
        index += 1;
        break;
      case "schema":
        parsed.schema = requireValue(key, nextValue);
        index += 1;
        break;
      default:
        fail(`Unknown argument: --${key}`);
    }
  }

  return parsed;
}

function requireValue(key, value) {
  if (!value || value.startsWith("--")) {
    fail(`Missing value for --${key}`);
  }

  return value;
}

function loadEnvFile(envFile) {
  if (!envFile) {
    return;
  }

  const envPath = resolve(process.cwd(), envFile);
  if (!existsSync(envPath)) {
    fail(`Env file not found: ${envPath}`);
  }

  dotenv.config({ path: envPath, override: false });
}

function resolvePostgresBinDir(pgDumpPath) {
  if (!pgDumpPath) {
    return null;
  }

  const absolutePath = resolve(pgDumpPath);
  if (!existsSync(absolutePath)) {
    return null;
  }

  return dirname(absolutePath);
}

function resolveCommand(binDir, commandName) {
  if (!binDir) {
    return commandName;
  }

  const commandPath = join(binDir, commandName);
  return existsSync(commandPath) ? commandPath : commandName;
}

function assertCommandAvailable(command, args) {
  const result = spawnSync(command, args, {
    stdio: "ignore",
    shell: process.platform === "win32"
  });

  if ((result.status ?? 1) !== 0) {
    fail(`Required command is not available: ${command}`);
  }
}

function readTableNames({ psql, sourceUrl, schema, includePrismaMigrations }) {
  const query = [
    "SELECT quote_ident(schemaname) || '.' || quote_ident(tablename)",
    "FROM pg_tables",
    `WHERE schemaname = '${escapeSqlLiteral(schema)}'`,
    includePrismaMigrations ? "" : "AND tablename <> '_prisma_migrations'",
    "ORDER BY 1"
  ]
    .filter(Boolean)
    .join(" ");

  const result = spawnSync(
    psql,
    ["--dbname", sourceUrl, "-v", "ON_ERROR_STOP=1", "-At", "-c", query],
    {
      encoding: "utf8",
      shell: process.platform === "win32"
    }
  );

  if ((result.status ?? 1) !== 0) {
    process.stderr.write(result.stderr ?? "");
    fail("Unable to list source tables.");
  }

  return (result.stdout ?? "")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
}

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

function ensureSslMode(connectionString) {
  if (!connectionString) {
    return connectionString;
  }

  const url = new URL(connectionString);
  if (!url.searchParams.has("sslmode")) {
    url.searchParams.set("sslmode", "require");
  }
  return url.toString();
}

function escapeSqlLiteral(value) {
  return value.replaceAll("'", "''");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`Copy application data from one PostgreSQL database into another.

Usage:
  npm run db:copy -- --env-file .env.prod --source-url <postgres-url>

Options:
  --source-url <url>                Source PostgreSQL connection string.
  --target-url <url>                Target PostgreSQL connection string. Defaults to DIRECT_URL.
  --env-file <path>                 Optional env file to load before reading URLs.
  --schema <name>                   Schema to copy. Defaults to public.
  --keep-target-data                Do not truncate target tables before restore.
  --include-prisma-migrations       Also copy the _prisma_migrations table.
  --help                            Show this message.

Environment fallback order:
  source: SOURCE_DATABASE_URL -> OLD_DATABASE_URL
  target: TARGET_DIRECT_URL -> DIRECT_URL

Notes:
  - The target should be the direct PostgreSQL URL, not the Supabase pooler URL.
  - pg_dump, pg_restore, and psql must be installed and available in PATH.
  - BACKUP_PG_DUMP_PATH can point at your local libpq installation and will be used to resolve the other PostgreSQL binaries.`);
}