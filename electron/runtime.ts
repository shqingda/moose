import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Store } from './db/store';
import { MooseService } from './service';
const port = process.parentPort;
if (!port) throw new Error('Moose runtime must be launched as a utility process');
const data = process.argv[2];
if (!data) throw new Error('Missing runtime data directory');
mkdirSync(data, { recursive: true });
const store = new Store(join(data, 'moose.sqlite'));
const service = new MooseService(store, event => port.postMessage({ event }));
port.on('message', async ({ data: request }) => {
  const { id, method, params } = request;
  try {
    let result: unknown;
    if (method === '_shutdown') { await service.close(); port.postMessage({ id, result: null }); process.exit(0); }
    else if (method === '_addProject') result = await service.addProject(params.path);
    else if (method === '_importAttachments') result = await Promise.all((params.paths as string[]).map(path => service.attachments.importPath(path)));
    else if (method === '_projectPath') result = store.project(params.projectId).path;
    else result = await service.handle(method, params);
    port.postMessage({ id, result });
  } catch (error) { port.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
});
port.postMessage({ ready: true });
