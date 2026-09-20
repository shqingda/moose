import type { SessionNotification } from '@agentclientprotocol/sdk';
import { array, record, string, readable, type AgentEvent } from './types';
/** 把 ACP 文本、思考与工具更新转换为 Moose 消息事件。 */
export function normalizeAcp(
  notification: SessionNotification,
  textKey: string,
): AgentEvent | null {
  const update = record(notification.update);
  if (
    update.sessionUpdate === 'agent_message_chunk' ||
    update.sessionUpdate === 'agent_thought_chunk'
  ) {
    const content = record(update.content);
    if (content.type !== 'text') return null;
    return {
      key: textKey,
      kind: update.sessionUpdate === 'agent_thought_chunk' ? 'reasoning' : 'assistant',
      delta: string(content.text),
      state: 'running',
    };
  }
  if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
    return {
      key: string(update.toolCallId),
      kind: 'tool',
      title: typeof update.title === 'string' ? update.title : undefined,
      text: update.content
        ? array(update.content)
            .map((value) => {
              const c = record(value);
              return c.type === 'content'
                ? readable(record(c.content).text)
                : c.type === 'diff'
                  ? `${string(c.path)}\n${string(c.newText)}`
                  : readable(c);
            })
            .join('\n')
        : update.rawOutput !== undefined
          ? readable(update.rawOutput)
          : update.rawInput
            ? readable(update.rawInput)
            : undefined,
      state:
        update.status === 'completed' ? 'done' : update.status === 'failed' ? 'error' : 'running',
    };
  }
  return null;
}
