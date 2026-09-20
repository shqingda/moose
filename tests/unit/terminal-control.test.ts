import { expect, it } from 'vitest';
import { TerminalControls } from '../../electron/terminal-control';

it('allows simultaneous viewers but rejects input and resize from a displaced controller', () => {
  const controls = new TerminalControls(() => {});
  const first = controls.update({ id: 'pty', action: 'acquire' }, 'desktop');
  expect(first.owned).toBe(true);
  expect(controls.update({ id: 'pty', action: 'acquire' }, 'web')).toEqual({
    owned: false,
    available: false,
    lease: null,
  });
  const next = controls.update({ id: 'pty', action: 'takeover' }, 'web');
  expect(next.owned).toBe(true);
  expect(() => controls.assert('pty', 'desktop')).toThrow('another window');
  expect(() => controls.assert('pty', 'web')).not.toThrow();
  controls.update({ id: 'pty', action: 'release', lease: first.lease! }, 'desktop');
  expect(() => controls.assert('pty', 'desktop')).toThrow('another window');
});

it('expires disconnected owners and does not let a late heartbeat reclaim control', () => {
  let now = 0;
  const controls = new TerminalControls(
    () => {},
    () => now,
  );
  const first = controls.update({ id: 'pty', action: 'acquire' }, 'desktop');
  now = 10000;
  controls.update({ id: 'pty', action: 'renew', lease: first.lease! }, 'desktop');
  now = 20000;
  expect(controls.update({ id: 'pty', action: 'acquire' }, 'web').owned).toBe(false);
  now = 25000;
  expect(controls.update({ id: 'pty', action: 'acquire' }, 'web').owned).toBe(true);
  expect(
    controls.update({ id: 'pty', action: 'renew', lease: first.lease! }, 'desktop').owned,
  ).toBe(false);
});

it('ignores cleanup from an older mount and isolates terminal leases', () => {
  const controls = new TerminalControls(() => {});
  const first = controls.update({ id: 'a', action: 'acquire' }, 'desktop');
  const second = controls.update({ id: 'a', action: 'acquire' }, 'desktop');
  expect(first.lease).not.toBe(second.lease);
  expect(controls.update({ id: 'a', action: 'renew', lease: first.lease! }, 'desktop')).toEqual({
    owned: false,
    available: false,
    lease: null,
  });
  controls.update({ id: 'a', action: 'release', lease: first.lease! }, 'desktop');
  expect(() => controls.assert('a', 'web')).toThrow();
  expect(() => controls.assert('b', 'web')).not.toThrow();
  controls.update({ id: 'a', action: 'release', lease: second.lease! }, 'desktop');
  expect(controls.update({ id: 'a', action: 'acquire' }, 'web').owned).toBe(true);
  controls.remove('a');
  expect(controls.update({ id: 'a', action: 'acquire' }, 'desktop').owned).toBe(true);
});

it('fences delayed keystrokes after expiry and after the same client reacquires', () => {
  let now = 0;
  const controls = new TerminalControls(
    () => {},
    () => now,
  );
  const first = controls.update({ id: 'pty', action: 'acquire' }, 'web');
  now = 15000;
  expect(() => controls.assert('pty', 'web', first.lease!)).toThrow('control has changed');
  const second = controls.update({ id: 'pty', action: 'acquire' }, 'web');
  expect(() => controls.assert('pty', 'web', first.lease!)).toThrow('control has changed');
  expect(() => controls.assert('pty', 'web', second.lease!)).not.toThrow();
});
