import { zodResolver } from '@hookform/resolvers/zod';
import { addMemberSchema, PROJECT_ROLES, type ProjectRole } from '@whc/shared';
import { UserMinus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { SelectField, TextField } from '@/components/common/form-fields';
import { ErrorState } from '@/components/common/ErrorState';
import { ROLE_DESCRIPTIONS, RoleBadge } from '@/components/common/RoleBadge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/auth-context';
import { applyApiErrors, errorMessage } from '@/lib/form-errors';
import { useAddMember, useProjectMembers, useRemoveMember, useUpdateMemberRole } from './api';

const ROLE_OPTIONS = PROJECT_ROLES.map((role) => ({
  value: role,
  label: `${role.charAt(0)}${role.slice(1).toLowerCase()}: ${ROLE_DESCRIPTIONS[role]}`,
}));

/** Members list. Owners can add people, change roles and remove members. */
export function MembersCard({ projectId, myRole }: { projectId: string; myRole: ProjectRole }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const members = useProjectMembers(projectId);
  const updateRole = useUpdateMemberRole(projectId);
  const removeMember = useRemoveMember(projectId);
  const isOwner = myRole === 'OWNER';

  const changeRole = async (userId: string, role: ProjectRole) => {
    try {
      await updateRole.mutateAsync({ userId, role });
      toast.success('Role updated.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = async (userId: string, name: string) => {
    const leaving = userId === user?.id;
    if (!window.confirm(leaving ? 'Leave this project?' : `Remove ${name} from this project?`))
      return;
    try {
      await removeMember.mutateAsync(userId);
      toast.success(leaving ? 'You left the project.' : `${name} was removed.`);
      if (leaving) navigate('/projects', { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          {isOwner
            ? 'Owners manage who can access this project.'
            : 'People who can access this project.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {members.isPending ? (
          <Skeleton className="h-24" />
        ) : members.isError ? (
          <ErrorState error={members.error} onRetry={() => void members.refetch()} />
        ) : (
          <ul className="divide-y">
            {members.data.map((member) => (
              <li key={member.userId} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.name}
                    {member.userId === user?.id ? (
                      <span className="text-muted-foreground"> (you)</span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </div>
                {isOwner ? (
                  <NativeSelect
                    aria-label={`Role of ${member.name}`}
                    value={member.role}
                    disabled={updateRole.isPending}
                    onChange={(event) =>
                      void changeRole(member.userId, event.target.value as ProjectRole)
                    }
                  >
                    {PROJECT_ROLES.map((role) => (
                      <NativeSelectOption key={role} value={role}>
                        {role.charAt(0) + role.slice(1).toLowerCase()}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                ) : (
                  <RoleBadge role={member.role} />
                )}
                {isOwner || member.userId === user?.id ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                      member.userId === user?.id ? 'Leave project' : `Remove ${member.name}`
                    }
                    onClick={() => void remove(member.userId, member.name)}
                  >
                    <UserMinus aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {isOwner ? (
          <>
            <Separator />
            <AddMemberForm projectId={projectId} />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AddMemberForm({ projectId }: { projectId: string }) {
  const addMember = useAddMember(projectId);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { email: '', role: 'VIEWER' as ProjectRole },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const member = await addMember.mutateAsync(values);
      toast.success(`${member.name} added as ${member.role.toLowerCase()}.`);
      form.reset({ email: '', role: values.role });
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, ['email', 'role']));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-3">
      <p className="text-sm font-medium">Add a member</p>
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}
      <TextField
        control={form.control}
        name="email"
        label="Email"
        type="email"
        placeholder="colleague@company.com"
        description="They need an account already."
      />
      <SelectField control={form.control} name="role" label="Role" options={ROLE_OPTIONS} />
      <Button
        type="submit"
        variant="secondary"
        disabled={form.formState.isSubmitting}
        className="justify-self-start"
      >
        {form.formState.isSubmitting ? 'Adding…' : 'Add member'}
      </Button>
    </form>
  );
}
