import type { NotificationDto } from '@whc/shared';
import { Bell, CheckCheck, Mail, MailWarning } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { PaginationBar } from '@/components/common/PaginationBar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/form-errors';
import { formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from './api';

/** The e-mail outcome as recorded by the server: "sent" only when it really was. */
export function EmailStatus({ n }: { n: NotificationDto }) {
  if (n.emailStatus === 'SENT')
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        title={n.emailedAt ? formatDateTime(n.emailedAt) : undefined}
      >
        <Mail className="size-3" aria-hidden="true" /> E-mail sent
      </span>
    );
  if (n.emailStatus === 'PENDING')
    return <span className="text-xs text-muted-foreground">E-mail queued, not sent yet</span>;
  if (n.emailStatus === 'FAILED')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-700 dark:text-red-400">
        <MailWarning className="size-3" aria-hidden="true" /> E-mail not delivered
        {n.emailError ? `: ${n.emailError}` : ''}
      </span>
    );
  return null;
}

/** Header bell: unread count and the latest notifications. */
export function NotificationBell() {
  const unread = useUnreadCount();
  const latest = useNotifications({ pageSize: 6 });
  const markRead = useMarkRead();
  const navigate = useNavigate();
  const count = unread.data?.count ?? 0;

  const open = (n: NotificationDto) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        >
          <Bell aria-hidden="true" />
          {count ? (
            <span
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground"
              aria-hidden="true"
            >
              {count > 9 ? '9+' : count}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {latest.data?.data.length ? (
          latest.data.data.map((n) => (
            <DropdownMenuItem
              key={n.id}
              onSelect={() => open(n)}
              className="flex-col items-start gap-0.5"
            >
              <span className={cn('text-sm', !n.readAt && 'font-medium')}>{n.title}</span>
              <span className="text-xs text-muted-foreground">{n.message}</span>
              <span className="text-xs text-muted-foreground">{formatRelative(n.createdAt)}</span>
            </DropdownMenuItem>
          ))
        ) : (
          <p className="px-2 py-3 text-sm text-muted-foreground">No notifications yet.</p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/notifications')}>See all</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function NotificationsPage() {
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useNotifications({ page, pageSize: 20, unread: unreadOnly || undefined });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="Scan results and detected changes for scans you started. Choose what you get in Settings."
        actions={
          <>
            <Button
              variant={unreadOnly ? 'secondary' : 'outline'}
              aria-pressed={unreadOnly}
              onClick={() => {
                setUnreadOnly((v) => !v);
                setPage(1);
              }}
            >
              Unread only
            </Button>
            <Button
              variant="outline"
              disabled={markAll.isPending}
              onClick={() =>
                markAll.mutate(undefined, {
                  onSuccess: ({ updated }) =>
                    toast.success(updated ? `${updated} marked as read.` : 'Nothing unread.'),
                  onError: (error) => toast.error(errorMessage(error)),
                })
              }
            >
              <CheckCheck aria-hidden="true" /> Mark all read
            </Button>
          </>
        }
      />
      {list.isPending ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.data.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={unreadOnly ? 'Nothing unread' : 'No notifications yet'}
          description="You get a notification when a scan you started finishes, fails, or finds new problems."
        />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <ul className="divide-y">
              {list.data.data.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    'flex flex-wrap items-start justify-between gap-3 px-6 py-4',
                    !n.readAt && 'bg-muted/40',
                  )}
                >
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      {!n.readAt ? <Badge variant="secondary">New</Badge> : null}
                      {n.link ? (
                        <Link
                          to={n.link}
                          className="font-medium hover:underline"
                          onClick={() => !n.readAt && markRead.mutate(n.id)}
                        >
                          {n.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{n.title}</span>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">{n.message}</p>
                    <p className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)}>
                        {formatRelative(n.createdAt)}
                      </time>
                      <EmailStatus n={n} />
                    </p>
                  </div>
                  {!n.readAt ? (
                    <Button size="sm" variant="ghost" onClick={() => markRead.mutate(n.id)}>
                      Mark read
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {list.data ? <PaginationBar meta={list.data.meta} onPageChange={setPage} /> : null}
    </div>
  );
}
