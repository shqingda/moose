import { app, dialog, net, shell } from 'electron';

let checking = false;
/** User-initiated release check; installation remains an explicit download. */
export async function checkForUpdates(zh: boolean) {
  if (checking) return;
  checking = true;
  const title = zh ? '检查更新' : 'Check for Updates';
  try {
    const response = await net.fetch(
      'https://api.github.com/repos/shqingda/moose/releases/latest',
      {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const release = (await response.json()) as { tag_name?: string };
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(release.tag_name || '');
    if (!match) throw new Error('Invalid release version');
    const latest = match.slice(1).map(Number);
    const current = app.getVersion().split('.').map(Number);
    const difference = latest.map((part, index) => part - (current[index] || 0)).find(Boolean) || 0;
    const available = difference > 0;
    const result = await dialog.showMessageBox({
      type: 'info',
      title,
      message: available
        ? zh
          ? `Moose ${latest.join('.')} 可供下载`
          : `Moose ${latest.join('.')} is available`
        : zh
          ? '已是最新版本'
          : 'You’re up to date',
      detail: zh ? `当前版本 ${app.getVersion()}` : `Current version ${app.getVersion()}`,
      buttons: available ? (zh ? ['前往下载', '稍后'] : ['Download', 'Later']) : [zh ? '好' : 'OK'],
      cancelId: available ? 1 : 0,
    });
    if (available && result.response === 0)
      await shell.openExternal(
        `https://github.com/shqingda/moose/releases/tag/v${latest.join('.')}`,
      );
  } catch {
    await dialog.showMessageBox({
      type: 'error',
      title,
      message: zh ? '暂时无法检查更新' : 'Unable to check for updates',
      detail: zh ? '请检查网络连接后重试。' : 'Check your connection and try again.',
    });
  } finally {
    checking = false;
  }
}
