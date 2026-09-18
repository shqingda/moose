import type { AgentAttachment } from '../attachments';
import type { RunContext } from './types';
import { providerDefinitions } from '../../shared/providers';

/** 显式委派请求交给底座原生工具执行，Moose 不另建调度器。 */
export function taskText(context: RunContext): string {
  if (!context.promptContext?.subagents) return context.text;
  if (!providerDefinitions[context.session.provider].subagents)
    throw new Error('This provider does not support native subagent delegation in Moose.');
  return `${context.text}\n\nUse native subagents to delegate bounded, independent parts of this task. Keep the current permissions and task mode, coordinate shared-file edits, wait for the delegated work, and summarize the results. If native subagent tools are unavailable, report that limitation instead of pretending to delegate.`;
}

/** 文件附件的文本封装共用；图片仍由各协议使用自己的原生输入类型。 */
export function attachmentText(file: AgentAttachment): string {
  return `Attached file: ${file.name}\nLocal path: ${file.path}${file.text !== undefined ? `\n<attachment>\n${file.text}\n</attachment>` : ''}`;
}

/** 没有原生 mention/skill 输入的协议，通过文件路径让代理读取引用内容。 */
export function promptText(context: RunContext): string {
  return [
    taskText(context),
    ...(context.selection?.references || []).map(
      (entry) => `Referenced ${entry.kind}: ${entry.path}`,
    ),
    ...(context.selection?.skills || []).map(
      (entry) => `Use skill ${entry.name}. Read its instructions at ${entry.path}`,
    ),
  ].join('\n');
}
