import type { PermissionMode, PromptContext } from '../../shared/types';
import type { RunContext } from './types';

/** 三个权限档位。完全访问只在调用方明确传入 full 时选择。 */
export const permissionModes = [
  { id: 'ask', label: 'Request approval' },
  { id: 'auto', label: 'Approve for me' },
  { id: 'full', label: 'Full access' },
] as const;

export const allTaskModes: PromptContext['mode'][] = ['build', 'plan', 'goal'];

/** 空档位表示还没保存过选择，按新安装默认使用“帮我批准”，而不是完全访问。 */
export function normalizePermission(mode: string | undefined): PermissionMode {
  if (mode === 'ask' || mode === 'auto' || mode === 'full') return mode;
  return 'auto';
}

const readOnlyName =
  /^(read|read_file|read_text|grep|glob|list|ls|find|search|web_search|websearch|webfetch|web_fetch|fetch|view|cat)$/i;

/** 计划模式只放行看起来只读的工具；认不出来的工具按会改动处理。 */
export function toolMutates(name: string, title = ''): boolean {
  const label = `${name} ${title}`.trim();
  if (readOnlyName.test(name.trim()) || readOnlyName.test(title.trim())) return false;
  if (
    /\b(read|grep|glob|search|list|view|fetch)\b/i.test(label) &&
    !/\b(write|edit|delete|bash|shell|exec|command|patch)\b/i.test(label)
  )
    return false;
  return true;
}

export interface PermissionChoice {
  id: string;
  kind?: string;
  label?: string;
}

function choice(options: PermissionChoice[], kinds: string[], ids: string[]) {
  return (
    options.find((option) => option.kind && kinds.includes(option.kind)) ||
    options.find((option) => ids.includes(option.id))
  );
}

/**
 * 决定一次工具权限是交给用户，还是由 Moose 代选。
 * auto 选一次性允许；full 才选始终允许。计划模式拒绝会改动的工具。
 */
export function selectPermission(
  mode: PermissionMode,
  taskMode: PromptContext['mode'],
  options: PermissionChoice[],
  toolName = '',
  toolTitle = '',
): { action: 'ask' } | { action: 'select'; optionId: string } {
  const allowOnce = choice(options, ['allow_once'], ['allow', 'once', 'accept', 'yes']);
  const allowAlways = choice(options, ['allow_always'], ['always']);
  const reject = choice(
    options,
    ['reject_once', 'reject_always'],
    ['deny', 'decline', 'reject', 'no'],
  );
  if (taskMode === 'plan') {
    if (!toolMutates(toolName, toolTitle)) {
      const allow = allowOnce || allowAlways;
      if (allow) return { action: 'select', optionId: allow.id };
    }
    if (reject) return { action: 'select', optionId: reject.id };
    return { action: 'ask' };
  }
  if (mode === 'ask') return { action: 'ask' };
  if (mode === 'full') {
    const allow = allowAlways || allowOnce;
    if (allow) return { action: 'select', optionId: allow.id };
    return { action: 'ask' };
  }
  if (allowOnce || allowAlways)
    return { action: 'select', optionId: (allowOnce || allowAlways)!.id };
  return { action: 'ask' };
}

export const planInstruction =
  'Plan mode is active. Do not create, edit, or delete files, and do not run commands that change the workspace. Inspect with read-only tools and reply with the plan only.';

export function goalInstruction(budget?: number) {
  return [
    'Goal mode is active. Treat the user message as the objective and continue until it is complete, blocked, or the budget is exhausted.',
    budget ? `Token budget: ${budget}. Stop if reaching it would require more work.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** 没有原生计划或目标接口时，把约束写进这一轮提示，不额外多跑一轮。 */
export function taskPrompt(
  context: RunContext,
  text: string,
  native: { plan?: boolean; goal?: boolean } = {},
): string {
  const mode = context.promptContext?.mode || 'build';
  if (mode === 'plan' && !native.plan) return `${planInstruction}\n\n${text}`;
  if (mode === 'goal' && !native.goal)
    return `${goalInstruction(context.promptContext?.goalBudget)}\n\n${text}`;
  return text;
}
