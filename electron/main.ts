import {
  app,
  clipboard,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  shell,
  systemPreferences,
} from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { RuntimeHost } from './runtime-host';
import { openEditor } from './editor';
import { validate } from '../shared/validation';
import type { AppEvent, Method, Requests, Snapshot, Settings } from '../shared/types';

const directory = fileURLToPath(new URL(/* @vite-ignore */ '.', import.meta.url));
const rendererRoot = resolve(directory, '../../dist');
const isDev = !!process.env.VITE_DEV_SERVER_URL;
app.setName(isDev ? 'Moose Dev' : 'Moose');
if (process.env.MOOSE_DATA_DIR) app.setPath('userData', process.env.MOOSE_DATA_DIR);
else if (isDev) app.setPath('userData', join(app.getPath('appData'), 'Moose Dev'));
protocol.registerSchemesAsPrivileged([
  { scheme: 'moose', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
let window: BrowserWindow | null = null;
let quitting = false;
const emit = (event: AppEvent) => {
  if (window && !window.isDestroyed()) window.webContents.send('moose:event', event);
};
const runtime = new RuntimeHost(
  join(directory, '../runtime/runtime.js'),
  app.getPath('userData'),
  emit,
);
process.on('SIGTERM', () => app.quit());
process.on('SIGINT', () => app.quit());
const appearance = () => ({
  locale: app.getLocale(),
  dark: nativeTheme.shouldUseDarkColors,
  reduceMotion: systemPreferences.getAnimationSettings().prefersReducedMotion,
  reduceTransparency: nativeTheme.prefersReducedTransparency,
  highContrast: nativeTheme.shouldUseHighContrastColors,
});

/** 创建隔离的渲染窗口，限制导航和权限，并加载开发页或正式应用协议。 */
async function createWindow() {
  if (window) {
    window.show();
    return;
  }
  window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    title: 'Moose',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: join(directory, '../preload/preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window?.webContents.getURL()) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (url !== window?.webContents.getURL()) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const csp = `default-src 'self'; script-src 'self'${isDev ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'${isDev ? ' ws://127.0.0.1:5173 http://127.0.0.1:5173' : ''}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => {
    window = null;
  });
  if (isDev) await window.loadURL(process.env.VITE_DEV_SERVER_URL!);
  else await window.loadURL('moose://app/index.html');
}
/** 根据界面语言创建原生菜单，把快捷键转换成渲染层 command 事件。 */
function menu(language: Settings['language'] = 'system') {
  const zh = language === 'zh-CN' || (language === 'system' && app.getLocale().startsWith('zh'));
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Moose',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          {
            label: zh ? '设置…' : 'Settings…',
            accelerator: 'CmdOrCtrl+,',
            click: () => emit({ type: 'command', command: 'settings' }),
          },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: zh ? '文件' : 'File',
        submenu: [
          {
            label: zh ? '打开项目…' : 'Open Project…',
            accelerator: 'CmdOrCtrl+O',
            click: () => emit({ type: 'command', command: 'open' }),
          },
          {
            label: zh ? '新建会话' : 'New Session',
            accelerator: 'CmdOrCtrl+N',
            click: () => emit({ type: 'command', command: 'new' }),
          },
          {
            label: zh ? '快速切换' : 'Quick Switch',
            accelerator: 'CmdOrCtrl+K',
            click: () => emit({ type: 'command', command: 'search' }),
          },
          { role: 'close' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          {
            label: zh ? '切换侧边栏' : 'Toggle Sidebar',
            accelerator: 'CmdOrCtrl+B',
            click: () => emit({ type: 'command', command: 'sidebar' }),
          },
          {
            label: zh ? '审阅改动' : 'Review Changes',
            accelerator: 'CmdOrCtrl+Shift+B',
            click: () => emit({ type: 'command', command: 'review' }),
          },
          {
            label: zh ? '用量' : 'Usage',
            accelerator: 'CmdOrCtrl+U',
            click: () => emit({ type: 'command', command: 'usage' }),
          },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'togglefullscreen' },
          ...(isDev ? [{ role: 'toggleDevTools' as const }] : []),
        ],
      },
      { role: 'windowMenu' },
    ]),
  );
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    void createWindow();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      protocol.handle('moose', (request) => {
        const url = new URL(request.url),
          path = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`),
          rel = relative(rendererRoot, path);
        if (url.host !== 'app' || rel.startsWith('..') || isAbsolute(rel))
          return new Response('Not found', { status: 404 });
        return net.fetch(pathToFileURL(path).toString());
      });
      // 页面请求的安全网关：确认来源 frame 和参数，再处理原生能力或转发后台。
      ipcMain.handle('moose:request', async (event, method: Method, input: unknown) => {
        const frame = event.senderFrame;
        if (
          !window ||
          frame !== window.webContents.mainFrame ||
          !(
            frame.url.startsWith('moose://app/') ||
            (isDev &&
              new URL(frame.url).origin === new URL(process.env.VITE_DEV_SERVER_URL!).origin)
          )
        )
          throw new Error('Untrusted IPC sender');
        const params = validate(method, input);
        if (method === 'addProject') {
          const result = await dialog.showOpenDialog(window, {
            properties: ['openDirectory'],
            buttonLabel: 'Open project',
          });
          return result.canceled
            ? null
            : runtime.request('_addProject', { path: result.filePaths[0] });
        }
        if (method === 'pickAttachments') {
          const result = await dialog.showOpenDialog(window, {
            properties: ['openFile', 'multiSelections'],
          });
          if (result.filePaths.length > 10) throw new Error('Select at most 10 attachments.');
          return result.canceled
            ? []
            : runtime.request('_importAttachments', { paths: result.filePaths });
        }
        if (method === 'copyText') {
          clipboard.writeText((params as Requests['copyText']).text);
          return null;
        }
        if (method === 'openExternal') {
          await shell.openExternal((params as Requests['openExternal']).url);
          return null;
        }
        if (method === 'openProject') {
          const p = params as Requests['openProject'],
            path = (await runtime.request('_projectPath', { projectId: p.projectId })) as string;
          if (p.target === 'finder') {
            const error = await shell.openPath(path);
            if (error) throw new Error(error);
          } else await openEditor(path);
          return null;
        }
        const result = await runtime.request(method, params);
        if (method === 'snapshot' || method === 'settings') {
          const settings =
            method === 'snapshot' ? (result as Snapshot).settings : (result as Settings);
          if (settings && nativeTheme.themeSource !== settings.theme)
            nativeTheme.themeSource = settings.theme;
          if (settings) menu(settings.language);
        }
        if (method === 'snapshot') return { ...(result as Snapshot), ...appearance() };
        return result;
      });
      nativeTheme.on('updated', () => emit({ type: 'appearance' }));
      menu();
      await createWindow();
    })
    .catch((error) => {
      dialog.showErrorBox('Moose could not start', String(error));
      app.quit();
    });
  app.on('activate', () => {
    void createWindow();
  });
  app.on('window-all-closed', () => {
    /* macOS keeps active tasks running until Cmd+Q. */
  });
  // 退出前等待后台取消任务并落库；第二次 app.quit 才真正结束应用。
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void runtime
      .close()
      .catch(console.error)
      .finally(() => app.quit());
  });
}
