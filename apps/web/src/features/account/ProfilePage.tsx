import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema, PASSWORD_MIN_LENGTH, updateProfileSchema } from '@whc/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { TextField } from '@/components/common/form-fields';
import { PageHeader } from '@/components/common/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { useAuth } from '@/features/auth/auth-context';
import { applyApiErrors } from '@/lib/form-errors';
import { formatDateTime } from '@/lib/format';
import { useChangePassword, useUpdateProfile } from './api';

/** Name, password and account details (PATCH /api/auth/me, POST /api/auth/change-password). */
export function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="Profile" description="Your name, password and account details." />
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Email</dt>
              <dd>{user.email}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Account type</dt>
              <dd>
                {user.role === 'ADMIN' ? (
                  <Badge variant="secondary">Administrator</Badge>
                ) : (
                  'Standard user'
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Member since</dt>
              <dd>{formatDateTime(user.createdAt)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            The email address can&apos;t be changed yet (it would need re-verification).
          </p>
        </CardContent>
      </Card>
      <NameForm name={user.name} />
      <PasswordForm />
    </div>
  );
}

function NameForm({ name }: { name: string }) {
  const update = useUpdateProfile();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(updateProfileSchema), defaultValues: { name } });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { user } = await update.mutateAsync(values);
      form.reset({ name: user.name });
      toast.success('Name updated.');
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, ['name']));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Name</CardTitle>
        <CardDescription>Shown to people in your projects and in the activity log.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            {formError ? (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
            <TextField control={form.control} name="name" label="Full name" autoComplete="name" />
            <Button
              type="submit"
              className="w-fit"
              disabled={form.formState.isSubmitting || !form.formState.isDirty}
            >
              {form.formState.isSubmitting ? 'Saving…' : 'Save name'}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

const passwordFormSchema = changePasswordSchema
  .extend({ confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The passwords do not match.',
  });

function PasswordForm() {
  const change = useChangePassword();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    setFormError(null);
    try {
      await change.mutateAsync({ currentPassword, newPassword });
      form.reset();
      toast.success('Password changed. Your other devices have been signed out.');
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, ['currentPassword', 'newPassword']));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          At least {PASSWORD_MIN_LENGTH} characters. Changing it signs you out on every other
          device.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            {formError ? (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
            <TextField
              control={form.control}
              name="currentPassword"
              label="Current password"
              type="password"
              autoComplete="current-password"
            />
            <TextField
              control={form.control}
              name="newPassword"
              label="New password"
              type="password"
              autoComplete="new-password"
            />
            <TextField
              control={form.control}
              name="confirmPassword"
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
            />
            <Button type="submit" className="w-fit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Changing…' : 'Change password'}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
