import type { NotificationPreferences, SessionDto } from '@whc/shared';
import { Laptop, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useTheme, type Theme } from '@/app/theme';
import { errorMessage } from '@/lib/form-errors';
import { describeDevice, formatDateTime, formatRelative } from '@/lib/format';
import {
  usePreferences,
  useRevokeOtherSessions,
  useRevokeSession,
  useSessions,
  useUpdatePreferences,
} from './api';

/** Theme, notification preferences and signed-in devices. */
export function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Appearance, notifications and where you are signed in."
      />
      <ThemeCard />
      <NotificationsCard />
      <SessionsCard />
    </div>
  );
}

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Match system', icon: Monitor },
];

function ThemeCard() {
  const { theme, setTheme } = useTheme();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Saved in this browser.</CardDescription>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" aria-label="Theme" className="grid gap-2 sm:grid-cols-3">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={theme === value}
              onClick={() => setTheme(value)}
              className={`flex items-center gap-2 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50 ${theme === value ? 'border-primary bg-muted/40 font-medium' : ''}`}
            >
              <Icon className="size-4" aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const PREFERENCE_ITEMS: {
  key: keyof NotificationPreferences;
  label: string;
  description: string;
  /** Not built yet: shown, but cannot be switched on. */
  unavailable?: boolean;
}[] = [
  {
    key: 'scanCompleted',
    label: 'Scan finished',
    description: 'When a scan you started completes.',
  },
  {
    key: 'scanFailed',
    label: 'Scan failed',
    description: 'When a scan fails or only partly completes.',
  },
  {
    key: 'regressionDetected',
    label: 'New problems detected',
    description: 'When a rescan finds issues that were not there before.',
  },
  {
    key: 'weeklySummary',
    label: 'Weekly summary',
    description:
      'A digest of your websites every Monday. Not available yet (planned with scheduled scans).',
    unavailable: true,
  },
  {
    key: 'email',
    label: 'Send by email',
    description:
      'Also send the notifications above to your email address. Each notification shows whether the e-mail was really sent.',
  },
];

function NotificationsCard() {
  const preferences = usePreferences();
  const update = useUpdatePreferences();

  const toggle = async (key: keyof NotificationPreferences, value: boolean) => {
    if (!preferences.data) return;
    try {
      await update.mutateAsync({ ...preferences.data, [key]: value });
      toast.success('Preferences saved.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Notifications appear under the bell at the top and on the Notifications page, for scans
          you start. E-mail is sent through the server&apos;s mail settings (in development: the
          Mailpit inbox).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {preferences.isPending ? (
          <Skeleton className="h-40" />
        ) : preferences.isError ? (
          <ErrorState error={preferences.error} onRetry={() => void preferences.refetch()} />
        ) : (
          <ul className="space-y-4">
            {PREFERENCE_ITEMS.map((item) => (
              <li key={item.key} className="flex items-start gap-3">
                <Checkbox
                  id={`pref-${item.key}`}
                  checked={item.unavailable ? false : preferences.data[item.key]}
                  disabled={update.isPending || item.unavailable}
                  onCheckedChange={(checked) => void toggle(item.key, checked === true)}
                  aria-describedby={`pref-${item.key}-description`}
                />
                <div className="grid gap-0.5">
                  <Label htmlFor={`pref-${item.key}`}>{item.label}</Label>
                  <p id={`pref-${item.key}-description`} className="text-xs text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const [confirmOthers, setConfirmOthers] = useState(false);
  const others = sessions.data?.filter((s) => !s.current).length ?? 0;

  const onRevoke = async (session: SessionDto) => {
    try {
      await revoke.mutateAsync(session.id);
      toast.success('Device signed out.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const onRevokeOthers = async () => {
    try {
      const { revoked } = await revokeOthers.mutateAsync();
      toast.success(revoked === 1 ? '1 device signed out.' : `${revoked} devices signed out.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setConfirmOthers(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>Signed-in devices</CardTitle>
          <CardDescription>Sign out anywhere you don&apos;t recognise.</CardDescription>
        </div>
        <Button
          variant="outline"
          disabled={others === 0 || revokeOthers.isPending}
          onClick={() => setConfirmOthers(true)}
        >
          <LogOut aria-hidden="true" /> Sign out other devices
        </Button>
      </CardHeader>
      <CardContent>
        {sessions.isPending ? (
          <Skeleton className="h-24" />
        ) : sessions.isError ? (
          <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
        ) : (
          <ul className="divide-y">
            {sessions.data.map((session) => (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="flex items-start gap-3">
                  <Laptop className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
                  <div className="text-sm">
                    <p className="font-medium">
                      {describeDevice(session.userAgent)}{' '}
                      {session.current ? <Badge variant="secondary">This device</Badge> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {session.ipAddress ?? 'Unknown IP'} · signed in{' '}
                      {formatDateTime(session.signedInAt)} · active{' '}
                      {formatRelative(session.lastActiveAt)}
                    </p>
                  </div>
                </div>
                {session.current ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={revoke.isPending}
                    onClick={() => void onRevoke(session)}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <AlertDialog open={confirmOthers} onOpenChange={setConfirmOthers}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Sign out {others === 1 ? 'the other device' : `${others} other devices`}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They will need your password to sign in again. This device stays signed in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={revokeOthers.isPending}
              onClick={() => void onRevokeOthers()}
            >
              Sign out others
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
