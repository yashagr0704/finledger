import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { store } from '@/store/store';

/** Adds a firm-wide portal. It appears in every portal list and login dropdown straight away. */
export function PortalDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: (portalId: string) => void }) {
  const [name, setName] = useState('');
  const [short, setShort] = useState('');
  const [url, setUrl] = useState('https://');
  const [loginUrl, setLoginUrl] = useState('');
  const [description, setDescription] = useState('');
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {open && (
        <DialogContent title="Add portal" description="Shows up for everyone in the firm." size="sm">
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const id = store.savePortal({ name, short: short || name.slice(0, 4).toUpperCase(), url: url.trim(), loginUrl: loginUrl.trim() || undefined, description });
              if (id) {
                toast.success(`${name.trim()} added`);
                onSaved?.(id);
                onClose();
              }
            }}
          >
            <DialogBody className="space-y-3">
              <Field label="Portal name" htmlFor="pt-name" required>
                <Input id="pt-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SEZ Online" />
              </Field>
              <Field label="Short label" htmlFor="pt-short" hint="2–4 letters shown on the tile">
                <Input id="pt-short" maxLength={4} value={short} onChange={(e) => setShort(e.target.value.toUpperCase())} />
              </Field>
              <Field label="Website address" htmlFor="pt-url" required>
                <Input id="pt-url" value={url} onChange={(e) => setUrl(e.target.value)} />
              </Field>
              <Field label="Sign-in page" htmlFor="pt-login" hint="Optional. Where Login should go, if it isn’t the website address.">
                <Input id="pt-login" value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)} placeholder="https://…/login" />
              </Field>
              <Field label="What it’s used for" htmlFor="pt-desc">
                <Input id="pt-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={!name.trim()}>
                Add portal
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
