CREATE TABLE "BackupLog" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "googleDriveFileId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackupLog_status_idx" ON "BackupLog"("status");
CREATE INDEX "BackupLog_triggerType_idx" ON "BackupLog"("triggerType");
CREATE INDEX "BackupLog_startedAt_idx" ON "BackupLog"("startedAt");
CREATE INDEX "BackupLog_createdBy_idx" ON "BackupLog"("createdBy");

ALTER TABLE "BackupLog" ADD CONSTRAINT "BackupLog_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
