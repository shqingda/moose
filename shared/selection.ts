import { providerIds } from './providers';
import type { PermissionMode, PromptContext, Provider, ProviderInfo } from './types';

/** 新会话和重启后要立刻恢复的输入选择；探测结果到达前不做网络等待。 */
export interface ComposerSelection {
  provider: Provider;
  model: string;
  effort: string;
  mode: PermissionMode;
  taskMode: PromptContext['mode'];
}

export const defaultSelection: ComposerSelection = {
  provider: 'codex',
  model: '',
  effort: '',
  mode: 'ask',
  taskMode: 'build',
};

const taskModes = ['build', 'plan', 'goal'] as const;

/** 把磁盘或草稿里的未知字段收成一份可直接用于界面的选择。 */
export function readSelection(value: unknown): ComposerSelection {
  const row =
    value && typeof value === 'object'
      ? (value as Partial<Record<keyof ComposerSelection, unknown>>)
      : {};
  const provider = providerIds.includes(row.provider as Provider)
    ? (row.provider as Provider)
    : defaultSelection.provider;
  const mode =
    row.mode === 'ask' || row.mode === 'auto' || row.mode === 'full'
      ? row.mode
      : defaultSelection.mode;
  const taskMode = taskModes.includes(row.taskMode as PromptContext['mode'])
    ? (row.taskMode as PromptContext['mode'])
    : defaultSelection.taskMode;
  return {
    provider,
    model: typeof row.model === 'string' ? row.model.slice(0, 200) : '',
    effort: typeof row.effort === 'string' ? row.effort.slice(0, 100) : '',
    mode,
    taskMode,
  };
}

function same(left: ComposerSelection, right: ComposerSelection) {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    left.effort === right.effort &&
    left.mode === right.mode &&
    left.taskMode === right.taskMode
  );
}

export function selectionsEqual(left: ComposerSelection, right: ComposerSelection) {
  return same(left, right);
}

/**
 * 探测结果到达后把失效的选择收成最近的可用默认值。
 * 列表还没包含该底座时保持原值，避免用半成品缓存把选择清掉。
 */
export function reconcileSelection(
  selection: ComposerSelection,
  providers: ProviderInfo[],
  options?: { lockProvider?: boolean },
): ComposerSelection {
  const current = readSelection(selection);
  if (!providers.length) return current;
  let next = current;
  const entry = providers.find((item) => item.provider === current.provider);
  const listed = providers.length >= providerIds.length;
  const missing = !entry && listed;
  const unusable = !!entry && (entry.enabled === false || entry.available === false);
  if (!options?.lockProvider && (missing || unusable)) {
    const usable = (item: ProviderInfo) => item.enabled !== false && item.available !== false;
    const fallback =
      providers.find((item) => item.provider === 'codex' && usable(item)) ||
      providers.find(usable) ||
      providers.find((item) => item.enabled !== false);
    if (fallback)
      next = {
        ...next,
        provider: fallback.provider,
        model: '',
        effort: '',
      };
  }
  const active = providers.find((item) => item.provider === next.provider);
  if (active?.models.length) {
    const available = active.models.filter((model) => !model.unavailable);
    const chosen = active.models.find((model) => model.id === next.model);
    if (next.model && (!chosen || chosen.unavailable))
      next = { ...next, model: available[0]?.id || '', effort: '' };
    const model = active.models.find((item) => item.id === next.model);
    if (
      next.effort &&
      model?.efforts.length &&
      !model.efforts.some((effort) => effort.id === next.effort)
    )
      next = { ...next, effort: '' };
  }
  if (active?.modes.length && !active.modes.some((mode) => mode.id === next.mode)) {
    const fallback =
      active.modes.find((mode) => mode.id === defaultSelection.mode) || active.modes[0];
    if (fallback) next = { ...next, mode: fallback.id as PermissionMode };
  }
  if (active?.taskModes?.length && !active.taskModes.includes(next.taskMode))
    next = { ...next, taskMode: 'build' };
  return same(current, next) ? current : next;
}
