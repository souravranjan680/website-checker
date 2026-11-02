import type { ProjectDetailsDto } from '@whc/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/form-errors';
import { pluralize } from '@/lib/format';
import { useDeleteProject } from './api';

/** "Type the project name to confirm": deleting removes all its websites and scans. */
export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectDetailsDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [typed, setTyped] = useState('');
  const remove = useDeleteProject(project.id);
  const navigate = useNavigate();

  const onDelete = async () => {
    try {
      await remove.mutateAsync(typed);
      toast.success(`Project "${project.name}" deleted.`);
      onOpenChange(false);
      navigate('/projects', { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setTyped('');
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this project?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes <strong>{project.name}</strong>,{' '}
            {pluralize(project.stats.websiteCount, 'website')} and{' '}
            {pluralize(project.stats.scanCount, 'scan')}. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor="confirm-project-name">
            Type <strong className="mx-1">{project.name}</strong> to confirm
          </FieldLabel>
          <Input
            id="confirm-project-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={typed.trim() !== project.name || remove.isPending}
            onClick={() => void onDelete()}
          >
            {remove.isPending ? 'Deleting…' : 'Delete project'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
