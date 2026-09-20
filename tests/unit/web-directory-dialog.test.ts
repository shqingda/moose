import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const exec = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: exec }));
import { nativeDirectoryAvailable, pickWebDirectory } from '../../electron/web-directory-dialog';

beforeEach(() => {
  exec.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
describe('Web native folder chooser', () => {
  it('returns a path with spaces without invoking a shell', async () => {
    exec.mockImplementation((_file, _args, _options, callback) =>
      callback(null, '/Users/me/My Project/\n', ''),
    );
    await expect(pickWebDirectory(new AbortController().signal)).resolves.toBe(
      '/Users/me/My Project/',
    );
    expect(exec.mock.calls[0][0]).toBe('/usr/bin/osascript');
    expect(exec.mock.calls[0][2].shell).toBeUndefined();
  });
  it('treats cancellation as no selection and propagates real failures', async () => {
    exec.mockImplementation((_file, _args, _options, callback) =>
      callback({ code: 1 }, '', 'User canceled. (-128)'),
    );
    await expect(pickWebDirectory(new AbortController().signal)).resolves.toBeNull();
    exec.mockImplementation((_file, _args, _options, callback) =>
      callback({ code: 1 }, '', 'No display'),
    );
    await expect(pickWebDirectory(new AbortController().signal)).rejects.toMatchObject({ code: 1 });
  });
  it('allows only one dialog and forwards the abort signal', async () => {
    const controller = new AbortController();
    let finish: (error: Error) => void = () => {};
    exec.mockImplementation((_file, _args, options, callback) => {
      expect(options.signal).toBe(controller.signal);
      finish = callback;
    });
    const pending = pickWebDirectory(controller.signal);
    await expect(pickWebDirectory(controller.signal)).rejects.toThrow('already open');
    controller.abort();
    finish(new Error('aborted'));
    await expect(pending).rejects.toThrow('aborted');
  });
  it('disables native dialogs for remote and explicit browse mode', () => {
    vi.stubEnv('SSH_CONNECTION', 'remote');
    expect(nativeDirectoryAvailable()).toBe(false);
    vi.stubEnv('SSH_CONNECTION', '');
    vi.stubEnv('MOOSE_WEB_DIRECTORY_PICKER', 'browse');
    expect(nativeDirectoryAvailable()).toBe(false);
  });
});
