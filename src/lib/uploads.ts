import { toast } from 'sonner';
import { api, BACKEND } from '@/api/client';
import { store } from '@/store/store';

export interface UploadedFile {
  name: string;
  sizeKb: number;
  fileId?: string;
}

/**
 * Backend mode: stores each file on the server and returns its fileId. Demo mode: returns file details only.
 * Files that fail to upload are reported and skipped.
 */
export async function uploadFiles(files: File[], scope: { taskId?: string; clientId?: string }): Promise<UploadedFile[]> {
  if (!BACKEND) return files.map((f) => ({ name: f.name, sizeKb: f.size / 1024 }));
  // The task or client may have been created a moment ago; make sure the server has it first.
  await store.settled();
  const out: UploadedFile[] = [];
  for (const f of files) {
    try {
      out.push(await api.upload(f, scope));
    } catch (err) {
      toast.error(`Couldn’t upload ${f.name}`, { description: err instanceof Error ? err.message : undefined });
    }
  }
  return out;
}

/** Download/preview URL for a stored file, if it has content on the server. */
export const fileHref = (fileId?: string) => (BACKEND && fileId ? api.fileUrl(fileId) : undefined);

export const UPLOAD_NOTE = BACKEND ? undefined : 'Demo mode stores file details only, not file contents.';
