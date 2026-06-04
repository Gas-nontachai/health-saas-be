import { z } from "zod";
import { BACKUP_STATUSES, BACKUP_TRIGGER_TYPES } from "./types.js";

export const backupLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(BACKUP_STATUSES).optional(),
  triggerType: z.enum(BACKUP_TRIGGER_TYPES).optional()
});

export type BackupLogsQuery = z.infer<typeof backupLogsQuerySchema>;
