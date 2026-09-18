// 真实 CLI 最小验收：隔离目录中的原生计划、批准执行与当前回合插话。会使用模型额度。
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexAdapter } from '../electron/providers/codex';
import type { AgentEvent, RunContext } from '../electron/providers/types';
import type { Session } from '../shared/types';
const cwd = await mkdtemp(join(tmpdir(), 'moose-native-live-'));
const session: Session = {
  id: randomUUID(),
  projectId: randomUUID(),
  provider: 'codex',
  nativeId: null,
  title: '',
  archived: false,
  model: 'gpt-5.6-luna',
  effort: 'low',
  mode: 'ask',
  draft: '',
  status: 'idle',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
const events = new Map<string, AgentEvent>();
const emit = (event: AgentEvent) => {
  const before = events.get(event.key);
  events.set(event.key, {
    ...before,
    ...event,
    text: event.text ?? (before?.text || '') + (event.delta || ''),
  });
};
async function run(text: string, mode: 'plan' | 'build', steerText?: string) {
  const agent = new CodexAdapter(process.env.MOOSE_CODEX_PATH || '/opt/homebrew/bin/codex');
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    void agent.cancel();
  }, 90000);
  let steering: Promise<string> | undefined;
  let firstTurn = '';
  const context: RunContext = {
    session,
    cwd,
    text,
    promptContext: { mode, references: [], skills: [] },
    nativeId: (id) => {
      session.nativeId = id;
    },
    emit,
    turnId: (id) => {
      if (!steerText || steering || !id) return;
      firstTurn = id;
      steering = agent.steer({ ...context, text: steerText });
      void steering.catch(() => {});
    },
  };
  try {
    await agent.run(context);
    assert.equal(expired, false, 'CLI timed out');
    if (steerText) {
      assert.ok(steering);
      assert.equal(await steering, firstTurn);
    }
  } finally {
    clearTimeout(timer);
    await agent.close();
  }
}
try {
  await writeFile(join(cwd, 'sample.txt'), 'READ_ONLY_MARKER');
  await run(
    'Produce a short final implementation plan to create result.txt containing exactly APPROVED_NATIVE_PLAN. No questions needed; filename and content are fully specified. Do not create or change any files yet.',
    'plan',
  );
  const plans = [...events.values()].filter((e) => e.kind === 'plan' && e.text?.trim());
  assert.ok(plans.length, 'No native plan item');
  assert.deepEqual(await readdir(cwd), ['sample.txt']);
  console.log(JSON.stringify({ nativePlan: true, planItems: plans.length, unchanged: true }));
  events.clear();
  await run(
    'Implement this user-approved revised plan: Create result.txt containing exactly EDITED_APPROVED_NATIVE_PLAN. Do not perform any other writes.',
    'build',
  );
  assert.equal(
    (await readFile(join(cwd, 'result.txt'), 'utf8')).trim(),
    'EDITED_APPROVED_NATIVE_PLAN',
  );
  console.log(JSON.stringify({ approvedExecution: true, editedScope: true }));
  events.clear();
  await run(
    'Read sample.txt and explain its contents. Do not change files.',
    'build',
    'New direction: ignore the earlier request to explain the file. Reply with exactly MOOSE_STEER_ACCEPTED. Do not change files.',
  );
  assert.ok(
    [...events.values()].some(
      (e) => e.kind === 'assistant' && e.text?.includes('MOOSE_STEER_ACCEPTED'),
    ),
  );
  console.log(JSON.stringify({ steering: true, sameTurn: true }));
} finally {
  await rm(cwd, { recursive: true, force: true });
}
