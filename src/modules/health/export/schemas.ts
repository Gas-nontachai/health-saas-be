import { z } from "zod";
export const exportQuerySchema = z.object({ type: z.enum(["excel", "pdf"]) });
export type ExportQuery = z.infer<typeof exportQuerySchema>;
