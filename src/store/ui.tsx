import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TaskInput } from './store';

interface TaskFormState {
  mode: 'create' | 'edit';
  taskId?: string;
  defaults?: Partial<TaskInput>;
}

interface UIContextValue {
  openTask: (id: string) => void;
  closeTask: () => void;
  activeTaskId: string | null;
  taskForm: TaskFormState | null;
  openTaskForm: (state: TaskFormState) => void;
  closeTaskForm: () => void;
  clientForm: { clientId?: string } | null;
  openClientForm: (clientId?: string) => void;
  closeClientForm: () => void;
  inviteOpen: boolean;
  setInviteOpen: (v: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
}

const UIContext = createContext<UIContextValue | null>(null);

/** App-wide overlays: the task drawer (URL-driven via ?task=), forms and search. */
export function UIProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const [taskForm, setTaskForm] = useState<TaskFormState | null>(null);
  const [clientForm, setClientForm] = useState<{ clientId?: string } | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const activeTaskId = params.get('task');
  const openTask = useCallback(
    (id: string) =>
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.set('task', id);
        return next;
      }),
    [setParams],
  );
  const closeTask = useCallback(
    () =>
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.delete('task');
        return next;
      }),
    [setParams],
  );

  const value = useMemo<UIContextValue>(
    () => ({
      openTask,
      closeTask,
      activeTaskId,
      taskForm,
      openTaskForm: setTaskForm,
      closeTaskForm: () => setTaskForm(null),
      clientForm,
      openClientForm: (clientId?: string) => setClientForm({ clientId }),
      closeClientForm: () => setClientForm(null),
      inviteOpen,
      setInviteOpen,
      searchOpen,
      setSearchOpen,
    }),
    [openTask, closeTask, activeTaskId, taskForm, clientForm, inviteOpen, searchOpen],
  );
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used inside UIProvider');
  return ctx;
}
