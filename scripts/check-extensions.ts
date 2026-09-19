// Read-only native diagnostic: never prints raw configuration, OAuth URLs or backend errors.
import { CodexExtensions } from '../electron/providers/codex-extensions';
import { discover } from '../electron/providers/process';
const client = new CodexExtensions(await discover('codex', ''));
try {
  const result = await client.read(process.cwd());
  console.log(
    JSON.stringify(
      {
        version: result.version,
        supported: result.supported,
        sources: result.sources.map((s) => ({
          kind: s.kind,
          writable: s.writable,
          disabled: s.disabled,
        })),
        settings: result.settings.length,
        mcp: result.mcp.length,
        plugins: result.plugins.length,
        hooks: result.hooks.length,
        diagnostics: result.diagnostics.map((d) => d.area),
      },
      null,
      2,
    ),
  );
} catch {
  console.error('Native extension diagnostics failed; raw errors are hidden.');
  process.exitCode = 1;
} finally {
  await client.close();
}
