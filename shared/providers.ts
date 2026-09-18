/** 代理元数据的唯一入口；配置字段保持向后兼容，无需迁移已有数据库。 */
export const providerIds = ['codex', 'grok', 'pi'] as const;
export const providerDefinitions = {
  codex: {
    pathKey: 'codexPath',
    enabledKey: 'codexEnabled',
    guide: 'brew install --cask codex\ncodex login',
    url: 'https://developers.openai.com/codex/cli',
    taskModes: ['build', 'plan', 'goal'],
    subagents: true,
  },
  grok: {
    pathKey: 'grokPath',
    enabledKey: 'grokEnabled',
    guide: 'grok',
    url: 'https://docs.x.ai/build/overview',
    taskModes: ['build', 'goal'],
    subagents: true,
  },
  pi: {
    pathKey: 'piPath',
    enabledKey: 'piEnabled',
    guide: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent\npi\n/login',
    url: 'https://pi.dev',
    taskModes: ['build'],
    subagents: false,
  },
} as const;
