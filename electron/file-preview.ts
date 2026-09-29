import { constants } from 'node:fs';
import { open, opendir, realpath, lstat, type FileHandle } from 'node:fs/promises';
import { basename, extname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileReference, FilePreview } from '../shared/experience';
import type { DirectoryEntry, WorkspaceFileReference } from '../shared/experience';
import { MooseError } from '../shared/errors';
import type { Store } from './db/store';
import type { Attachments } from './attachments';
import { inside } from './git';
const MiB = 1024 * 1024;
export class FilePreviews {
  constructor(
    private store: Store,
    private attachments: Attachments,
  ) {}
  /** Read only one directory, bounded and restricted to the active workspace/worktree. */
  async list(reference: WorkspaceFileReference) {
    try {
      const root = await realpath(this.store.directory(reference.projectId, reference.sessionId));
      const path = resolve(root, reference.path);
      if (!inside(root, path))
        throw new MooseError('file-access', 'Directory is outside this workspace');
      const canonical = await realpath(path);
      if (!inside(root, canonical))
        throw new MooseError('file-access', 'Directory is outside this workspace');
      const entries: DirectoryEntry[] = [];
      let truncated = false;
      const directory = await opendir(canonical);
      for await (const entry of directory) {
        if (entry.name === '.git' || (!entry.isFile() && !entry.isDirectory())) continue;
        if (entries.length === 2000) {
          truncated = true;
          break;
        }
        entries.push({
          name: entry.name,
          path: relative(root, join(path, entry.name)),
          kind: entry.isDirectory() ? 'directory' : 'file',
        });
      }
      if ((await realpath(path)) !== canonical)
        throw new MooseError('file-access', 'Directory changed during access');
      entries.sort(
        (a, b) =>
          Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
          a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
      return { entries, truncated };
    } catch (error) {
      if (error instanceof MooseError) throw error;
      throw new MooseError(
        (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing-file' : 'file-access',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  async open(reference: FileReference) {
    let path: string, root: string, name: string;
    try {
      if ('attachmentId' in reference) {
        const attachment = await this.attachments.get(reference.attachmentId);
        root = await realpath(this.attachments.root);
        path = this.attachments.path(attachment);
        name = attachment.name;
      } else {
        root = this.store.directory(reference.projectId, reference.sessionId);
        let input = reference.path;
        if (input.startsWith('file:')) input = fileURLToPath(input);
        path = resolve(root, input);
        name = basename(path);
      }
      if (!inside(root, path))
        throw new MooseError('file-access', 'File is outside this workspace');
      const canonical = await realpath(path);
      const original = await lstat(canonical);
      if (!original.isFile() || !inside(root, canonical))
        throw new MooseError('file-access', 'Only regular files within this workspace can be read');
      const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (
          !stat.isFile() ||
          stat.dev !== original.dev ||
          stat.ino !== original.ino ||
          (await realpath(path)) !== canonical
        )
          throw new MooseError('file-access', 'File changed during access');
        return { handle, name, size: stat.size };
      } catch (error) {
        await handle.close();
        throw error;
      }
    } catch (error) {
      if (error instanceof MooseError) throw error;
      throw new MooseError(
        (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing-file' : 'file-access',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  private async read(handle: FileHandle, length: number) {
    const bytes = Buffer.alloc(length);
    let position = 0;
    while (position < length) {
      const { bytesRead } = await handle.read(bytes, position, length - position, position);
      if (!bytesRead) break;
      position += bytesRead;
    }
    return bytes.subarray(0, position);
  }
  async preview(reference: FileReference): Promise<FilePreview> {
    const { handle, name, size } = await this.open(reference);
    try {
      const header = await this.read(handle, Math.min(size, 8192));
      const mime = header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'image/png'
        : header[0] === 255 && header[1] === 216 && header[2] === 255
          ? 'image/jpeg'
          : ['GIF87a', 'GIF89a'].includes(header.subarray(0, 6).toString())
            ? 'image/gif'
            : header.subarray(0, 4).toString() === 'RIFF' &&
                header.subarray(8, 12).toString() === 'WEBP'
              ? 'image/webp'
              : undefined;
      if (mime) {
        if (size > 20 * MiB)
          throw new MooseError('file-size', 'Images must be at most 20 MiB to preview');
        const bytes = await this.read(handle, size);
        return {
          name,
          size,
          kind: 'image',
          content: `data:${mime};base64,${bytes.toString('base64')}`,
          truncated: false,
        };
      }
      if (
        header.includes(0) ||
        extname(name).toLowerCase() === '.pdf' ||
        header.subarray(0, 4).toString() === '%PDF'
      )
        return { name, size, kind: 'download', truncated: false };
      const bytes = await this.read(handle, Math.min(size, MiB));
      try {
        return {
          name,
          size,
          kind: 'text',
          content: new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: size > MiB }),
          truncated: size > MiB,
        };
      } catch {
        return { name, size, kind: 'download', truncated: false };
      }
    } finally {
      await handle.close();
    }
  }
  async info(reference: FileReference) {
    const { handle, name, size } = await this.open(reference);
    await handle.close();
    return { name, size };
  }
  async save(reference: FileReference, destination: string) {
    const { handle } = await this.open(reference);
    try {
      const target = await open(
        destination,
        constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        const source = await handle.stat(),
          dest = await target.stat();
        if (source.dev === dest.dev && source.ino === dest.ino)
          throw new MooseError(
            'file-access',
            'Choose a different destination to preserve the original file',
          );
        await target.truncate(0);
        const buffer = Buffer.alloc(1024 * 1024);
        let position = 0;
        while (true) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
          if (!bytesRead) break;
          let written = 0;
          while (written < bytesRead) {
            const result = await target.write(
              buffer,
              written,
              bytesRead - written,
              position + written,
            );
            written += result.bytesWritten;
          }
          position += bytesRead;
        }
      } finally {
        await target.close();
      }
    } finally {
      await handle.close();
    }
  }
}
