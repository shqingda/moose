import { afterEach, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { AcpSessions } from '../../electron/providers/acp-sessions';
afterEach(() => vi.unstubAllEnvs());
it('reads OpenCode native directory and replays history without a model prompt', async () => {
  const sessions = new AcpSessions(resolve('tests/fixtures/opencode.mjs'), 'opencode');
  try {
    expect(await sessions.capabilities()).toMatchObject({
      history: true,
      fork: false,
      compact: false,
    });
    const list = await sessions.list(process.cwd());
    expect(list.data[0]).toMatchObject({ id: 'opencode-history', cwd: process.cwd() });
    const result = await sessions.items('opencode-history', process.cwd());
    expect(result.data.map((item) => item.text)).toEqual(['HISTORICAL_REPLAY']);
    await expect(sessions.read('other', process.cwd())).rejects.toThrow('not found');
  } finally {
    await sessions.close();
  }
});

it('rejects old OpenCode versions before opening an ACP history connection', async () => {
  vi.stubEnv('MOOSE_TEST_OPENCODE_VERSION', 'opencode v1.2.0');
  const sessions = new AcpSessions(resolve('tests/fixtures/opencode.mjs'), 'opencode');
  try {
    await expect(sessions.capabilities()).rejects.toThrow('v2 is required');
  } finally {
    await sessions.close();
  }
});
it('does not start a history process after closing during version discovery', async () => {
  const sessions = new AcpSessions(resolve('tests/fixtures/opencode.mjs'), 'opencode');
  const probing = sessions.capabilities();
  const rejected = expect(probing).rejects.toThrow('closed');
  await sessions.close();
  await rejected;
  await expect(sessions.list(process.cwd())).rejects.toThrow('closed');
});
it('bounds total replay memory even when each individual row is within its limit', async () => {
  vi.stubEnv('MOOSE_TEST_LARGE_HISTORY', '1');
  const sessions = new AcpSessions(resolve('tests/fixtures/opencode.mjs'), 'opencode');
  try {
    await expect(sessions.items('opencode-history', process.cwd())).rejects.toThrow(
      'exceeds the import limit',
    );
  } finally {
    await sessions.close();
  }
});
