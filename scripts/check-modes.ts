// 模式验收脚本：在隔离目录检查代理的 Plan / Goal 等执行行为。
import { CodexAdapter } from '../electron/providers/codex';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Session } from '../shared/types';
const cwd = await mkdtemp(join(tmpdir(), 'moose-modes-'));
await writeFile(join(cwd, 'sample.txt'), 'MOOSE_READ_ONLY_729');
for (const mode of ['plan', 'goal'] as const) {
  const agent = new CodexAdapter('/opt/homebrew/bin/codex');
  const session: Session = {
    id: randomUUID(),
    projectId: randomUUID(),
    provider: 'codex',
    title: '',
    nativeId: null,
    archived: false,
    model: 'gpt-5.6-luna',
    effort: 'low',
    mode: 'ask',
    draft: '',
    status: 'idle',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  let answer = '';
  const timer = setTimeout(() => {
    void agent.cancel();
  }, 90000);
  try {
    await agent.run({
      session,
      cwd,
      text:
        mode === 'plan'
          ? 'Read the referenced sample.txt and propose a one-step plan to rename it. Include its current content in your answer. Do not make changes.'
          : 'Reply with MOOSE_GOAL_DONE_729 and mark this goal complete. No tools other than completing the goal are needed.',
      promptContext: { mode, references: [], skills: [] },
      selection: {
        references:
          mode === 'plan'
            ? [
                {
                  id: 'sample',
                  name: 'sample.txt',
                  path: join(cwd, 'sample.txt'),
                  kind: 'file',
                  scope: 'project',
                  description: '',
                },
              ]
            : [],
        skills: [],
      },
      nativeId: (id) => {
        session.nativeId = id;
      },
      emit: (event) => {
        if (event.kind === 'assistant') answer = event.text ?? answer + (event.delta || '');
        if (event.kind === 'approval') throw new Error('Unexpected approval');
      },
    });
    console.log(
      JSON.stringify({
        mode,
        answer,
        unchanged: (await readFile(join(cwd, 'sample.txt'), 'utf8')) === 'MOOSE_READ_ONLY_729',
      }),
    );
    if (!answer.includes(mode === 'plan' ? 'MOOSE_READ_ONLY_729' : 'MOOSE_GOAL_DONE_729'))
      throw new Error('Missing live response');
  } finally {
    clearTimeout(timer);
    await agent.close();
  }
}
