import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_MIN_LENGTH, registerFieldsSchema } from '@whc/shared';
import { AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { TextField } from '@/components/common/form-fields';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { applyApiErrors } from '@/lib/form-errors';
import { useAuth } from './auth-context';

// The API's rules plus a "type it twice" field that only the browser needs.
const formSchema = registerFieldsSchema
  .extend({ confirmPassword: z.string() })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    error: 'Passwords do not match.',
  })
  .refine((data) => data.password.toLowerCase() !== data.email, {
    path: ['password'],
    error: 'Your password must not be your email address.',
  });

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
  });

  const onSubmit = form.handleSubmit(async ({ name, email, password }) => {
    setFormError(null);
    try {
      const user = await register({ name, email, password });
      toast.success(`Welcome, ${user.name}! Create your first project to get started.`);
      navigate('/projects', { replace: true });
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, ['name', 'email', 'password']));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-xl">Create an account</h1>
        </CardTitle>
        <CardDescription>
          Start checking your websites for accessibility and UI issues.
        </CardDescription>
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
            <TextField control={form.control} name="name" label="Name" autoComplete="name" />
            <TextField
              control={form.control}
              name="email"
              label="Email"
              type="email"
              autoComplete="email"
            />
            <TextField
              control={form.control}
              name="password"
              label="Password"
              type="password"
              autoComplete="new-password"
              description={`At least ${PASSWORD_MIN_LENGTH} characters. A short sentence works well.`}
            />
            <TextField
              control={form.control}
              name="confirmPassword"
              label="Confirm password"
              type="password"
              autoComplete="new-password"
            />
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Creating account…' : 'Create account'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link
                to="/login"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
            </p>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
