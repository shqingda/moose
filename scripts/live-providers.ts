// 真实代理验收入口；会调用本机 CLI，在隔离目录检查生成与恢复，不属于常规单元测试。
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createAdapter } from '../electron/providers/registry';
import { providerIds } from '../shared/providers';
import { strict as assert } from 'node:assert';
import { discover } from '../electron/providers/process';
import type { Session } from '../shared/types';
import { providerError, type AgentAdapter } from '../electron/providers/types';

// Explicit live acceptance test. All edits are confined to fresh temporary Git repositories.
const requested = process.argv.slice(2);
if (requested.some((id) => !providerIds.some((provider) => provider === id)))
  throw new Error(`Expected provider names: ${providerIds.join(', ')}`);
const selected = requested.length
  ? providerIds.filter((id) => requested.includes(id))
  : (['codex', 'grok'] as const);
for (const provider of selected) {
  const cwd = await mkdtemp(join(tmpdir(), `moose-live-${provider}-`));
  execFileSync('/usr/bin/git', ['init', '-q', cwd]);
  const session: Session = {
    id: randomUUID(),
    projectId: randomUUID(),
    provider,
    title: 'Acceptance test',
    archived: false,
    nativeId: null,
    model: process.env[`MOOSE_LIVE_${provider.toUpperCase()}_MODEL`] || '',
    effort: '',
    mode: provider === 'pi' ? 'full' : '',
    draft: '',
    status: 'idle',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const path = await discover(provider, '');
  let approvals = 0,
    tools = 0;
  for (const [turn, text] of [
    'This is an isolated acceptance-test repository. Create exactly one file named hello.txt containing moose-ready followed by a newline. Do not read any other directories or use network tools. Do not commit. Then reply with one short sentence.',
    'Continue the previous task: append a second line saying resumed-ok to the file you just created. Keep the first line unchanged. Do not touch other files or commit. Then reply with one short sentence.',
  ].entries()) {
    const adapter: AgentAdapter = createAdapter(provider, path);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        adapter.run({
          session,
          cwd,
          text,
          nativeId: (id) => {
            session.nativeId = id;
          },
          emit: (event) => {
            if (event.kind === 'tool') tools++;
            if (event.kind === 'approval') {
              const allow = event.choices?.find(
                (choice) => choice.id === 'accept' || choice.kind === 'allow_once',
              );
              if (!allow) throw new Error('No allow-once choice in live fixture');
              approvals++;
              adapter.respond(event.key, allow.id);
            }
          },
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            void adapter.cancel();
            reject(new Error('Live turn timed out'));
          }, 120000);
        }),
      ]);
      const content = await readFile(join(cwd, 'hello.txt'), 'utf8');
      assert.equal(content, turn === 0 ? 'moose-ready\n' : 'moose-ready\nresumed-ok\n');
      assert.ok(session.nativeId, 'Provider must return a native session ID');
      console.log(
        JSON.stringify({
          provider,
          turn: turn + 1,
          resumed: turn > 0,
          content,
        }),
      );
    } catch (error) {
      console.error(provider, providerError(error));
      process.exitCode = 1;
      break;
    } finally {
      clearTimeout(timeout);
      await adapter.close();
    }
  }
  console.log(JSON.stringify({ provider, cwd, tools, approvals }));
}
