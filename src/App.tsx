import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { ShieldAlert } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { TooltipProvider } from '@/components/ui/menu';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { UIProvider } from '@/store/ui';
import { useCurrentUser } from '@/store/store';
import { canAccessBilling, canUseWhatsApp, canViewReports, canViewTeam } from '@/lib/permissions';
import type { User } from '@/types';

const Overview = lazy(() => import('@/pages/Overview'));
const Tasks = lazy(() => import('@/pages/Tasks'));
const Clients = lazy(() => import('@/pages/Clients'));
const ClientDetail = lazy(() => import('@/pages/ClientDetail'));
const CalendarPage = lazy(() => import('@/pages/Calendar'));
const ReviewQueue = lazy(() => import('@/pages/ReviewQueue'));
const Team = lazy(() => import('@/pages/Team'));
const TeamMember = lazy(() => import('@/pages/TeamMember'));
const Reports = lazy(() => import('@/pages/Reports'));
const Notifications = lazy(() => import('@/pages/Notifications'));
const SettingsPage = lazy(() => import('@/pages/Settings'));
const NotesPage = lazy(() => import('@/pages/Notes'));
const PortalsPage = lazy(() => import('@/pages/Portals'));
const NoticesPage = lazy(() => import('@/pages/Notices'));
const BillingPage = lazy(() => import('@/pages/Billing'));
const DscPage = lazy(() => import('@/pages/Dsc'));
const DocRegisterPage = lazy(() => import('@/pages/DocRegister'));
const WhatsAppPage = lazy(() => import('@/pages/WhatsApp'));
const DrivePage = lazy(() => import('@/pages/Drive'));
const MastersPage = lazy(() => import('@/pages/Masters'));

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-56" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[86px]" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

function Guard({ allow, children }: { allow: (u: User) => boolean; children: ReactNode }) {
  const me = useCurrentUser();
  if (allow(me)) return <>{children}</>;
  return (
    <EmptyState
      icon={<ShieldAlert />}
      title="You don’t have access to this page"
      description="Your current role can’t view this section. Switch role from the demo menu to explore it."
      action={
        <Button asChild variant="primary">
          <Link to="/">Back to overview</Link>
        </Button>
      }
    />
  );
}

/** Resets the error boundary whenever the route changes. */
function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>;
}

export default function App() {
  // Brief boot state so the loading skeleton is exercised on first paint.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 250);
    return () => clearTimeout(t);
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <UIProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route
              path="*"
              element={
                <RouteErrorBoundary>
                  {!ready ? (
                    <PageSkeleton />
                  ) : (
                    <Suspense fallback={<PageSkeleton />}>
                      <Routes>
                        <Route index element={<Overview />} />
                        <Route path="tasks" element={<Tasks />} />
                        <Route path="clients" element={<Clients />} />
                        <Route path="clients/:clientId" element={<ClientDetail />} />
                        <Route path="calendar" element={<CalendarPage />} />
                        <Route path="review" element={<ReviewQueue />} />
                        <Route path="team" element={<Guard allow={canViewTeam}><Team /></Guard>} />
                        <Route path="team/:userId" element={<Guard allow={canViewTeam}><TeamMember /></Guard>} />
                        <Route path="reports" element={<Guard allow={canViewReports}><Reports /></Guard>} />
                        <Route path="notifications" element={<Notifications />} />
                        <Route path="settings" element={<SettingsPage />} />
                        <Route path="notes" element={<NotesPage />} />
                        <Route path="portals" element={<PortalsPage />} />
                        <Route path="notices" element={<NoticesPage />} />
                        <Route path="billing" element={<Guard allow={canAccessBilling}><BillingPage /></Guard>} />
                        <Route path="dsc" element={<DscPage />} />
                        <Route path="documents-register" element={<DocRegisterPage />} />
                        <Route path="whatsapp" element={<Guard allow={canUseWhatsApp}><WhatsAppPage /></Guard>} />
                        <Route path="drive" element={<DrivePage />} />
                        <Route path="masters/:tab" element={<MastersPage />} />
                        <Route path="masters" element={<Navigate to="/masters/services" replace />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Routes>
                    </Suspense>
                  )}
                </RouteErrorBoundary>
              }
            />
          </Route>
        </Routes>
        <Toaster position="bottom-left" toastOptions={{ className: 'text-[13px]' }} richColors closeButton />
      </UIProvider>
    </TooltipProvider>
  );
}
