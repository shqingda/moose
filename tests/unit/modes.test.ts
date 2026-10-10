import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MooseService } from '../../electron/service';
import { Store } from '../../electron/db/store';
import {
  goalInstruction,
  selectPermission,
  taskPrompt,
  toolMutates,
} from '../../electron/providers/modes';
import type { RunContext } from '../../electron/providers/types';

const options = [
  { id: 'once', kind: 'allow_once', label: 'Allow once' },
  { id: 'always', kind: 'allow_always', label: 'Always' },
  { id: 'reject', kind: 'reject_once', label: 'Reject' },
];

it('maps permission choices without treating auto-approve as full access', () => {
  expect(selectPermission('auto', 'build', options, 'bash')).toEqual({
    action: 'select',
    optionId: 'once',
  });
  expect(selectPermission('full', 'build', options, 'bash')).toEqual({
    action: 'select',
    optionId: 'always',
  });
  expect(selectPermission('ask', 'build', options, 'bash')).toEqual({ action: 'ask' });
  expect(selectPermission('full', 'plan', options, 'bash', 'Run tests')).toEqual({
    action: 'select',
    optionId: 'reject',
  });
  expect(selectPermission('ask', 'plan', options, 'read', 'Read file')).toEqual({
    action: 'select',
    optionId: 'once',
  });
  expect(toolMutates('bash')).toBe(true);
  expect(toolMutates('read')).toBe(false);
});

it('adds plan and goal instructions only when the CLI has no native mode', () => {
  const context = {
    text: 'ship it',
    promptContext: { mode: 'plan' as const, references: [], skills: [] },
  } as unknown as RunContext;
  expect(taskPrompt(context, 'ship it')).toContain('Plan mode is active');
  expect(taskPrompt(context, 'ship it', { plan: true })).toBe('ship it');
  context.promptContext = { mode: 'goal', references: [], skills: [], goalBudget: 2000 };
  expect(taskPrompt(context, 'ship it')).toContain('Token budget: 2000');
  expect(taskPrompt(context, 'ship it', { goal: true })).toBe('ship it');
  expect(goalInstruction()).not.toContain('Token budget');
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('saves a reviewable plan when the provider only returns assistant text', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'moose-plan-')));
  dirs.push(dir);
  const store = new Store(join(dir, 'db.sqlite'));
  store.setSettings({ codexPath: resolve('tests/fixtures/agent.mjs') });
  let complete = () => {};
  let context: RunContext | undefined;
  const service = new MooseService(
    store,
    () => {},
    () => ({
      async probe() {
        return { models: [], modes: [] };
      },
      async run(value: RunContext) {
        context = value;
        await new Promise<void>((resolvePromise) => {
          complete = resolvePromise;
        });
      },
      respond() {},
      async cancel() {
        complete();
      },
      async close() {
        complete();
      },
    }),
  );
  try {
    const session = store.createSession(store.addProject(dir).id, 'codex');
    await service.handle('send', {
      sessionId: session.id,
      text: 'plan the change',
      context: { mode: 'plan', references: [], skills: [] },
    });
    await vi.waitFor(() => expect(context).toBeDefined());
    context!.emit({
      key: 'answer',
      kind: 'assistant',
      text: '1. Update the login form',
      state: 'done',
    });
    complete();
    await vi.waitFor(() =>
      expect(store.allMessages(session.id).some((message) => message.kind === 'plan')).toBe(true),
    );
    expect(
      store.allMessages(session.id).find((message) => message.kind === 'plan')?.text,
    ).toContain('login form');
  } finally {
    await service.close();
  }
});
