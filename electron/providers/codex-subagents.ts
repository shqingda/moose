import type { Delegation } from '../../shared/types';
import type { CollabAgentTool } from './generated/codex/v2/CollabAgentTool';
import { array, record, string, type AgentEvent } from './types';

const operations = {
  spawnAgent: 'spawn',
  sendInput: 'message',
  sendMessage: 'message',
  followupTask: 'message',
  resumeAgent: 'resume',
  wait: 'wait',
  closeAgent: 'close',
  interruptAgent: 'interrupt',
  listAgents: 'list',
} as const satisfies Record<CollabAgentTool, Delegation['operation']>;

function status(value: unknown): Delegation['agents'][number]['status'] {
  switch (value) {
    case 'pendingInit':
      return 'pending';
    case 'started':
    case 'interacted':
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'interrupted':
      return 'interrupted';
    case 'errored':
      return 'failed';
    case 'shutdown':
      return 'closed';
    default:
      return 'unknown';
  }
}

/** 仅转换原生结构化协作事件，不从普通工具输出猜测代理身份或状态。 */
export function codexDelegation(
  item: Record<string, unknown>,
  state: AgentEvent['state'],
): AgentEvent | null {
  if (item.type === 'subAgentActivity') {
    const id = string(item.agentThreadId);
    if (!id) return null;
    return {
      key: string(item.id),
      kind: 'tool',
      state,
      title: string(item.agentPath),
      delegation: {
        operation: 'activity',
        agents: [{ id, status: status(item.kind), message: '' }],
      },
    };
  }
  if (item.type !== 'collabAgentToolCall') return null;
  const tool = string(item.tool);
  const operation = Object.entries(operations).find(([name]) => name === tool)?.[1];
  if (!operation) return null;
  const states = record(item.agentsStates);
  const ids = [
    ...new Set([...array(item.receiverThreadIds).map(string), ...Object.keys(states)]),
  ].filter(Boolean);
  return {
    key: string(item.id),
    kind: 'tool',
    state,
    ...(typeof item.prompt === 'string' ? { text: item.prompt } : {}),
    delegation: {
      operation,
      model: string(item.model) || undefined,
      agents: ids.map((id) => ({
        id,
        status: status(record(states[id]).status),
        message: string(record(states[id]).message),
      })),
    },
  };
}
