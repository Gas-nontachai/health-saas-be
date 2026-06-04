import { readFile } from "node:fs/promises";

export type SupabaseBackupStorageConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket: string;
  environment: string;
};

export async function uploadBackupZipToSupabaseStorage(config: SupabaseBackupStorageConfig, zipPath: string, fileName: string, backupId: string, backupAt: Date): Promise<string> {
  const objectPath = buildBackupObjectPath(config.environment, backupAt, backupId, fileName);
  const body = await readFile(zipPath);
  const uploadUrl = new URL(`/storage/v1/object/${encodePathSegment(config.bucket)}/${encodeObjectPath(objectPath)}`, normalizedSupabaseUrl(config.supabaseUrl));
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      authorization: `Bearer ${config.serviceRoleKey}`,
      "cache-control": "no-store",
      "content-type": "application/zip",
      "x-upsert": "false"
    },
    body
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(normalizeSupabaseStorageError(response.status, message));
  }

  return objectPath;
}

export function buildBackupObjectPath(environment: string, backupAt: Date, backupId: string, fileName: string): string {
  const iso = backupAt.toISOString();
  return ["backups", safePathSegment(environment), iso.slice(0, 4), iso.slice(5, 7), safePathSegment(backupId), safePathSegment(fileName)].join("/");
}

function normalizedSupabaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function encodeObjectPath(value: string): string {
  return value.split("/").map(encodePathSegment).join("/");
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalizeSupabaseStorageError(status: number, message: string): string {
  const compactMessage = message.replace(/\s+/g, " ").trim().slice(0, 300);
  return compactMessage ? `Supabase Storage upload failed with ${status}: ${compactMessage}` : `Supabase Storage upload failed with ${status}`;
}
