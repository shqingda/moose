#!/usr/bin/env node
// Deterministic protocol peer for tests ONLY. Never bundled with Moose.
import { nativeHistoryPeer } from './native-history.mjs';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
if (process.argv.includes('--version')) {
  console.log('Moose protocol fixture 1.0');
  process.exit(0);
}
const acp = process.argv.includes('agent');
let goal = null;
let cwd = process.cwd(),
  sessionId = randomUUID(),
  turnId = '',
  threadSettings = {},
  pendingPrompt,
  promptId,
  permissionId;
// 以单行 JSON 写出测试协议消息。
const send = (data) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...data }) + '\n');
// 返回与请求 ID 对应的测试响应。
const result = (id, value) => send({ id, result: value });
// 发送无请求 ID 的协议通知，模拟流式更新。
const notify = (method, params) => send({ method, params });
// 包装 ACP session/update 通知。
function update(update) {
  notify('session/update', { sessionId, update });
}
// 产生可预测的代理回复与完成事件，可按测试场景写入隔离目录文件。
function complete(text, write = true) {
  if (write) writeFileSync(join(cwd, 'approved.txt'), 'moose-approved\n');
  if (acp) {
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
    result(promptId, { stopReason: 'end_turn' });
  } else {
    notify('item/agentMessage/delta', {
      threadId: sessionId,
      itemId: turnId + '-text',
      delta: text,
    });
    notify('item/completed', {
      threadId: sessionId,
      item: { type: 'agentMessage', id: turnId + '-text', text },
    });
    notify('thread/tokenUsage/updated', {
      threadId: sessionId,
      tokenUsage: { last: { totalTokens: 1200 }, modelContextWindow: 128000 },
    });
    notify('turn/completed', { threadId: sessionId, turn: { id: turnId, status: 'completed' } });
  }
}
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line),
    p = m.params || {};
  if (m.id === 'subagent-approval' && !m.method) {
    notify('item/completed', {
      threadId: sessionId,
      item: {
        type: 'collabAgentToolCall',
        id: 'delegation-wait',
        tool: 'wait',
        status: 'completed',
        receiverThreadIds: ['child-fixture'],
        agentsStates: {
          'child-fixture': { status: 'completed', message: 'Subagent verified the tests.' },
        },
      },
    });
    complete(
      m.result?.decision === 'accept' ? 'Delegated work complete.' : 'Subagent approval rejected.',
      false,
    );
    return;
  }
  if (m.id === permissionId && !m.method) {
    complete(
      m.result?.decision === 'decline' || m.result?.outcome?.optionId === 'deny'
        ? 'Permission denied. No changes made.'
        : 'Implemented the change.\n\n```ts\nconst ready = true;\n```',
      !(m.result?.decision === 'decline' || m.result?.outcome?.optionId === 'deny'),
    );
    permissionId = null;
    return;
  }
  if (m.id === 'question-1' && !m.method) {
    complete('Answer received.', false);
    return;
  }
  if (nativeHistoryPeer(m, { result, notify, session: sessionId, cwd })) return;
  switch (m.method) {
    case 'initialize':
      result(
        m.id,
        acp
          ? {
              protocolVersion: 1,
              agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
              authMethods: [{ id: 'cached_token', name: 'Cached' }],
              _meta: {
                modelState: { availableModels: [{ modelId: 'fixture', name: 'Fixture model' }] },
              },
            }
          : { userAgent: 'Moose protocol fixture/0.155.1' },
      );
      break;
    case 'initialized':
      break;
    case 'authenticate':
      result(m.id, {});
      break;
    case 'account/rateLimits/read':
      result(m.id, {
        rateLimitsByLimitId: {
          codex: {
            limitId: 'codex',
            limitName: 'Codex',
            planType: 'plus',
            primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1900000000 },
            secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: 1900300000 },
          },
        },
      });
      break;
    case 'account/read':
      result(m.id, { account: { type: 'chatgpt' } });
      break;
    case 'collaborationMode/list':
      result(m.id, { data: [{ name: 'Plan', mode: 'plan' }] });
      break;
    case 'model/list':
      result(m.id, {
        data: [
          {
            id: 'fixture',
            model: 'fixture',
            displayName: 'Fixture model',
            hidden: false,
            supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
          },
        ],
        nextCursor: null,
      });
      break;
    case 'thread/fork':
    case 'thread/start':
    case 'thread/resume':
      cwd = p.cwd;
      threadSettings = p;
      sessionId = m.method === 'thread/fork' ? randomUUID() : p.threadId || randomUUID();
      result(m.id, { thread: { id: sessionId }, model: 'fixture' });
      break;
    case 'thread/goal/get':
      result(m.id, { goal });
      break;
    case 'thread/goal/set':
      goal = { ...goal, ...p };
      result(m.id, { goal });
      if (p.status === 'active') {
        goal.status = 'complete';
        turnId = randomUUID();
        notify('turn/started', { threadId: sessionId, turn: { id: turnId } });
        setTimeout(() => complete('Goal complete after continuation.', false), 20);
      }
      break;
    case 'session/new':
    case 'session/load':
      cwd = p.cwd;
      sessionId = p.sessionId || randomUUID();
      result(m.id, { sessionId });
      break;
    case 'turn/start':
    case 'session/prompt': {
      if (acp && p.prompt[0].text === '/always-approve off') {
        result(m.id, { stopReason: 'end_turn' });
        break;
      }
      turnId = randomUUID();
      promptId = m.id;
      pendingPrompt = acp ? p.prompt[0].text : p.input[0].text;
      if (!acp) {
        result(m.id, { turn: { id: turnId } });
        if (pendingPrompt !== 'steer-response-first')
          notify('turn/started', { threadId: sessionId, turn: { id: turnId } });
      }
      if (pendingPrompt === 'steer-response-first') break;
      if (pendingPrompt.startsWith('plan-fixture')) {
        if (p.collaborationMode?.mode !== 'plan' || threadSettings.sandbox !== 'read-only') {
          complete('Native plan settings missing', false);
          break;
        }
        notify('item/started', {
          threadId: sessionId,
          item: { type: 'plan', id: 'plan-native', text: '' },
        });
        notify('item/plan/delta', {
          threadId: sessionId,
          itemId: 'plan-native',
          delta: '# Native plan\n\nCreate the approved file.',
        });
        notify('item/completed', {
          threadId: sessionId,
          item: {
            type: 'plan',
            id: 'plan-native',
            text: '# Native plan\n\nCreate the approved file.',
          },
        });
        notify('turn/completed', {
          threadId: sessionId,
          turn: { id: turnId, status: 'completed' },
        });
        break;
      }
      if (pendingPrompt.startsWith('Implement the following user-approved plan')) {
        if (p.collaborationMode?.mode !== 'default' || threadSettings.sandbox === 'read-only') {
          complete('Execution mode was not restored', false);
          break;
        }
        complete('Executed approved text: ' + pendingPrompt);
        break;
      }
      if (pendingPrompt === 'steer-fixture') {
        notify('item/agentMessage/delta', {
          threadId: sessionId,
          itemId: 'working',
          delta: 'Waiting for steering.',
        });
        break;
      }
      if (pendingPrompt.startsWith('inspect-input')) {
        complete(JSON.stringify({ input: p.input || p.prompt, settings: threadSettings }), false);
        break;
      }
      if (pendingPrompt.startsWith('delegate-fixture')) {
        if (acp) {
          update({
            sessionUpdate: 'tool_call',
            toolCallId: 'delegate',
            title: 'Delegate test review',
            rawInput: { task: 'Inspect the tests' },
            status: 'in_progress',
          });
          update({
            sessionUpdate: 'tool_call_update',
            toolCallId: 'delegate',
            rawOutput: { summary: 'Subagent verified the tests.' },
            status: 'completed',
          });
          complete('Delegated work complete.', false);
        } else {
          const item = {
            type: 'collabAgentToolCall',
            id: 'delegation-spawn',
            tool: 'spawnAgent',
            receiverThreadIds: ['child-fixture'],
            prompt: 'Inspect the tests',
            model: 'fixture',
            agentsStates: { 'child-fixture': { status: 'running', message: '' } },
          };
          notify('item/started', { threadId: sessionId, item: { ...item, status: 'inProgress' } });
          notify('item/completed', { threadId: sessionId, item: { ...item, status: 'completed' } });
          notify('turn/completed', {
            threadId: 'child-fixture',
            turn: { id: 'child-turn', status: 'completed' },
          });
          send({
            id: 'subagent-approval',
            method: 'item/commandExecution/requestApproval',
            params: {
              threadId: 'child-fixture',
              command: 'Read test report',
              reason: 'Subagent review',
            },
          });
        }
        break;
      }
      if (pendingPrompt === 'hold') break;
      if (pendingPrompt === 'ask') {
        send({
          id: 'question-1',
          method: acp ? '_x.ai/ask_user_question' : 'item/tool/requestUserInput',
          params: {
            threadId: sessionId,
            questions: [
              {
                id: 'choice',
                question: 'Which approach?',
                options: [{ label: 'Small change' }, { label: 'Full rewrite' }],
              },
            ],
          },
        });
        break;
      }
      permissionId = 'approval-1';
      if (acp)
        send({
          id: permissionId,
          method: 'session/request_permission',
          params: {
            sessionId,
            toolCall: {
              toolCallId: 'write',
              title: 'Write approved.txt',
              rawInput: { path: 'approved.txt' },
            },
            options: [
              { optionId: 'allow', kind: 'allow_once', name: 'Allow once' },
              { optionId: 'deny', kind: 'reject_once', name: 'Deny' },
            ],
          },
        });
      else
        send({
          id: permissionId,
          method: 'item/commandExecution/requestApproval',
          params: {
            threadId: sessionId,
            command: 'Write approved.txt',
            reason: 'Fixture write operation',
          },
        });
      break;
    }
    case 'turn/steer':
      if (p.input?.[0]?.text === 'drop-steer-fixture') {
        process.exit(0);
      }
      if (p.expectedTurnId !== turnId)
        send({ id: m.id, error: { code: -32602, message: 'Turn ended' } });
      else {
        result(m.id, { turnId });
        complete('Steered: ' + JSON.stringify(p.input), false);
      }
      break;
    case 'turn/interrupt':
      result(m.id, {});
      notify('turn/completed', {
        threadId: sessionId,
        turn: { id: turnId, status: 'interrupted' },
      });
      break;
    case 'session/cancel':
      result(promptId, { stopReason: 'cancelled' });
      break;
    default:
      if (m.id !== undefined) result(m.id, {});
  }
});
process.stdin.on('end', () => process.exit(0));
