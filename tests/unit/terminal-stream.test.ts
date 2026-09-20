import { expect, it, vi } from 'vitest';
import { terminalStream } from '../../src/lib/terminal-stream';
import type { TerminalOutput, TerminalSession } from '../../shared/terminal';
const session: TerminalSession = {
  id: 'terminal',
  projectId: 'project',
  cwd: '/tmp',
  status: 'running',
  createdAt: 0,
  exitCode: null,
  cols: 80,
  rows: 24,
};
const output = (data: string, offset: number, reset = false): TerminalOutput => ({
  session,
  data,
  offset,
  reset,
});

it('deduplicates overlapping live output after replay and catches a missing range', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(output('abc', 3))
    .mockResolvedValueOnce(output('efgh', 8));
  let text = '';
  const stream = terminalStream(
    read,
    async (v) => {
      text += v.data;
    },
    (e) => {
      throw e;
    },
  );
  stream.sync();
  await vi.waitFor(() => expect(text).toBe('abc'));
  stream.push(output('bcd', 4));
  await vi.waitFor(() => expect(text).toBe('abcd'));
  stream.push(output('h', 8));
  await vi.waitFor(() => expect(text).toBe('abcdefgh'));
  expect(read.mock.calls).toEqual([[0], [4]]);
  stream.push(output('abc', 3));
  expect(text).toBe('abcdefgh');
  stream.close();
});

it('coalesces bursts during a slow write into one cursor replay without retaining every chunk', async () => {
  let release!: () => void;
  let text = '';
  const read = vi.fn().mockResolvedValue(output('bc', 3));
  const stream = terminalStream(
    read,
    async (v) => {
      if (v.offset === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      text += v.data;
    },
    (e) => {
      throw e;
    },
  );
  stream.push(output('a', 1));
  for (let i = 0; i < 1000; i++) stream.push(output('bc', 3));
  expect(read).not.toHaveBeenCalled();
  release();
  await vi.waitFor(() => expect(text).toBe('abc'));
  expect(read.mock.calls).toEqual([[1]]);
  stream.close();
});

it('replays on reconnect, propagates buffer truncation and final session state', async () => {
  const read = vi.fn().mockResolvedValue(output('retained', 100, true));
  const write = vi.fn(async (_v: TerminalOutput) => {});
  const stream = terminalStream(read, write, (e) => {
    throw e;
  });
  stream.sync();
  await vi.waitFor(() => expect(write).toHaveBeenCalledWith(output('retained', 100, true)));
  stream.push({ ...output('', 100), session: { ...session, status: 'completed' } });
  await vi.waitFor(() => expect(write.mock.calls.at(-1)?.[0].session.status).toBe('completed'));
  stream.close();
});

it('disposal prevents an in-flight replay from writing into a destroyed terminal', async () => {
  let resolve!: (v: TerminalOutput) => void;
  const write = vi.fn(async (_v: TerminalOutput) => {});
  const stream = terminalStream(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
    write,
    vi.fn(),
  );
  stream.sync();
  stream.close();
  resolve(output('late', 4));
  await Promise.resolve();
  expect(write).not.toHaveBeenCalled();
});
