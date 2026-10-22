import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menu';
import { EmptyState } from '@/components/ui/misc';
import { store, useCurrentUser, useDb } from '@/store/store';
import { NotificationItem } from './NotificationItem';

export function NotificationsPopover() {
  const db = useDb();
  const me = useCurrentUser();
  const [open, setOpen] = useState(false);
  const mine = db.notifications.filter((n) => n.userId === me.id);
  const unread = mine.filter((n) => !n.read).length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
          <Bell />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex min-w-[15px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-[15px] text-white ring-2 ring-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
          <p className="text-[13px] font-semibold text-ink-900">
            Notifications {unread > 0 && <span className="ml-1 text-xs font-normal text-ink-500">{unread} unread</span>}
          </p>
          {unread > 0 && (
            <Button size="sm" variant="ghost" onClick={() => store.markAllNotificationsRead()}>
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[420px] divide-y divide-line overflow-y-auto">
          {mine.length === 0 ? (
            <EmptyState compact icon={<BellOff />} title="You’re all caught up" description="New assignments, reviews and deadline reminders will appear here." />
          ) : (
            mine.slice(0, 8).map((n) => <NotificationItem key={n.id} n={n} dense onNavigate={() => setOpen(false)} />)
          )}
        </div>
        <div className="border-t border-line p-1.5">
          <Link to="/notifications" onClick={() => setOpen(false)} className="block rounded-md py-1.5 text-center text-xs font-medium text-brand-700 hover:bg-slate-50">
            View all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
