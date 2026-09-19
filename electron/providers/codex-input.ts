import { attachmentText } from './prompt';
import type { RunContext } from './types';
import type { UserInput } from './generated/codex/v2/UserInput';

/** 正常发送和插话使用完全相同的原生输入转换。 */
export function codexInput(context: RunContext): UserInput[] {
  return [
    { type: 'text', text: context.text, text_elements: [] },
    ...(context.selection?.references || []).map((a) => ({
      type: 'mention' as const,
      name: a.name,
      path: a.path,
    })),
    ...(context.selection?.skills || []).map((a) => ({
      type: 'skill' as const,
      name: a.name,
      path: a.path,
    })),
    ...(context.attachments || []).map((a): UserInput =>
      a.mime.startsWith('image/')
        ? { type: 'localImage', path: a.path }
        : { type: 'text', text: attachmentText(a), text_elements: [] },
    ),
  ];
}
