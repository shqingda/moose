const { app, BrowserWindow } = require('electron');
const background = process.env.MOOSE_TEST_BACKGROUND === '1';
app.whenReady().then(async () => {
  if (background) await app.dock?.hide();
  const window = new BrowserWindow({
    show: !background,
    width: 1200,
    height: 850,
    webPreferences: {
      backgroundThrottling: !background,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
