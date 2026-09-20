import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { AppEvent } from '../shared/types';

/** Desktop client of the single loopback execution service; closing this client never stops it. */
export class SharedRuntime {
  private origin = '';
  private cookie = '';
  private token = '';
  private connection?: Promise<void>;
  private controller = new AbortController();
  private stream?: Promise<void>;
  constructor(
    private file: string,
    private emit: (event: AppEvent) => void,
  ) {}

  private connect() {
    if (!this.connection)
      this.connection = this.authenticate().catch((error) => {
        this.connection = undefined;
        throw error;
      });
    return this.connection;
  }
  private async authenticate() {
    const info = await stat(this.file);
    if (info.mode & 0o077 || (process.getuid && info.uid !== process.getuid()))
      throw new Error('Shared runtime connection file must be private (0600)');
    const config = JSON.parse(await readFile(this.file, 'utf8'));
    const url = new URL(config.origin);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      typeof config.token !== 'string'
    )
      throw new Error('Invalid local runtime connection');
    if (this.cookie && this.origin === url.origin && this.token === config.token) return;
    this.origin = url.origin;
    const response = await fetch(this.origin + '/api/login', {
      method: 'POST',
      redirect: 'error',
      headers: { Origin: this.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: config.token }),
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(10000)]),
    });
    if (!response.ok) throw new Error('Could not authenticate with the shared runtime');
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (!cookie?.startsWith('moose_session=')) throw new Error('Missing runtime session');
    this.cookie = cookie;
    this.token = config.token;
    if (!this.stream) this.stream = this.events();
  }
  private async events() {
    while (!this.controller.signal.aborted) {
      try {
        const response = await fetch(this.origin + '/api/events', {
          headers: { Cookie: this.cookie, Origin: this.origin },
          redirect: 'error',
          signal: this.controller.signal,
        });
        if (!response.ok || !response.body) throw new Error('Shared runtime disconnected');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) throw new Error('Shared runtime disconnected');
            pending += decoder.decode(value, { stream: true });
            let boundary: number;
            while ((boundary = pending.indexOf('\n\n')) >= 0) {
              const frame = pending.slice(0, boundary);
              pending = pending.slice(boundary + 2);
              for (const line of frame.split('\n'))
                if (line.startsWith('data: ')) this.emit(JSON.parse(line.slice(6)) as AppEvent);
            }
            if (pending.length > 16 * 1024 * 1024) throw new Error('Runtime event too large');
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
      } catch (error) {
        if (this.controller.signal.aborted) return;
        this.emit({
          type: 'runtime-error',
          error: String(error instanceof Error ? error.message : error),
        });
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            this.controller.signal.removeEventListener('abort', done);
            resolve();
          };
          const timer = setTimeout(done, 1500);
          this.controller.signal.addEventListener('abort', done, { once: true });
        });
        if (!this.controller.signal.aborted) {
          this.connection = undefined;
          try {
            await this.connect();
          } catch {
            /* Retry connection, never a business write. */
          }
        }
      }
    }
  }
  async request(method: string, params: unknown): Promise<unknown> {
    await this.connect();
    if (method === '_addProject') method = 'webAddProject';
    else if (method === '_importAttachments') {
      const paths = (params as { paths: string[] }).paths;
      if (paths.length > 10) throw new Error('Select at most 10 attachments');
      return Promise.all(
        paths.map(async (path) => {
          const info = await stat(path);
          if (!info.isFile() || info.size > 20 * 1024 * 1024)
            throw new Error('Attachments must be files of at most 20 MB');
          return this.request('uploadAttachment', {
            name: basename(path),
            data: (await readFile(path)).toString('base64'),
          });
        }),
      );
    } else if (method.startsWith('_')) throw new Error('Unknown shared runtime operation');
    // A lost response does not authorize retrying a write.
    const response = await fetch(this.origin + '/api/request', {
      method: 'POST',
      redirect: 'error',
      headers: { Origin: this.origin, Cookie: this.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params }),
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(240000)]),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Shared runtime request failed');
    return body.result;
  }
  async close() {
    this.controller.abort();
    await this.stream;
  }
}
