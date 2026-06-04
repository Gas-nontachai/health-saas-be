import { createReadStream } from "node:fs";
import { google } from "googleapis";

export type GoogleDriveUploadConfig = {
  folderId: string;
  serviceAccountEmail: string;
  privateKey: string;
};

export async function uploadBackupZipToGoogleDrive(config: GoogleDriveUploadConfig, zipPath: string, fileName: string): Promise<string> {
  const auth = new google.auth.JWT({
    email: config.serviceAccountEmail,
    key: config.privateKey,
    scopes: ["https://www.googleapis.com/auth/drive.file"]
  });
  const drive = google.drive({ version: "v3", auth });
  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [config.folderId],
      mimeType: "application/zip"
    },
    media: {
      mimeType: "application/zip",
      body: createReadStream(zipPath)
    },
    fields: "id"
  });

  if (!response.data.id) {
    throw new Error("Google Drive upload response is missing file id");
  }

  return response.data.id;
}
