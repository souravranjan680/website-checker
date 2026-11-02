import { z } from 'zod';

/** ?page=1&pageSize=20&q=search for list endpoints. */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

/** Database IDs are cuid strings. */
export const idSchema = z.string().trim().min(1).max(64);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long.')
  .pipe(z.email({ error: 'Enter a valid email address.' }));
