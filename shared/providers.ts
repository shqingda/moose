/** 代理元数据的唯一入口；配置字段保持向后兼容，无需迁移已有数据库。 */
export const providerIds = ['codex', 'grok', 'pi', 'opencode'] as const;
export const providerDefinitions = {
  codex: {
    pathKey: 'codexPath',
    enabledKey: 'codexEnabled',
    taskModes: ['build', 'plan', 'goal'],
  },
  grok: {
    pathKey: 'grokPath',
    enabledKey: 'grokEnabled',
    taskModes: ['build', 'plan', 'goal'],
  },
  pi: {
    pathKey: 'piPath',
    enabledKey: 'piEnabled',
    taskModes: ['build', 'plan', 'goal'],
  },
  opencode: {
    pathKey: 'opencodePath',
    enabledKey: 'opencodeEnabled',
    taskModes: ['build', 'plan', 'goal'],
  },
} as const;
