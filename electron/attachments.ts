import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type { Attachment } from '../shared/types';
const MAX_BYTES = 20 * 1024 * 1024;
const imageMime = (data: Buffer) => data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : data[0] === 255 && data[1] === 216 && data[2] === 255 ? 'image/jpeg' : ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString()) ? 'image/gif' : data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : undefined;
export class Attachments {
  readonly root: string;
  constructor(databasePath: string) { this.root = join(dirname(databasePath), 'attachments'); }
  async importPath(path: string) { const info = await stat(path); if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Attachments must be files of at most 20 MB.'); return this.import(basename(path), await readFile(path)); }
  async import(name: string, bytes: Buffer): Promise<Attachment> {
    if (bytes.length > MAX_BYTES) throw new Error('Attachments must be at most 20 MB.');
    if (/\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(name)) throw new Error('Video attachments are not supported yet.');
    const mime = imageMime(bytes) || (extname(name).toLowerCase() === '.pdf' ? 'application/pdf' : !bytes.subarray(0, 8192).includes(0) ? 'text/plain' : 'application/octet-stream');
    const item: Attachment = { id: randomUUID(), name: basename(name), size: bytes.length, mime };
    await mkdir(this.root, { recursive: true });
    await writeFile(this.path(item), bytes, { flag: 'wx', mode: 0o600 });
    await writeFile(join(this.root, `${item.id}.json`), JSON.stringify(item), { flag: 'wx', mode: 0o600 });
    return item;
  }
  path(item: Attachment) { return join(this.root, item.id + extname(item.name).replace(/[^.a-zA-Z0-9]/g, '').slice(0, 20)); }
  async get(id: string): Promise<Attachment> { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid attachment'); return JSON.parse(await readFile(join(this.root, `${id}.json`), 'utf8')); }
  async resolve(ids: string[] = []) { return Promise.all(ids.map(id => this.get(id))); }
  async preview(id: string) { const item = await this.get(id); return item.mime.startsWith('image/') ? `data:${item.mime};base64,${(await readFile(this.path(item))).toString('base64')}` : null; }
}
export interface AgentAttachment extends Attachment { path: string; data?: string; text?: string }
export async function agentAttachments(storage: Attachments, items: Attachment[]): Promise<AgentAttachment[]> {
  return Promise.all(items.map(async item => ({ ...item, path: storage.path(item), ...(item.mime.startsWith('image/') ? { data: (await readFile(storage.path(item))).toString('base64') } : item.mime === 'text/plain' && item.size <= 1024 * 1024 ? { text: await readFile(storage.path(item), 'utf8') } : {}) })));
}
