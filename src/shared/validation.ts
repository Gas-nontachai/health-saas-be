import { z } from "zod";

export const idParamsSchema = z.object({
  id: z.string().uuid()
});

export const isoDatetimeSchema = z.string().datetime({ offset: true });

export const bloodSugarSchema = z.number().int().min(20).max(600);
