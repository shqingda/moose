import { spawnAgent, terminate } from './process';
import { record, string } from './types';
export type RpcMessage = { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { code?: number; message?: string } };
export class JsonRpc {
  readonly child;
  onNotification: (method: string, params: unknown) => void = () => {};
  onRequest: (id: number | string, method: string, params: unknown) => void = () => {};
  onExit: (error: Error) => void = () => {};
  private nextId = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private buffer = '';
  private ended = false;
  constructor(path: string, args: string[], cwd?: string) {
    this.child = spawnAgent(path, args, cwd);
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      if (this.buffer.length > 16 * 1024 * 1024) { this.fail(new Error('Agent response exceeded the protocol buffer limit')); void this.close(); return; }
      let end: number;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        if (!line.trim()) continue;
        try { this.receive(JSON.parse(line) as RpcMessage); }
        catch { this.fail(new Error('Agent sent an invalid protocol message')); void this.close(); return; }
      }
    });
    this.child.stderr.resume();
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', (code, signal) => this.fail(new Error(`Agent disconnected (${signal || code || 'exit'})`)));
    this.child.stdin.on('error', error => this.fail(error));
  }
  private receive(message: RpcMessage) {
    if (message.method) {
      if (message.id !== undefined) this.onRequest(message.id, message.method, message.params);
      else this.onNotification(message.method, message.params);
    } else if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(string(record(message.error).message) || 'Agent request failed'));
      else pending.resolve(message.result);
    }
  }
  private fail(error: Error) {
    if (this.ended) return; this.ended = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.onExit(error);
  }
  send(message: RpcMessage) { if (this.ended) throw new Error('Agent connection is closed'); this.child.stdin.write(`${JSON.stringify(message)}\n`); }
  request<T = unknown>(method: string, params: unknown, timeout = 20000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeout);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { this.send({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async close() { this.fail(new Error('Agent connection closed')); await terminate(this.child); }
}
