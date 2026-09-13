#!/usr/bin/env node
// Deterministic protocol peer for tests ONLY. Never bundled with Moose.
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
if (process.argv.includes('--version')) { console.log('Moose protocol fixture 1.0'); process.exit(0); }
const acp = process.argv.includes('agent');
let goal = null;
let cwd = process.cwd(), sessionId = randomUUID(), turnId = '', threadSettings = {}, pendingPrompt, promptId, permissionId;
const send = data => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...data }) + '\n');
const result = (id, value) => send({ id, result: value });
const notify = (method, params) => send({ method, params });
function update(update) { notify('session/update', { sessionId, update }); }
function complete(text, write = true) {
  if (write) writeFileSync(join(cwd, 'approved.txt'), 'moose-approved\n');
  if (acp) { update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }); result(promptId, { stopReason: 'end_turn' }); }
  else {
    notify('item/agentMessage/delta', { threadId: sessionId, itemId: turnId + '-text', delta: text });
    notify('item/completed', { threadId: sessionId, item: { type: 'agentMessage', id: turnId + '-text', text } });
    notify('turn/completed', { threadId: sessionId, turn: { id: turnId, status: 'completed' } });
  }
}
createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line), p = m.params || {};
  if (m.id === permissionId && !m.method) { complete(m.result?.decision === 'decline' || m.result?.outcome?.optionId === 'deny' ? 'Permission denied. No changes made.' : 'Implemented the change.\n\n```ts\nconst ready = true;\n```', !(m.result?.decision === 'decline' || m.result?.outcome?.optionId === 'deny')); permissionId = null; return; }
  if (m.id === 'question-1' && !m.method) { complete('Answer received.', false); return; }
  switch (m.method) {
    case 'initialize': result(m.id, acp ? { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [{ id: 'cached_token', name: 'Cached' }], _meta: { modelState: { availableModels: [{ modelId: 'fixture', name: 'Fixture model' }] } } } : { userAgent: 'fixture' }); break;
    case 'initialized': break;
    case 'authenticate': result(m.id, {}); break;
    case 'account/read': result(m.id, { account: { type: 'chatgpt' } }); break;
    case 'model/list': result(m.id, { data: [{ id: 'fixture', model: 'fixture', displayName: 'Fixture model', hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }], nextCursor: null }); break;
    case 'thread/fork': case 'thread/start': case 'thread/resume': cwd = p.cwd; threadSettings = p; sessionId = m.method === 'thread/fork' ? randomUUID() : p.threadId || randomUUID(); result(m.id, { thread: { id: sessionId } }); break;
    case 'thread/goal/get': result(m.id, { goal }); break;
    case 'thread/goal/set': goal = { ...goal, ...p }; result(m.id, { goal }); if (p.status === 'active') { goal.status = 'complete'; turnId = randomUUID(); notify('turn/started', { threadId: sessionId, turn: { id: turnId } }); setTimeout(() => complete('Goal complete after continuation.', false), 20); } break;
    case 'session/new': case 'session/load': cwd = p.cwd; sessionId = p.sessionId || randomUUID(); result(m.id, { sessionId }); break;
    case 'turn/start': case 'session/prompt': {
      if (acp && p.prompt[0].text === '/always-approve off') { result(m.id, { stopReason: 'end_turn' }); break; }
      turnId = randomUUID(); promptId = m.id; pendingPrompt = acp ? p.prompt[0].text : p.input[0].text;
      if (!acp) { result(m.id, { turn: { id: turnId } }); notify('turn/started', { threadId: sessionId, turn: { id: turnId } }); }
      if (pendingPrompt === 'inspect-input') { complete(JSON.stringify({ input: p.input || p.prompt, settings: threadSettings }), false); break; }
      if (pendingPrompt === 'hold') break;
      if (pendingPrompt === 'ask') {
        send({ id: 'question-1', method: acp ? '_x.ai/ask_user_question' : 'item/tool/requestUserInput', params: { threadId: sessionId, questions: [{ id: 'choice', question: 'Which approach?', options: [{ label: 'Small change' }, { label: 'Full rewrite' }] }] } }); break;
      }
      permissionId = 'approval-1';
      if (acp) send({ id: permissionId, method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId: 'write', title: 'Write approved.txt', rawInput: { path: 'approved.txt' } }, options: [{ optionId: 'allow', kind: 'allow_once', name: 'Allow once' }, { optionId: 'deny', kind: 'reject_once', name: 'Deny' }] } });
      else send({ id: permissionId, method: 'item/commandExecution/requestApproval', params: { threadId: sessionId, command: 'Write approved.txt', reason: 'Fixture write operation' } });
      break;
    }
    case 'turn/interrupt': result(m.id, {}); notify('turn/completed', { threadId: sessionId, turn: { id: turnId, status: 'interrupted' } }); break;
    case 'session/cancel': result(promptId, { stopReason: 'cancelled' }); break;
    default: if (m.id !== undefined) result(m.id, {});
  }
});
process.stdin.on('end', () => process.exit(0));
