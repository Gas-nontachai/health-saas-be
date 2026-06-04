import { spawn } from "node:child_process";

export type PostgresDumpOptions = {
  pgDumpPath?: string;
};

export async function createPostgresDump(databaseUrl: string, outputPath: string, options: PostgresDumpOptions = {}): Promise<void> {
  const command = options.pgDumpPath ?? "pg_dump";
  await runCommand(command, [databaseUrl, "-f", outputPath]);
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(`${command} was not found. Install PostgreSQL client tools or set BACKUP_PG_DUMP_PATH to the absolute pg_dump binary path.`));
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}
