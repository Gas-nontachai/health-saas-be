import { createWriteStream } from "node:fs";
import { createRequire } from "node:module";

type BackupArchiver = {
  on(event: "error", listener: (error: Error) => void): void;
  pipe(destination: NodeJS.WritableStream): void;
  file(path: string, options: { name: string }): void;
  finalize(): Promise<void>;
};

const require = createRequire(import.meta.url);
const { ZipArchive } = require("archiver") as { ZipArchive: new (options: { zlib: { level: number } }) => BackupArchiver };

export async function createBackupZip(zipPath: string, files: Array<{ path: string; name: string }>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);

    archive.pipe(output);
    for (const file of files) {
      archive.file(file.path, { name: file.name });
    }
    archive.finalize().catch(reject);
  });
}
