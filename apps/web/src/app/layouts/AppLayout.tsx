import {
  Activity,
  Bug,
  FolderKanban,
  Globe,
  History,
  Images,
  LayoutDashboard,
  Monitor,
  Moon,
  ScanSearch,
  Settings,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  { label: 'System status', icon: Activity, to: '/' },
  { label: 'Dashboard', icon: LayoutDashboard, phase: 5 },
  { label: 'Projects', icon: FolderKanban, phase: 5 },
  { label: 'Websites', icon: Globe, phase: 5 },
  { label: 'Scan Center', icon: ScanSearch, phase: 5 },
  { label: 'History', icon: History, phase: 5 },
  { label: 'Visual regression', icon: Images, phase: 6 },
  { label: 'Bug reports', icon: Bug, phase: 6 },
  { label: 'Settings', icon: Settings, phase: 5 },
];

export function AppLayout() {
  return (
    <div className="flex min-h-svh bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
          <img src="/favicon.svg" alt="" className="size-6" />
          Health Checker
        </div>
        <nav aria-label="Main" className="flex flex-col gap-0.5 p-2">
          {NAV_ITEMS.map((item) => (
            <SidebarLink key={item.label} item={item} />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-4 border-b px-4 md:px-6">
          <span className="font-semibold md:hidden">Health Checker</span>
          <span className="hidden text-sm text-muted-foreground md:block">
            Phase 2 · project setup
          </span>
          <ThemeSwitcher />
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
      end
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
      className="flex items-center gap-0.5 rounded-md border p-0.5"
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
