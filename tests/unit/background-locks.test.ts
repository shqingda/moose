import { it, expect, vi } from 'vitest';
import { BackgroundLocks } from '../../electron/background-locks';
it('holds the directory until the last shell or command exits, regardless of close order', () => {
  const release = vi.fn(),
    lock = vi.fn(() => release);
  const leases = new BackgroundLocks(lock);
  const terminal = leases.acquire('/repo'),
    command = leases.acquire('/repo');
  expect(lock).toHaveBeenCalledTimes(1);
  command();
  command();
  expect(release).not.toHaveBeenCalled();
  const second = leases.acquire('/repo');
  terminal();
  expect(release).not.toHaveBeenCalled();
  second();
  expect(release).toHaveBeenCalledTimes(1);
  leases.acquire('/repo')();
  expect(lock).toHaveBeenCalledTimes(2);
});
it('preserves conflicts with external tasks and acquires different directories independently', () => {
  const release = vi.fn();
  const lock = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error('busy');
    })
    .mockReturnValue(release);
  const leases = new BackgroundLocks(lock);
  expect(() => leases.acquire('/repo')).toThrow('busy');
  const a = leases.acquire('/repo'),
    b = leases.acquire('/worktree');
  expect(lock).toHaveBeenCalledTimes(3);
  a();
  expect(release).toHaveBeenCalledTimes(1);
  b();
  expect(release).toHaveBeenCalledTimes(2);
});
