#!/usr/bin/env node
import { createInterface } from 'node:readline';
if (process.argv.includes('--version')) {
  console.log('opencode v2.0.10');
  process.exit(0);
}
if (!process.argv.includes('acp')) process.exit(2);
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const reply = (id, result) => send({ id, result });
const options = [
  {
    id: 'model',
    category: 'model',
    type: 'select',
    name: 'Model',
    currentValue: 'fixture/model',
    options: [{ value: 'fixture/model', name: 'Fixture model' }],
  },
];
let prompt,
  session = 'opencode-fixture',
  hold = false;
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line),
    p = m.params || {};
  if (m.jsonrpc !== '2.0') process.exit(3);
  const update = (update) =>
    send({ method: 'session/update', params: { sessionId: session, update } });
  switch (m.method) {
    case 'initialize':
      reply(m.id, {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
      });
      break;
    case 'session/new':
      reply(m.id, { sessionId: session, configOptions: options });
      break;
    case 'session/load':
      session = p.sessionId;
      update({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'HISTORICAL_REPLAY' },
      });
      reply(m.id, { configOptions: options });
      break;
    case 'session/set_config_option':
      if (p.configId !== 'model' || p.value !== 'fixture/model') process.exit(4);
      reply(m.id, { configOptions: options });
      break;
    case 'session/prompt':
      prompt = m.id;
      hold = p.prompt[0].text.includes('hold');
      if (hold) break;
      update({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'Checking permission' },
      });
      send({
        id: 'permission',
        method: 'session/request_permission',
        params: {
          sessionId: session,
          toolCall: { toolCallId: 'tool', title: 'Read fixture' },
          options: [
            { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
          ],
        },
      });
      break;
    case 'session/cancel':
      if (prompt) reply(prompt, { stopReason: 'cancelled' });
      break;
    default:
      if (m.id === 'permission' && m.result) {
        update({
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text:
              m.result.outcome.optionId === 'allow'
                ? 'OpenCode fixture completed'
                : 'OpenCode fixture denied',
          },
        });
        reply(prompt, { stopReason: 'end_turn' });
      } else if (m.method) send({ id: m.id, error: { code: -32601, message: 'Unsupported' } });
  }
});
