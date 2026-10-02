#!/usr/bin/env node
// Pi RPC 测试替身：覆盖流式消息、扩展提问、取消与恢复，不调用真实模型。
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
if (process.argv.includes('--version')) {
  console.log(process.env.MOOSE_TEST_PI_VERSION || 'pi 1.0.0 fixture');
  process.exit(0);
}
const sessionFile = process.argv.includes('--session')
  ? process.argv[process.argv.indexOf('--session') + 1]
  : resolve('pi-session.jsonl');
const model = { provider: 'test', id: 'model', name: 'Test Pi', input: ['text', 'image'] };
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
let pending;
let steering = [];
const complete = () => {
  send({ type: 'message_start', message: { role: 'assistant' } });
  send({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Pi ' },
  });
  send({
    type: 'tool_execution_start',
    toolCallId: 'tool',
    toolName: 'read',
    args: { path: 'README.md' },
  });
  send({
    type: 'tool_execution_end',
    toolCallId: 'tool',
    toolName: 'read',
    result: { content: [{ type: 'text', text: 'read' }] },
  });
  send({
    type: 'message_end',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Pi response' }] },
  });
  send({ type: 'agent_end' });
  setTimeout(() => send({ type: 'agent_settled' }), 10);
};
createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  if (command.type === 'extension_ui_response') {
    if (command.confirmed) complete();
    else send({ type: 'agent_settled' });
    return;
  }
  let data = {};
  if (command.type === 'steer') {
    if (command.message === 'disconnect') {
      process.exit(0);
      return;
    }
    if (command.message === 'reject') {
      send({ type: 'response', id: command.id, success: false, error: 'Steering rejected' });
      return;
    }
    steering.push(command.message);
    data = command.message === 'ambiguous' ? {} : { disposition: 'queued' };
  }
  if (command.type === 'clear_queue') {
    data = { steering, followUp: [] };
    steering = [];
  }
  if (command.type === 'prompt')
    data = { disposition: command.message === 'handled' ? 'handled' : 'started' };

  if (command.type === 'get_available_models') data = { models: [model] };
  if (command.type === 'get_available_thinking_levels') data = { levels: ['off', 'high'] };
  if (command.type === 'get_state') data = { sessionFile, model };
  if (command.type === 'get_session_stats')
    data = { contextUsage: { tokens: 1200, contextWindow: 128000 } };
  if (command.type === 'set_model' && command.modelId === 'bad') {
    send({ type: 'response', id: command.id, success: false, error: 'Unknown model' });
    return;
  }
  send({ type: 'response', id: command.id, command: command.type, success: true, data });
  if (command.type === 'prompt') {
    pending = command.message;
    if (pending === 'approve')
      send({
        type: 'extension_ui_request',
        id: 'approval',
        method: 'confirm',
        title: 'Confirm tool',
      });
    else if (!['wait', 'handled'].includes(pending)) complete();
  }
  if (command.type === 'abort') {
    if (steering.length) {
      send({
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text: 'UNEXPECTED_QUEUED_TURN' }] },
      });
    }
    send({ type: 'agent_settled' });
  }
});
