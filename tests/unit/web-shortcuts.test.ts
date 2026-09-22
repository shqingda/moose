import { describe, expect, it } from 'vitest';
import { webCommand } from '../../src/lib/web-shortcuts';
const key = (options: Partial<KeyboardEvent>) =>
  ({
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    getModifierState: () => false,
    ...options,
  }) as KeyboardEvent;
describe('browser shortcuts', () => {
  it('keeps browser location, new window, open file and view-source shortcuts free', () => {
    for (const modifier of ['metaKey', 'ctrlKey']) {
      for (const letter of ['l', 'n', 'o', 'u'])
        expect(webCommand(key({ [modifier]: true, key: letter }))).toBeUndefined();
    }
  });
  it('uses physical codes when Option changes typed characters', () => {
    expect(webCommand(key({ altKey: true, shiftKey: true, code: 'KeyL', key: 'Ò' }))).toBe(
      'composer',
    );
    expect(webCommand(key({ altKey: true, shiftKey: true, code: 'KeyN' }))).toBe('new');
  });
  it('leaves composition, AltGraph and handled events alone', () => {
    for (const options of [
      { isComposing: true },
      { defaultPrevented: true },
      { getModifierState: () => true },
    ]) {
      expect(
        webCommand(key({ altKey: true, shiftKey: true, code: 'KeyN', ...options })),
      ).toBeUndefined();
    }
  });
  it('retains terminal and search commands', () => {
    expect(webCommand(key({ ctrlKey: true, code: 'Backquote' }))).toBe('terminal');
    expect(webCommand(key({ ctrlKey: true, shiftKey: true, code: 'Backquote' }))).toBe(
      'new-terminal',
    );
    expect(webCommand(key({ metaKey: true, key: 'k' }))).toBe('search');
  });
});
