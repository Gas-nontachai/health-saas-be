import { z } from "zod";
const emailSchema = z.string().email().transform((value) => value.toLowerCase());
export const registerSchema = z.object({ email: emailSchema, password: z.string().min(8), firstName: z.string().min(1).max(60).optional(), lastName: z.string().min(1).max(60).optional() });
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1) });
export const resetPasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) });
export const changeRequiredPasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) });
export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export const forgotPasswordConfirmSchema = z.object({ email: emailSchema, otp: z.string().regex(/^\d{6}$/), newPassword: z.string().min(8) });
export const legacyRefreshTokenSchema = z.object({ refreshToken: z.string().min(1) });
