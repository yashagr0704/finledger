import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Building2,
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Menu as MenuIcon,
  PieChart,
  Plus,
  RotateCcw,
  Search,
  Settings,
  UserPlus,
  Users,
  X,
  FolderPlus,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { brand } from '@/config/brand';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/misc';
import { Menu, MenuCheckItem, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Tooltip } from '@/components/ui/menu';
import { useConfirm } from '@/components/ui/confirm';
import { Avatar } from '@/components/badges';
import { ROLE_META } from '@/lib/constants';
import { canCreateClient, canCreateTask, canManageTeam, canReviewTask, canViewReports, canViewTeam, visibleTasks } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { store, useCurrentUser, useDb } from '@/store/store';
import { useUI } from '@/store/ui';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';
import { TaskFormDialog } from '@/components/tasks/TaskFormDialog';
import { ClientFormDialog } from '@/components/clients/ClientFormDialog';
import { InviteDialog } from '@/components/layout/InviteDialog';
import { CommandPalette } from './CommandPalette';
import { NotificationsPopover } from './NotificationsPopover';

const COLLAPSE_KEY = `${brand.storageKey}.sidebar`;

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number;
  badgeTone?: 'brand' | 'red';
  end?: boolean;
}

export function AppShell() {
  const db = useDb();
  const me = useCurrentUser();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const { setSearchOpen } = useUI();

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSearchOpen]);

  const reviewCount = visibleTasks(db, me).filter((t) => t.status === 'in_review' && canReviewTask(me, t)).length;
  const unread = db.notifications.filter((n) => n.userId === me.id && !n.read).length;

  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: 'Workspace',
      items: [
        { to: '/', label: 'Overview', icon: <LayoutDashboard />, end: true },
        { to: '/tasks', label: 'Tasks', icon: <ListTodo /> },
        { to: '/review', label: 'Review Queue', icon: <ClipboardCheck />, badge: reviewCount || undefined },
        { to: '/calendar', label: 'Compliance Calendar', icon: <CalendarDays /> },
      ],
    },
    {
      label: 'Practice',
      items: [
        { to: '/clients', label: 'Clients', icon: <Building2 /> },
        ...(canViewTeam(me) ? [{ to: '/team', label: 'Team', icon: <Users /> }] : []),
        ...(canViewReports(me) ? [{ to: '/reports', label: 'Reports', icon: <PieChart /> }] : []),
      ],
    },
    {
      label: 'Account',
      items: [
        { to: '/notifications', label: 'Notifications', icon: <Bell />, badge: unread || undefined, badgeTone: 'red' as const },
        { to: '/settings', label: 'Settings', icon: <Settings /> },
      ],
    },
  ];

  const sidebar = (isMobile: boolean) => {
    const mini = collapsed && !isMobile;
    return (
      <div className="flex h-full flex-col">
        <div className={cn('flex h-14 items-center gap-2.5 border-b border-line px-4', mini && 'justify-center px-0')}>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-600 text-[11px] font-bold tracking-tight text-white shadow-sm">{brand.mark}</span>
          {!mini && (
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold leading-tight text-ink-900">{brand.name}</p>
              <p className="truncate text-2xs leading-tight text-ink-500">{db.firm.name}</p>
            </div>
          )}
          {isMobile && (
            <Button size="icon" variant="ghost" className="ml-auto" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
              <X />
            </Button>
          )}
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4" aria-label="Main">
          {groups.map((g) => (
            <div key={g.label}>
              {!mini && <p className="mb-1 px-2 text-2xs font-semibold uppercase tracking-wider text-ink-400">{g.label}</p>}
              <ul className="space-y-0.5">
                {g.items.map((item) => (
                  <li key={item.to}>
                    <SideLink item={item} mini={mini} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-line p-2.5">
          {!isMobile && (
            <button
              onClick={() => setCollapsed((v) => !v)}
              className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-ink-500 hover:bg-slate-100 hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40', mini && 'justify-center')}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
              {!mini && 'Collapse'}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {/* Desktop sidebar */}
      <aside className={cn('hidden shrink-0 border-r border-line bg-white transition-[width] duration-200 lg:block', collapsed ? 'w-[60px]' : 'w-60')}>{sidebar(false)}</aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/30 animate-fade-in" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white shadow-pop animate-slide-up">{sidebar(true)}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main id="main" className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 lg:py-6">
            <Outlet />
          </div>
        </main>
      </div>

      <TaskDrawer />
      <TaskFormDialog />
      <ClientFormDialog />
      <InviteDialog />
      <CommandPalette />
    </div>
  );
}

function SideLink({ item, mini }: { item: NavItem; mini: boolean }) {
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'group relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium text-ink-600 transition-colors hover:bg-slate-100 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 [&_svg]:size-4 [&_svg]:shrink-0',
          isActive && 'bg-brand-50 text-brand-700 hover:bg-brand-50 hover:text-brand-700 [&_svg]:text-brand-600',
          !isActive && '[&_svg]:text-ink-400 group-hover:[&_svg]:text-ink-600',
          mini && 'justify-center px-0',
        )
      }
    >
      {item.icon}
      {!mini && <span className="flex-1 truncate">{item.label}</span>}
      {item.badge !== undefined &&
        (mini ? (
          <span className={cn('absolute right-1 top-1 size-1.5 rounded-full', item.badgeTone === 'red' ? 'bg-red-500' : 'bg-brand-500')} />
        ) : (
          <span className={cn('rounded-full px-1.5 text-2xs font-semibold tabular-nums', item.badgeTone === 'red' ? 'bg-red-50 text-red-600' : 'bg-brand-100 text-brand-700')}>{item.badge}</span>
        ))}
    </NavLink>
  );
  return mini ? (
    <Tooltip content={item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const db = useDb();
  const me = useCurrentUser();
  const navigate = useNavigate();
  const { setSearchOpen, openTaskForm, openClientForm, setInviteOpen } = useUI();
  const { confirm, dialog } = useConfirm();
  const active = db.users.filter((u) => u.status === 'active');
  const canCreate = canCreateTask(me) || canCreateClient(me) || canManageTeam(me);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-white/90 px-3 backdrop-blur sm:px-4">
      {dialog}
      <Button size="icon" variant="ghost" className="lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <MenuIcon />
      </Button>

      <button
        onClick={() => setSearchOpen(true)}
        className="flex h-8 w-full max-w-md items-center gap-2 rounded-md border border-line bg-slate-50 px-2.5 text-[13px] text-ink-400 transition-colors hover:border-slate-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate text-left">Search tasks, clients, people…</span>
        <span className="hidden items-center gap-0.5 sm:flex">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        {/* Demo role switcher */}
        <Menu>
          <MenuTrigger asChild>
            <button className="hidden h-8 items-center gap-1.5 rounded-md border border-dashed border-amber-300 bg-amber-50 px-2.5 text-xs font-medium text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 md:flex">
              <ShieldCheck className="size-3.5" />
              Demo: {ROLE_META[me.role].short}
            </button>
          </MenuTrigger>
          <MenuContent className="w-72">
            <RoleSwitchItems />
          </MenuContent>
        </Menu>

        {canCreate && (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="primary" size="md" aria-label="Create">
                <Plus /> <span className="hidden sm:inline">New</span>
              </Button>
            </MenuTrigger>
            <MenuContent className="w-52">
              {canCreateTask(me) && (
                <MenuItem onSelect={() => openTaskForm({ mode: 'create' })}>
                  <ListTodo /> New task
                </MenuItem>
              )}
              {canCreateClient(me) && (
                <MenuItem onSelect={() => openClientForm()}>
                  <FolderPlus /> Add client
                </MenuItem>
              )}
              {canManageTeam(me) && (
                <MenuItem onSelect={() => setInviteOpen(true)}>
                  <UserPlus /> Invite team member
                </MenuItem>
              )}
            </MenuContent>
          </Menu>
        )}

        <NotificationsPopover />

        <Menu>
          <MenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-md p-1 pr-1.5 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40" aria-label="Account menu">
              <Avatar user={me} size="sm" />
              <span className="hidden text-left xl:block">
                <span className="block text-xs font-medium leading-tight text-ink-900">{me.name}</span>
                <span className="block text-2xs leading-tight text-ink-500">{ROLE_META[me.role].label}</span>
              </span>
            </button>
          </MenuTrigger>
          <MenuContent className="w-64">
            <div className="flex items-center gap-2.5 px-2 py-2">
              <Avatar user={me} size="md" />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-ink-900">{me.name}</p>
                <p className="truncate text-xs text-ink-500">{me.email}</p>
              </div>
            </div>
            <MenuSeparator />
            <MenuItem onSelect={() => navigate(canViewTeam(me) ? `/team/${me.id}` : '/settings')}>
              <Users /> My profile
            </MenuItem>
            <MenuItem onSelect={() => navigate('/settings')}>
              <Settings /> Settings
            </MenuItem>
            <MenuSeparator />
            <div className="md:hidden">
              <RoleSwitchItems />
              <MenuSeparator />
            </div>
            <MenuItem
              onSelect={() =>
                confirm({
                  title: 'Reset demo data?',
                  description: 'All changes you made in this browser will be discarded and the demo firm will be re-seeded.',
                  confirmLabel: 'Reset demo',
                  tone: 'danger',
                  onConfirm: () => {
                    store.resetDemo();
                    navigate('/');
                    toast.success('Demo data reset');
                  },
                })
              }
            >
              <RotateCcw /> Reset demo data
            </MenuItem>
            <MenuItem disabled>
              <LogOut /> Sign out (no auth in demo)
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <span className="sr-only">{active.length} active users</span>
    </header>
  );
}

function RoleSwitchItems() {
  const db = useDb();
  const me = useCurrentUser();
  const active = db.users.filter((u) => u.status === 'active');
  const order = ['admin', 'manager', 'employee'] as const;
  return (
    <>
      <MenuLabel>View the demo as</MenuLabel>
      <div className="max-h-80 overflow-y-auto">
        {order.map((role) =>
          active
            .filter((u) => u.role === role)
            .map((u) => (
              <MenuCheckItem
                key={u.id}
                checked={u.id === me.id}
                onSelect={() => {
                  store.switchUser(u.id);
                  toast.success(`Now viewing as ${u.name}`, { description: ROLE_META[u.role].label });
                }}
              >
                <Avatar user={u} size="xs" />
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                <span className="text-2xs text-ink-400">{ROLE_META[u.role].short}</span>
              </MenuCheckItem>
            )),
        )}
      </div>
      <p className="px-2 pb-1.5 pt-1 text-2xs leading-snug text-ink-400">Demo role switching is not authentication. Permissions are enforced in the app layer only.</p>
    </>
  );
}
