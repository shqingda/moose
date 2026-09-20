#!/usr/bin/env node
import { createInterface } from 'node:readline';
if (process.argv.includes('--version')) {
  console.log('grok 1.0.34');
  process.exit(0);
}
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const reply = (id, result) => send({ id, result });
let prompt;
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line),
    p = m.params || {};
  if (m.method === 'session/load') reply(m.id, {});
  else if (m.method === 'initialize')
    reply(m.id, {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
    });
  else if (m.method === 'session/new') reply(m.id, { sessionId: 'fixture-grok' });
  else if (m.method === 'session/prompt') {
    if (p.prompt[0].text === '/always-approve off') return reply(m.id, { stopReason: 'end_turn' });
    prompt = m.id;
    send({
      method: 'session/update',
      params: {
        sessionId: 'fixture-grok',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Ready' } },
      },
    });
  } else if (m.method === '_x.ai/interject') {
    if (p.text === 'unsupported')
      return send({ id: m.id, error: { code: -32601, message: 'Unsupported' } });
    if (p.text === 'disconnect') return process.exit(0);
    if (p.sessionId !== 'fixture-grok' || !p.content?.some((c) => c.type === 'text'))
      return send({ id: m.id, error: { code: -32602, message: 'Missing content' } });
    reply(m.id, { status: 'queued' });
    send({
      method: 'session/update',
      params: {
        sessionId: 'fixture-grok',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text:
              'Steered: ' +
              p.content[0].text +
              (p.content.some(
                (c) => c.type === 'image' && c.data === 'aGVsbG8=' && c.mimeType === 'image/png',
              )
                ? ' [image]'
                : ''),
          },
        },
      },
    });
    reply(prompt, { stopReason: 'end_turn' });
  } else if (m.method === 'session/cancel') {
    process.exit(4);
  }
});
