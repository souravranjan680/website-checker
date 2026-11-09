import {
  Activity,
  Bug,
  ChevronsUpDown,
  FolderKanban,
  GitCompareArrows,
  Globe,
  History,
  Images,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  ScanSearch,
  Settings,
  ShieldCheck,
  Sun,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/features/auth/auth-context';
import { NotificationBell } from '@/features/notifications/NotificationsPage';
import { cn } from '@/lib/utils';
import { useTheme, type Theme } from '../theme';

interface NavItem {
  label: string;
  icon: LucideIcon;
  to?: string; // undefined = not built yet
  phase?: number;
}

// Sections not built yet are shown disabled with the phase that delivers them.
const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard' },
  { label: 'Projects', icon: FolderKanban, to: '/projects' },
  { label: 'Websites', icon: Globe, to: '/websites' },
  { label: 'Website comparison', icon: GitCompareArrows, to: '/website-comparisons' },
  { label: 'Scan Center', icon: ScanSearch, to: '/scans' },
  { label: 'History', icon: History, to: '/history' },
  { label: 'Visual regression', icon: Images, to: '/visual' },
  { label: 'Bug reports', icon: Bug, to: '/bug-reports' },
  { label: 'Settings', icon: Settings, to: '/settings' },
  { label: 'System status', icon: Activity, to: '/status' },
];

export function AppLayout() {
  return (
    <div className="flex min-h-svh bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <Link to="/dashboard" className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
          <img src="/favicon.svg" alt="" className="size-6" />
          Health Checker
        </Link>
        <nav aria-label="Main" className="flex flex-col gap-0.5 p-2">
          {NAV_ITEMS.map((item) => (
            <SidebarLink key={item.label} item={item} />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-4 border-b px-4 md:px-6">
          <MobileNav />
          <span className="hidden text-sm text-muted-foreground md:block">
            Phase 9 · in progress
          </span>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <ThemeSwitcher />
            <UserMenu />
          </div>
        </header>
        <main id="main" className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  const content = (
    <>
      <item.icon className="size-4" aria-hidden="true" />
      <span className="flex-1">{item.label}</span>
      {item.phase ? (
        <Badge variant="outline" className="text-[10px] font-normal">
          Phase {item.phase}
        </Badge>
      ) : null}
    </>
  );
  const base = 'flex items-center gap-2 rounded-md px-3 py-2 text-sm';

  if (!item.to) {
    return (
      <span className={cn(base, 'cursor-not-allowed text-muted-foreground')} aria-disabled="true">
        {content}
      </span>
    );
  }
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          base,
          'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          isActive && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
        )
      }
    >
      {content}
    </NavLink>
  );
}

/** Below the md breakpoint the sidebar is hidden; the same links live in this menu. */
function MobileNav() {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="md:hidden">
          <Menu aria-hidden="true" /> Menu
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {NAV_ITEMS.map((item) => (
          <DropdownMenuItem
            key={item.label}
            disabled={!item.to}
            onSelect={() => item.to && navigate(item.to)}
          >
            <item.icon aria-hidden="true" /> {item.label}
            {item.phase ? (
              <span className="ml-auto text-xs text-muted-foreground">Phase {item.phase}</span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  const signOut = async () => {
    try {
      await logout();
    } finally {
      navigate('/login', { replace: true });
      toast.success('Signed out.');
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <span className="hidden max-w-32 truncate sm:inline">{user.name}</span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Account menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          {user.role === 'ADMIN' ? (
            <Badge variant="secondary" className="mt-1">
              <ShieldCheck aria-hidden="true" /> Administrator
            </Badge>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/profile')}>
          <UserRound aria-hidden="true" /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/settings')}>
          <Settings aria-hidden="true" /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const THEME_OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'dark', label: 'Dark theme', icon: Moon },
  { value: 'system', label: 'System theme', icon: Monitor },
];

function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="group"
      aria-label="Theme"
      className="hidden items-center gap-0.5 rounded-md border p-0.5 sm:flex"
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
        <Button
          key={value}
          variant={theme === value ? 'secondary' : 'ghost'}
          size="icon-sm"
          aria-label={label}
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
        >
          <Icon aria-hidden="true" />
        </Button>
      ))}
    </div>
  );
}
