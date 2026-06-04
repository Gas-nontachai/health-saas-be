import { createWriteStream } from "node:fs";
import archiver from "archiver";

export async function createBackupZip(zipPath: string, files: Array<{ path: string; name: string }>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

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
