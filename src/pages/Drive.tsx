import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, File, FileSpreadsheet, FileText, Folder, FolderOpen, HardDrive, Search, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader } from '@/components/ui/misc';
import { Input } from '@/components/ui/form';
import { useConfirm } from '@/components/ui/confirm';
import { formatDate } from '@/lib/dates';
import { useLookup } from '@/lib/lookup';
import { permissionsOf, visibleClients } from '@/lib/permissions';
import { cn, formatFileSize } from '@/lib/utils';
import { store, useCurrentUser, useDb } from '@/store/store';
import type { DriveFile } from '@/types';
import { fileHref, UPLOAD_NOTE, uploadFiles } from '@/lib/uploads';
import { BACKEND } from '@/api/client';

function fileIcon(name: string) {
  if (/\.(xlsx?|csv)$/i.test(name)) return <FileSpreadsheet className="size-4 text-emerald-600" />;
  if (/\.pdf$/i.test(name)) return <FileText className="size-4 text-red-500" />;
  return <File className="size-4 text-ink-400" />;
}

export default function DrivePage() {
  const db = useDb();
  const me = useCurrentUser();
  const { users } = useLookup();
  const { confirm, dialog } = useConfirm();
  const [params, setParams] = useSearchParams();
  const clients = visibleClients(db, me);
  const clientId = params.get('client') ?? clients[0]?.id ?? '';
  const folder = params.get('folder') ?? '';
  const [q, setQ] = useState('');
  const [clientQ, setClientQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const go = (patch: Record<string, string>) => setParams({ client: clientId, folder, ...patch }, { replace: true });

  const files = db.drive.filter((f) => f.clientId === clientId);
  const client = db.clients.find((c) => c.id === clientId);
  const used = files.reduce((s, f) => s + f.sizeKb, 0);

  // Immediate sub-folders and files in the current folder.
  const { subfolders, here } = useMemo(() => {
    const prefix = folder ? folder + '/' : '';
    const subs = new Map<string, DriveFile[]>();
    const direct: DriveFile[] = [];
    files.forEach((f) => {
      if (folder && f.folder !== folder && !f.folder.startsWith(prefix)) return;
      if (f.folder === folder) return direct.push(f);
      const rest = f.folder.slice(prefix.length);
      const name = rest.split('/')[0];
      subs.set(name, [...(subs.get(name) ?? []), f]);
    });
    return { subfolders: [...subs.entries()].sort(([a], [b]) => b.localeCompare(a)), here: direct };
  }, [files, folder]);
  const searching = q.trim().length > 0;
  const results = searching ? files.filter((f) => f.name.toLowerCase().includes(q.toLowerCase())) : here;
  const crumbs = folder ? folder.split('/') : [];

  return (
    <div className="animate-slide-up">
      {dialog}
      <PageHeader title="Client Drive" description="Every client’s documents, organised by year and work type." />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit overflow-hidden">
          <div className="border-b border-line p-2.5">
            <Input value={clientQ} onChange={(e) => setClientQ(e.target.value)} placeholder="Find client" aria-label="Find client" />
          </div>
          <ul className="max-h-[560px] overflow-y-auto py-1">
            {clients
              .filter((c) => !clientQ || c.name.toLowerCase().includes(clientQ.toLowerCase()))
              .map((c) => (
                <li key={c.id}>
                  <button onClick={() => setParams({ client: c.id }, { replace: true })} className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-slate-50', c.id === clientId ? 'bg-brand-50 font-medium text-brand-800' : 'text-ink-700')}>
                    {c.id === clientId ? <FolderOpen className="size-4 shrink-0 text-brand-500" /> : <Folder className="size-4 shrink-0 text-amber-500" />}
                    <span className="truncate">{c.name}</span>
                    <span className="ml-auto text-2xs text-ink-400">{db.drive.filter((f) => f.clientId === c.id).length}</span>
                  </button>
                </li>
              ))}
          </ul>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <nav className="flex min-w-0 flex-1 items-center gap-1 text-[13px]" aria-label="Folder path">
              <HardDrive className="size-4 shrink-0 text-ink-400" />
              <button onClick={() => go({ folder: '' })} className="truncate font-medium text-ink-800 hover:text-brand-700">
                {client?.name}
              </button>
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1">
                  <ChevronRight className="size-3.5 text-ink-300" />
                  <button onClick={() => go({ folder: crumbs.slice(0, i + 1).join('/') })} className="truncate text-ink-700 hover:text-brand-700">
                    {c}
                  </button>
                </span>
              ))}
            </nav>
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files" className="pl-8" aria-label="Search files" />
            </div>
            <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={!!client?.exitDate}>
              <Upload /> Upload
            </Button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={async (e) => {
                const list = Array.from(e.target.files ?? []);
                e.target.value = '';
                const uploaded = await uploadFiles(list, { clientId });
                const n = uploaded.length ? store.addDriveFiles(clientId, folder || 'General', uploaded) : 0;
                if (n) toast.success(`${n} file${n > 1 ? 's' : ''} added to ${folder || 'General'}`, { description: UPLOAD_NOTE });
              }}
            />
          </div>

          {!searching && subfolders.length > 0 && (
            <div className="grid grid-cols-2 gap-2 border-b border-line p-3 sm:grid-cols-3 xl:grid-cols-4">
              {subfolders.map(([name, fs]) => (
                <button key={name} onClick={() => go({ folder: folder ? `${folder}/${name}` : name })} className="flex items-center gap-2.5 rounded-lg border border-line bg-white px-3 py-2.5 text-left hover:border-slate-300 hover:bg-slate-50">
                  <Folder className="size-5 shrink-0 fill-amber-100 text-amber-500" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-ink-900">{name}</span>
                    <span className="text-2xs text-ink-400">{fs.length} files</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {results.length === 0 ? (
            <EmptyState compact icon={<Folder />} title={searching ? 'No files match' : subfolders.length ? 'No loose files here' : 'This folder is empty'} description={searching ? undefined : 'Upload files or open a folder above.'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead>
                  <tr className="border-b border-line text-2xs font-medium uppercase tracking-wide text-ink-400">
                    <th className="px-4 py-2 font-medium">Name</th>
                    {searching && <th className="px-3 py-2 font-medium">Folder</th>}
                    <th className="px-3 py-2 font-medium">Uploaded by</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 text-right font-medium">Size</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {results.map((f) => (
                    <tr key={f.id} className="group hover:bg-slate-50">
                      <td className="px-4 py-2">
                        <button
                          onClick={() => {
                            const href = fileHref(f.fileId);
                            if (href) window.open(href, '_blank', 'noopener');
                            else toast.info(`${f.name}`, { description: BACKEND ? 'Only the file details were recorded for this entry.' : 'File preview is not available in the demo.' });
                          }} className="flex items-center gap-2 text-[13px] text-ink-900 hover:text-brand-700">
                          {fileIcon(f.name)}
                          {f.name}
                        </button>
                      </td>
                      {searching && <td className="px-3 py-2 text-xs text-ink-500">{f.folder}</td>}
                      <td className="px-3 py-2 text-xs text-ink-600">{users.get(f.uploadedBy)?.name}</td>
                      <td className="px-3 py-2 text-xs text-ink-600">{formatDate(f.uploadedAt)}</td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-500">{formatFileSize(f.sizeKb)}</td>
                      <td className="px-4 py-2 text-right">
                        {permissionsOf(me).deleteRecords && (
                          <button
                            onClick={() =>
                              confirm({
                                title: `Delete ${f.name}?`,
                                description: 'The file will be removed from the client drive permanently.',
                                confirmLabel: 'Delete',
                                tone: 'danger',
                                onConfirm: () => store.deleteDriveFile(f.id) && toast.success('File deleted'),
                              })
                            }
                            className="rounded p-1 text-ink-300 opacity-0 hover:text-red-600 group-hover:opacity-100"
                            aria-label={`Delete ${f.name}`}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-line px-4 py-2 text-2xs text-ink-400">
            {files.length} files · {formatFileSize(used)} used
          </div>
        </Card>
      </div>
    </div>
  );
}
