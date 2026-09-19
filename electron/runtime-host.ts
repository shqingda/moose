import { utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import type { AppEvent } from '../shared/types';
export class RuntimeHost {
  private child?: UtilityProcess;
  private pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private boot?: Promise<void>;
  private closing = false;
  constructor(
    private entry: string,
    private data: string,
    private emit: (event: AppEvent) => void,
  ) {}
  /** 按需启动唯一后台运行进程，等待 ready，并转发事件与匹配请求响应。 */
  start() {
    if (this.boot) return this.boot;
    this.boot = new Promise<void>((resolve, reject) => {
      const child = (this.child = utilityProcess.fork(this.entry, [this.data], {
        serviceName: 'Moose Agent Runtime',
        stdio: 'pipe',
      }));
      const timer = setTimeout(() => {
        reject(new Error('Moose runtime could not start'));
        child.kill();
      }, 15000);
      child.stdout?.resume();
      child.stderr?.on('data', (data) =>
        console.error('[runtime]', data.toString().slice(0, 2000)),
      );
      child.on('message', (message) => {
        if (message.ready) {
          clearTimeout(timer);
          resolve();
        } else if (message.event) this.emit(message.event);
        else {
          const request = this.pending.get(message.id);
          if (!request) return;
          this.pending.delete(message.id);
          clearTimeout(request.timer);
          if (message.error) request.reject(new Error(message.error));
          else request.resolve(message.result);
        }
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        this.boot = undefined;
        this.child = undefined;
        const error = new Error(`Moose runtime exited (${code}). Reopen the window to reconnect.`);
        reject(error);
        for (const request of this.pending.values()) {
          clearTimeout(request.timer);
          if (this.closing && code === 0) request.resolve(null);
          else request.reject(error);
        }
        this.pending.clear();
        if (!this.closing) this.emit({ type: 'runtime-error', error: error.message });
      });
    });
    return this.boot;
  }
  /** 通过 ID 关联跨进程请求；操作超时后拒绝 Promise 并清理记录。 */
  async request(method: string, params: unknown): Promise<unknown> {
    await this.start();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error(`Operation timed out: ${method}`));
        },
        (
          {
            providers: 65000,
            prPreview: 120000,
            prCreate: 180000,
            reviewStart: 90000,
            gitCommit: 30000,
            worktreeCreate: 90000,
            worktreeStatus: 90000,
            worktreeRemove: 90000,
            worktreeMerge: 120000,
            worktreeResolve: 90000,
            worktreeComplete: 90000,
            worktreeAbort: 90000,
            nativeCompact: 180000,
            nativeImport: 180000,
            nativeFork: 180000,
            nativeRead: 65000,
            childRead: 65000,
            childControl: 85000,
          } as Record<string, number>
        )[method] || 20000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.child!.postMessage({ id, method, params });
    });
  }
  /** 先请求后台有序停止和落库，最后确保 utility process 退出。 */
  async close() {
    this.closing = true;
    if (this.child) {
      try {
        await this.request('_shutdown', {});
      } finally {
        this.child?.kill();
      }
    }
  }
}
