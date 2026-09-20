const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1200,
    height: 850,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
