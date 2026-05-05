import { z } from "zod";

export const idParamsSchema = z.object({
  id: z.string().uuid()
});

export const isoDatetimeSchema = z.string().datetime({ offset: true });

export const bloodSugarSchema = z
  .number()
  .int()
  .refine((value) => value === 0 || (value >= 20 && value <= 600), {
    message: "Blood sugar must be 0 or between 20 and 600"
  });
