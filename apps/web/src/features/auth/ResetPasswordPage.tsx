import { zodResolver } from '@hookform/resolvers/zod';
import { passwordSchema, PASSWORD_MIN_LENGTH } from '@whc/shared';
import { AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { TextField } from '@/components/common/form-fields';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { api } from '@/lib/api-client';
import { applyApiErrors } from '@/lib/form-errors';

const formSchema = z
  .object({ newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    error: 'Passwords do not match.',
  });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const onSubmit = form.handleSubmit(async ({ newPassword }) => {
    setFormError(null);
    try {
      await api('/api/auth/reset-password', { method: 'POST', body: { token, newPassword } });
      toast.success('Password changed. Sign in with your new password.');
      navigate('/login', { replace: true });
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, ['newPassword']));
    }
  });

  if (!token) {
    return (
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>This reset link is incomplete</AlertTitle>
        <AlertDescription>
          <Link to="/forgot-password" className="underline">
            Request a new link
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-xl">Choose a new password</h1>
        </CardTitle>
        <CardDescription>You&apos;ll be signed out on all other devices.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            {formError ? (
              <Alert variant="destructive">
                <AlertCircle aria-hidden="true" />
                <AlertDescription>
                  {formError}{' '}
                  <Link to="/forgot-password" className="underline">
                    Request a new link
                  </Link>
                </AlertDescription>
              </Alert>
            ) : null}
            <TextField
              control={form.control}
              name="newPassword"
              label="New password"
              type="password"
              autoComplete="new-password"
              description={`At least ${PASSWORD_MIN_LENGTH} characters.`}
            />
            <TextField
              control={form.control}
              name="confirmPassword"
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
            />
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Saving…' : 'Set new password'}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
