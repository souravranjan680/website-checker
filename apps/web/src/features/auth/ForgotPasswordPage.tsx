import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema } from '@whc/shared';
import { AlertCircle, MailCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { TextField } from '@/components/common/form-fields';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { apiData } from '@/lib/api-client';
import { applyApiErrors } from '@/lib/form-errors';

export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await apiData('/api/auth/forgot-password', { method: 'POST', body: values });
      setSentTo(values.email);
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, ['email']));
    }
  });

  if (sentTo) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MailCheck className="size-5" aria-hidden="true" />
            <h1 className="text-xl">Check your inbox</h1>
          </CardTitle>
          <CardDescription>
            If an account exists for <strong>{sentTo}</strong>, we sent a link to reset your
            password. It works for 30 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {import.meta.env.DEV ? (
            <p className="rounded-md bg-muted p-3 text-muted-foreground">
              Development: emails are caught by Mailpit at{' '}
              <a
                href="http://localhost:8025"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                localhost:8025
              </a>
              .
            </p>
          ) : null}
          <Link to="/login" className="font-medium underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-xl">Forgot your password?</h1>
        </CardTitle>
        <CardDescription>Enter your email and we&apos;ll send you a reset link.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            {formError ? (
              <Alert variant="destructive">
                <AlertCircle aria-hidden="true" />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
            <TextField
              control={form.control}
              name="email"
              label="Email"
              type="email"
              autoComplete="email"
            />
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Sending…' : 'Send reset link'}
            </Button>
            <Link
              to="/login"
              className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Back to sign in
            </Link>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
