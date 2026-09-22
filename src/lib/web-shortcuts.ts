import type { AppEvent } from '../../shared/types';

// Physical codes also work when Option changes event.key on macOS.
export const webShortcuts = [
  { label: 'addProject', command: 'open', code: 'KeyO', key: 'O' },
  { label: 'newSession', command: 'new', code: 'KeyN', key: 'N' },
  { label: 'search', command: 'search', code: 'KeyK', key: 'K' },
  { label: 'toggleSidebar', command: 'sidebar', code: 'KeyB', key: 'B' },
  { label: 'review', command: 'review', code: 'KeyR', key: 'R' },
  { label: 'usage', command: 'usage', code: 'KeyU', key: 'U' },
  { label: 'bgCommand', command: 'commands', code: 'KeyJ', key: 'J' },
  { label: 'bgSchedules', command: 'schedules', code: 'KeyS', key: 'S' },
  { label: 'focusComposer', command: 'composer', code: 'KeyL', key: 'L' },
  { label: 'settings', command: 'settings', code: 'Comma', key: ',' },
] as const;

export function webCommand(
  event: KeyboardEvent,
): Extract<AppEvent, { type: 'command' }>['command'] | undefined {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.getModifierState('AltGraph')
  )
    return;
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.code === 'Backquote')
    return event.shiftKey ? 'new-terminal' : 'terminal';
  if (event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey)
    return webShortcuts.find((shortcut) => shortcut.code === event.code)?.command;
  // Keep established, interceptable web shortcuts; leave browser New/Open/Location alone.
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey)
    return ({ k: 'search', b: 'sidebar', ',': 'settings' } as const)[
      event.key.toLowerCase() as 'k' | 'b' | ','
    ];
}
