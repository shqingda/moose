// utility process 入口：创建数据库和业务服务，处理主进程请求并回传结果或事件。
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { Store } from './db/store';
import { MooseService } from './service';
const port = process.parentPort;
if (!port) throw new Error('Moose runtime must be launched as a utility process');
const data = process.argv[2];
if (!data) throw new Error('Missing runtime data directory');
mkdirSync(data, { recursive: true });
if (existsSync(join(data, 'server.lock')))
  throw new Error('Stop the shared background service before opening this data in local mode');
const store = new Store(join(data, 'moose.sqlite'));
const service = new MooseService(store, (event) => port.postMessage({ event }));
// 接收父进程消息；下划线方法仅供主进程内部调用，其余交给 Service 白名单校验。
port.on('message', async ({ data: request }) => {
  const { id, method, params, clientId } = request;
  try {
    let result: unknown;
    if (method === '_shutdown') {
      await service.close();
      port.postMessage({ id, result: null });
      process.exit(0);
    } else if (method === '_addProject') result = await service.addProject(params.path);
    else if (method === '_importAttachments')
      result = await Promise.all(
        (params.paths as string[]).map((path) => service.attachments.importPath(path)),
      );
    else result = await service.handle(method, params, clientId);
    port.postMessage({ id, result });
  } catch (error) {
    port.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
port.postMessage({ ready: true });
