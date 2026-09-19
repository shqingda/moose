import { expect, it, vi } from 'vitest';
import { CodexSessions } from '../../electron/providers/codex-sessions';
import { normalizeCodex } from '../../electron/providers/codex';
import type { JsonRpc } from '../../electron/providers/rpc';
import type { Session } from '../../shared/types';
function fixture() {
  const request = vi.fn(async (method: string) => {
    if (method === 'thread/read')
      return { thread: { id: 'root', status: { type: 'idle' }, cwd: '/tmp', updatedAt: 0 } };
    return {};
  });
  const native = new CodexSessions(async () => ({ request }) as unknown as JsonRpc, normalizeCodex);
  native.handshake('Codex Desktop/0.155.1');
  return { request, native, session: { nativeId: 'root', mode: 'ask' } as Session };
}
it('requires the verified protocol version and does not advertise unsupported old versions', async () => {
  const { native } = fixture();
  native.handshake('Codex Desktop/0.100.0');
  expect((await native.capabilities()).history).toBe(false);
  await expect(native.list('/tmp')).rejects.toThrow('0.155+');
});
it('does not report compaction success from its RPC receipt or another thread completion', async () => {
  const { native, request, session } = fixture();
  let done = false;
  const pending = native.compact(session, '/tmp').then(() => {
    done = true;
  });
  await vi.waitFor(() =>
    expect(request).toHaveBeenCalledWith('thread/compact/start', { threadId: 'root' }),
  );
  expect(done).toBe(false);
  native.notification('turn/completed', {
    threadId: 'child',
    turn: { id: 'other', status: 'completed' },
  });
  expect(done).toBe(false);
  native.notification('turn/started', { threadId: 'root', turn: { id: 'compact' } });
  native.notification('item/completed', { threadId: 'root', item: { type: 'contextCompaction' } });
  native.notification('turn/completed', {
    threadId: 'root',
    turn: { id: 'compact', status: 'completed' },
  });
  await pending;
  expect(done).toBe(true);
});
it('reports interrupted compaction and never treats loading a child as resuming its task', async () => {
  const { native, request, session } = fixture();
  const pending = native.compact(session, '/tmp');
  const rejection = expect(pending).rejects.toThrow('Compaction did not complete');
  await vi.waitFor(() =>
    expect(request).toHaveBeenCalledWith('thread/compact/start', { threadId: 'root' }),
  );
  native.notification('turn/completed', {
    threadId: 'root',
    turn: { id: 'compact', status: 'interrupted' },
  });
  await rejection;
  request.mockClear();
  await expect(native.control('child', 'resume')).rejects.toThrow('cannot resume');
  expect(request.mock.calls.map(([method]) => method)).not.toContain('thread/resume');
});
