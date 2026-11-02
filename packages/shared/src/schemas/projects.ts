import { z } from 'zod';
import { PROJECT_ROLES } from '../dto';
import { emailSchema } from './common';

export const projectNameSchema = z
  .string()
  .trim()
  .min(2, 'Use at least 2 characters.')
  .max(80, 'Use at most 80 characters.');

export const projectDescriptionSchema = z.string().trim().max(500, 'Use at most 500 characters.');

export const createProjectSchema = z.object({
  name: projectNameSchema,
  description: projectDescriptionSchema.optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema
  .partial()
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    error: 'Nothing to update.',
  });
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/** Deleting a project needs its exact name typed again, which prevents accidents. */
export const deleteProjectSchema = z.object({
  confirmName: z.string().min(1, 'Type the project name to confirm.'),
});

export const projectRoleSchema = z.enum(PROJECT_ROLES, { error: 'Choose a valid role.' });

export const addMemberSchema = z.object({
  email: emailSchema,
  role: projectRoleSchema,
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const updateMemberSchema = z.object({ role: projectRoleSchema });
