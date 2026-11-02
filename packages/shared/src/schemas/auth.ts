import { z } from 'zod';
import { emailSchema } from './common';

export const PASSWORD_MIN_LENGTH = 10;

// A short list of the most-used passwords. Real breaches are full of these.
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password12',
  'password123',
  'password1234',
  'passw0rd123',
  '1234567890',
  '0123456789',
  '123456789a',
  '1q2w3e4r5t',
  'qwertyuiop',
  'qwerty1234',
  'qwerty12345',
  'iloveyou12',
  'letmein123',
  'welcome123',
  'admin12345',
  'administrator',
  'abcdefghij',
  '1111111111',
]);

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(128, 'Use at most 128 characters.')
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), {
    error: 'This password is too common. Choose something harder to guess.',
  });

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter your name.')
  .max(100, 'Use at most 100 characters.');

/** Fields without cross-field rules, so the frontend can extend it (e.g. confirmPassword). */
export const registerFieldsSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const registerSchema = registerFieldsSchema.refine(
  (data) => data.password.toLowerCase() !== data.email,
  { path: ['password'], error: 'Your password must not be your email address.' },
);
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // No strength rules at login: only "is something there".
  password: z.string().min(1, 'Enter your password.').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(20, 'This reset link is invalid.').max(200),
  newPassword: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(128),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({ name: nameSchema });
