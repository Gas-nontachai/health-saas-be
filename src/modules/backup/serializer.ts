type BackupLogLike = {
  id: string;
  status: string;
  triggerType: string;
  fileName: string | null;
  fileSize: number | null;
  googleDriveFileId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  errorMessage: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeBackupLog(log: BackupLogLike) {
  return {
    id: log.id,
    status: log.status,
    triggerType: log.triggerType,
    fileName: log.fileName,
    fileSize: log.fileSize,
    googleDriveFileId: log.googleDriveFileId,
    startedAt: log.startedAt.toISOString(),
    finishedAt: log.finishedAt?.toISOString() ?? null,
    errorMessage: log.errorMessage,
    createdBy: log.createdBy,
    createdAt: log.createdAt.toISOString(),
    updatedAt: log.updatedAt.toISOString()
  };
}
