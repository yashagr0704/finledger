import { useState } from 'react';
import { Button } from './button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from './dialog';

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'primary',
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} size="sm">
        <DialogBody>
          <p className="text-[13px] leading-relaxed text-ink-600">{description}</p>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            autoFocus
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useConfirm() {
  const [state, setState] = useState<{ title: string; description: string; confirmLabel?: string; tone?: 'primary' | 'danger'; onConfirm: () => void } | null>(null);
  const dialog = state ? <ConfirmDialog open onOpenChange={(v) => !v && setState(null)} {...state} /> : null;
  return { confirm: setState, dialog };
}
