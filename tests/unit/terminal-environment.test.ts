import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { terminalEnvironment } from '../../electron/terminal-environment';

it('preserves UTF-8 locales and other shell settings without mutating the parent environment', () => {
  const source = { LANG: 'zh_CN.UTF-8', PATH: '/bin', ELECTRON_RUN_AS_NODE: '1' };
  expect(terminalEnvironment(source)).toEqual({
    LANG: 'zh_CN.UTF-8',
    PATH: '/bin',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  });
  expect(source.ELECTRON_RUN_AS_NODE).toBe('1');
});

it('normalizes absent and higher-priority non-Unicode locales for real zsh prompt expansion', () => {
  for (const source of [
    {},
    { LANG: 'C' },
    { LANG: 'zh_CN.UTF-8', LC_CTYPE: 'C' },
    { LC_ALL: 'C' },
  ]) {
    const env = terminalEnvironment(source);
    const text = execFileSync(
      '/bin/zsh',
      ['-fic', "value=中文; print ${#value}; psvar=(✗); print -P '%1v'"],
      { env, encoding: 'utf8' },
    );
    expect(text).toBe('2\n✗\n');
  }
});
