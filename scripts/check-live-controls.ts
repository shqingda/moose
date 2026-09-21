// Explicit live checks: temporary repositories only; no user configuration is changed.
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createAdapter } from '../electron/providers/registry';
import { discover } from '../electron/providers/process';
import type { Session } from '../shared/types';

for (const provider of ['pi', 'opencode'] as const) {
  const cwd = await mkdtemp(join(tmpdir(), `moose-controls-${provider}-`));
  execFileSync('/usr/bin/git', ['init', '-q', cwd]);
  if (provider === 'opencode')
    await writeFile(
      join(cwd, 'opencode.jsonc'),
      JSON.stringify({
        permissions: [{ action: 'shell', resource: '*', effect: 'ask' }],
      }),
    );
  const session: Session = {
    id: randomUUID(),
    projectId: randomUUID(),
    provider,
    title: 'Live controls',
    archived: false,
    nativeId: null,
    model: process.env[`MOOSE_LIVE_${provider.toUpperCase()}_MODEL`] || '',
    effort: '',
    mode: provider === 'pi' ? 'full' : 'ask',
    draft: '',
    status: 'idle',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const path = await discover(provider, '');
  for (const scenario of provider === 'pi' ? ['cancel'] : ['allow', 'reject', 'cancel']) {
    session.nativeId = null;
    const adapter = createAdapter(provider, path);
    let approvals = 0;
    let cancelled = false;
    let settled = false;
    let failure: unknown;
    const marker = `${scenario}.txt`;
    const command =
      scenario === 'cancel'
        ? 'printf ready > started.txt; sleep 15; printf late > cancel.txt'
        : `printf approved > ${marker}`;
    const run = adapter
      .run({
        session,
        cwd,
        text: `Isolated acceptance test. Run exactly this shell command once: ${command}. Do not read other directories, use network, or use file editing tools. If permission is rejected, stop without trying another method. Reply briefly.`,
        nativeId(id) {
          session.nativeId = id;
        },
        emit(event) {
          if (event.kind !== 'approval') return;
          approvals++;
          const kind = scenario === 'reject' ? 'reject_once' : 'allow_once';
          const choice = event.choices?.find((item) => item.kind === kind);
          if (!choice) {
            failure = new Error(`Missing ${kind} choice`);
            void adapter.cancel();
            return;
          }
          adapter.respond(event.key, choice.id);
        },
      })
      .catch((error) => {
        failure = error;
      })
      .finally(() => {
        settled = true;
      });
    const deadline = Date.now() + 90000;
    try {
      while (!settled && Date.now() < deadline) {
        if (scenario === 'cancel' && !cancelled) {
          const started = await access(join(cwd, 'started.txt')).then(
            () => true,
            () => false,
          );
          if (started) {
            cancelled = true;
            await adapter.cancel();
          }
        }
        await delay(100);
      }
      assert.ok(settled, 'Live task timed out');
      if (!cancelled && failure) throw failure;
      if (scenario === 'cancel') {
        assert.ok(cancelled, 'Cancellation must happen after the shell starts');
        await delay(17000);
        assert.equal(
          await access(join(cwd, marker)).then(
            () => true,
            () => false,
          ),
          false,
          'Cancelled shell must not write a late marker',
        );
      } else {
        assert.ok(approvals > 0, 'Expected a real permission request');
        if (scenario === 'allow')
          assert.equal(await readFile(join(cwd, marker), 'utf8'), 'approved');
        else
          assert.equal(
            await access(join(cwd, marker)).then(
              () => true,
              () => false,
            ),
            false,
          );
      }
      console.log(
        JSON.stringify({ provider, scenario, approvals, cancelled, result: 'passed', cwd }),
      );
    } catch (error) {
      console.error(JSON.stringify({ provider, scenario, error: String(error), cwd }));
      process.exitCode = 1;
    } finally {
      await adapter.close();
      await run;
    }
  }
}
