// 只做 CLI 发现和协议能力探测，输出可用于连接诊断的模型与权限信息。
import { CodexAdapter } from '../electron/providers/codex';
import { GrokAdapter } from '../electron/providers/grok';
import { discover, cliVersion } from '../electron/providers/process';
for (const provider of ['codex', 'grok'] as const) {
  let adapter;
  try {
    const path = await discover(provider, '');
    adapter = provider === 'codex' ? new CodexAdapter(path) : new GrokAdapter(path);
    const info = await adapter.probe();
    console.log(
      JSON.stringify({
        provider,
        version: await cliVersion(path),
        connected: true,
        models: info.models.map((m) => m.id),
      }),
    );
  } catch (error) {
    console.error(provider, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await adapter?.close();
  }
}
