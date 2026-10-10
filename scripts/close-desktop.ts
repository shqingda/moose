import type { ElectronApplication } from '@playwright/test';

/**
 * Close the desktop app and return once its process has exited. On Linux the detached shared service
 * inherits the desktop's Playwright pipes, so `app.close()` alone waits for that service to stop too.
 */
export async function closeDesktop(app: ElectronApplication) {
  const child = app.process();
  const exited =
    child.exitCode === null && child.signalCode === null
      ? new Promise((resolve) => child.once('exit', resolve))
      : Promise.resolve();
  const closing = app.close();
  closing.catch(() => {});
  await Promise.race([closing, exited]);
}
