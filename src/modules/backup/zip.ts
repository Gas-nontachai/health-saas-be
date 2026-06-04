import { createWriteStream } from "node:fs";
import { createRequire } from "node:module";
import type { Archiver } from "archiver";

const require = createRequire(import.meta.url);
const { ZipArchive } = require("archiver") as { ZipArchive: new (options: { zlib: { level: number } }) => Archiver };

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
