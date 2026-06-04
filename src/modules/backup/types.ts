export const BACKUP_STATUSES = ["pending", "running", "success", "failed"] as const;
export const BACKUP_TRIGGER_TYPES = ["scheduled", "manual"] as const;

export type BackupStatus = (typeof BACKUP_STATUSES)[number];
export type BackupTriggerType = (typeof BACKUP_TRIGGER_TYPES)[number];

export type BackupRunResult =
  | {
      message: string;
      backupId: string;
      fileName: string;
      status: "success";
    }
  | {
      message: string;
      backupId: string;
      status: "failed";
      error: string;
    }
  | {
      message: string;
      status: "running";
    };

export type BackupManifest = {
  backupAt: string;
  environment: string;
  type: BackupTriggerType;
  databaseProvider: "postgresql";
  files: Array<{ name: string; type: "sql_dump" | "excel_export" }>;
  status: "success";
};
