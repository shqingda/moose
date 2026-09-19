import { z } from 'zod';
import { spawnAgent, terminate } from './process';
import type { ExtensionSnapshot } from '../../shared/extensions';
const entry = z.object({
  pluginId: z.string().min(1),
  name: z.string(),
  marketplaceName: z.string(),
  installed: z.boolean(),
  enabled: z.boolean(),
  installPolicy: z.string(),
  authPolicy: z.string(),
});
const catalog = z.object({ installed: z.array(entry), available: z.array(entry) });
/** Use the supported CLI: app-server plugin mutation APIs are not production-ready. */
export class CodexPlugins {
  private closed = false;
  private children = new Set<ReturnType<typeof spawnAgent>>();
  constructor(private path: string) {}
  private async command(cwd: string, args: string[]): Promise<string> {
    if (this.closed) throw new Error('Plugin client is closed');
    const child = spawnAgent(this.path, ['plugin', args[0], '--json', ...args.slice(1)], cwd);
    this.children.add(child);
    child.stdin.end();
    try {
      return await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const fail = () => {
          void terminate(child);
          reject(new Error('Native plugin command failed'));
        };
        const timer = setTimeout(fail, 60000);
        child.stdout.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 16 * 1024 * 1024) fail();
          else chunks.push(chunk);
        });
        child.stderr.resume(); // Never forward native errors: they may contain credentials.
        child.once('error', () => {
          clearTimeout(timer);
          fail();
        });
        child.once('close', (code) => {
          clearTimeout(timer);
          if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'));
          else fail();
        });
      });
    } finally {
      await terminate(child);
      this.children.delete(child);
    }
  }
  async list(cwd: string): Promise<ExtensionSnapshot['plugins']> {
    const result = catalog.parse(JSON.parse(await this.command(cwd, ['list', '--available'])));
    const rows = new Map<string, ExtensionSnapshot['plugins'][number]>();
    for (const p of [...result.available, ...result.installed])
      rows.set(p.pluginId, {
        id: p.pluginId,
        name: p.name,
        marketplace: p.marketplaceName,
        installed: p.installed,
        enabled: p.enabled,
        installable: p.installPolicy === 'AVAILABLE' && p.authPolicy !== 'ON_INSTALL',
        removable: p.installPolicy === 'AVAILABLE',
      });
    return [...rows.values()].sort(
      (a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name),
    );
  }
  async change(cwd: string, id: string, action: 'install' | 'uninstall') {
    const plugin = (await this.list(cwd)).find((p) => p.id === id);
    if (!plugin) throw new Error('Plugin catalog changed');
    if (action === 'install' ? plugin.installed : !plugin.installed) return;
    if (action === 'install' ? !plugin.installable : !plugin.removable)
      throw new Error('Manage this plugin in the provider CLI');
    await this.command(cwd, [action === 'install' ? 'add' : 'remove', '--', plugin.id]);
  }
  async close() {
    this.closed = true;
    await Promise.all([...this.children].map(terminate));
  }
}
