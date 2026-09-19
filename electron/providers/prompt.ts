import type { AgentAttachment } from '../attachments';
import type { RunContext } from './types';
/** 文件附件的文本封装共用；图片仍由各协议使用自己的原生输入类型。 */
export function attachmentText(file: AgentAttachment): string {
  return `Attached file: ${file.name}\nLocal path: ${file.path}${file.text !== undefined ? `\n<attachment>\n${file.text}\n</attachment>` : ''}`;
}

/** 没有原生 mention/skill 输入的协议，通过文件路径让代理读取引用内容。 */
export function promptText(context: RunContext): string {
  return [
    context.text,
    ...(context.selection?.references || []).map(
      (entry) => `Referenced ${entry.kind}: ${entry.path}`,
    ),
    ...(context.selection?.skills || []).map(
      (entry) => `Use skill ${entry.name}. Read its instructions at ${entry.path}`,
    ),
  ].join('\n');
}
