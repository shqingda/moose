// 原生历史只读核验：不发送 prompt，不压缩、不分叉，不输出会话正文。
import { realpath } from 'node:fs/promises';
import { CodexAdapter } from '../electron/providers/codex';
import { GrokAdapter } from '../electron/providers/grok';
import { discover, cliVersion } from '../electron/providers/process';
const cwd = await realpath(process.argv[2] || process.cwd());
for (const [provider, Adapter] of [
  ['codex', CodexAdapter],
  ['grok', GrokAdapter],
] as const) {
  let adapter: CodexAdapter | GrokAdapter | undefined;
  try {
    const path = await discover(
      provider,
      process.env[provider === 'codex' ? 'MOOSE_CODEX_PATH' : 'MOOSE_GROK_PATH'] || '',
    );
    adapter = new Adapter(path);
    const version = await cliVersion(path),
      capabilities = await adapter.sessions.capabilities();
    const page = await adapter.sessions.list(cwd);
    const target = page.data.find((thread) => thread.status !== 'active');
    let preview;
    if (target) {
      const thread = await adapter.sessions.read(target.id, cwd);
      const items = await adapter.sessions.items(thread.id, cwd);
      preview = { status: thread.status, entries: items.data.length, more: !!items.nextCursor };
    }
    console.log(
      JSON.stringify({
        provider,
        version,
        capabilities,
        threads: page.data.length,
        more: !!page.nextCursor,
        preview,
      }),
    );
  } catch (error) {
    console.error(provider, String(error));
    process.exitCode = 1;
  } finally {
    await adapter?.close();
  }
}
