import { zodResolver } from '@hookform/resolvers/zod';
import { createProjectSchema, type ProjectDetailsDto } from '@whc/shared';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { TextareaField, TextField } from '@/components/common/form-fields';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import { applyApiErrors } from '@/lib/form-errors';
import { useCreateProject, useUpdateProject } from './api';

/** Create a new project, or edit an existing one when `project` is given. */
export function ProjectFormDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: ProjectDetailsDto;
}) {
  const navigate = useNavigate();
  const create = useCreateProject();
  const update = useUpdateProject(project?.id ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { name: project?.name ?? '', description: project?.description ?? '' },
  });

  useEffect(() => {
    if (open) {
      form.reset({ name: project?.name ?? '', description: project?.description ?? '' });
      setFormError(null);
    }
  }, [open, project, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (project) {
        await update.mutateAsync({ name: values.name, description: values.description ?? '' });
        toast.success('Project updated.');
        onOpenChange(false);
      } else {
        const created = await create.mutateAsync(values);
        toast.success(`Project "${created.name}" created.`);
        onOpenChange(false);
        navigate(`/projects/${created.id}`);
      }
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, ['name', 'description']));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-6">
          <DialogHeader>
            <DialogTitle>{project ? 'Edit project' : 'New project'}</DialogTitle>
            <DialogDescription>
              Projects group related websites and the people who work on them.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {formError ? (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
            <TextField
              control={form.control}
              name="name"
              label="Name"
              placeholder="e.g. Marketing sites"
            />
            <TextareaField
              control={form.control}
              name="description"
              label="Description (optional)"
              rows={3}
              placeholder="What do these websites have in common?"
            />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting
                ? 'Saving…'
                : project
                  ? 'Save changes'
                  : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
