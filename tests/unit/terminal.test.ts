import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../electron/db/store';
import { TerminalSessions } from '../../electron/terminal-sessions';
import { validate } from '../../shared/validation';

it('recovers terminal metadata without restarting processes and reports missing output explicitly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'moose-terminal-')),
    store = new Store(join(dir, 'db.sqlite'));
  const project = store.addProject(dir);
  store.sqlite.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(
    'terminal:test',
    JSON.stringify({
      id: 'test',
      projectId: project.id,
      cwd: dir,
      status: 'running',
      createdAt: 1,
      exitCode: null,
      cols: 80,
      rows: 24,
      output: 'retained',
      offset: 100,
    }),
  );
  const sessions = new TerminalSessions(store, () => {
    throw new Error('Must not start a recovered terminal');
  });
  try {
    expect(sessions.list(project.id)[0].status).toBe('unknown');
    expect(sessions.read({ id: 'test', offset: 0 })).toMatchObject({
      data: 'retained',
      offset: 100,
      reset: true,
    });
    expect(sessions.read({ id: 'test', offset: 96 })).toMatchObject({
      data: 'ined',
      offset: 100,
      reset: false,
    });
    expect(sessions.read({ id: 'test', offset: 100 })).toMatchObject({ data: '', reset: false });
    expect(sessions.read({ id: 'test', offset: 101 }).reset).toBe(true);
    expect(() => sessions.input({ id: 'test', text: 'should not replay' })).toThrow(
      'no longer running',
    );
    expect(sessions.list(project.id)[0]).not.toHaveProperty('output');
  } finally {
    await sessions.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it('rejects oversized terminal input, dimensions and invalid stream offsets at IPC', () => {
  expect(() =>
    validate('terminalInput', {
      id: '11111111-1111-4111-8111-111111111111',
      text: 'x'.repeat(16001),
    }),
  ).toThrow();
  for (const size of [
    { cols: 0, rows: 24 },
    { cols: 80, rows: 201 },
    { cols: 80.5, rows: 24 },
  ])
    expect(() =>
      validate('terminalResize', { id: '11111111-1111-4111-8111-111111111111', ...size }),
    ).toThrow();
  for (const offset of [-1, NaN, Infinity, 0.5])
    expect(() =>
      validate('terminalRead', { id: '11111111-1111-4111-8111-111111111111', offset }),
    ).toThrow();
  expect(() =>
    validate('terminalInput', { id: '11111111-1111-4111-8111-111111111111', text: '\x03' }),
  ).not.toThrow();
});
