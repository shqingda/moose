import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), show: vi.fn(), open: vi.fn() }));
vi.mock('electron', () => ({
  app: { getVersion: () => '0.18.0' },
  net: { fetch: mocks.fetch },
  dialog: { showMessageBox: mocks.show },
  shell: { openExternal: mocks.open },
}));
import { checkForUpdates } from '../../electron/updates';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.show.mockResolvedValue({ response: 0 });
});
it('opens the verified release page only when a newer version is accepted', async () => {
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ tag_name: 'v0.19.0', html_url: 'https://untrusted.example' }),
  });
  await checkForUpdates(true);
  expect(mocks.open).toHaveBeenCalledWith('https://github.com/shqingda/moose/releases/tag/v0.19.0');
});
it('does not offer a downgrade', async () => {
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ tag_name: 'v0.9.0' }) });
  await checkForUpdates(true);
  expect(mocks.show).toHaveBeenCalledWith(expect.objectContaining({ message: '已是最新版本' }));
  expect(mocks.open).not.toHaveBeenCalled();
});
it('reports network failure instead of claiming the app is current', async () => {
  mocks.fetch.mockRejectedValue(new Error('offline'));
  await checkForUpdates(true);
  expect(mocks.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
});
