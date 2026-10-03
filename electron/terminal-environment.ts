/** GUI launches may have no locale (or C); zsh then escapes Unicode prompt symbols. */
export function terminalEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
  delete env.ELECTRON_RUN_AS_NODE;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG;
  if (!locale || !/utf-?8/i.test(locale)) {
    if (env.LC_ALL) env.LC_ALL = 'en_US.UTF-8';
    env.LC_CTYPE = 'en_US.UTF-8';
  }
  env.LANG ||= 'en_US.UTF-8';
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  return env;
}
