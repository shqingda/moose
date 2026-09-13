import { expect, it } from 'vitest';
import { normalizeCodex } from '../../electron/providers/codex';
import { grokModels, normalizeGrok } from '../../electron/providers/grok';
import { validate } from '../../shared/validation';
import { providerError } from '../../electron/providers/types';
it('surfaces actionable Grok billing errors hidden inside generic JSON-RPC errors', () => {
  expect(providerError({ message: 'Internal error', data: { message: 'API error (status 402 Payment Required): Grok Build usage balance exhausted', http_status: 402 } })).toContain('Grok Build usage balance exhausted');
});
it('normalizes Codex deltas and completed tool output without duplicating final text', () => {
  expect(normalizeCodex('item/agentMessage/delta', { itemId: '1', delta: 'Hello' })).toMatchObject({ key: '1', delta: 'Hello', kind: 'assistant' });
  expect(normalizeCodex('item/completed', { item: { id: '1', type: 'agentMessage', text: 'Hello' } })).toMatchObject({ key: '1', text: 'Hello', state: 'done' });
  expect(normalizeCodex('item/completed', { item: { id: 'tool', type: 'commandExecution', command: 'test', aggregatedOutput: 'failed', status: 'failed' } })).toMatchObject({ state: 'error', title: 'test' });
  expect(normalizeCodex('private/control/marker', {})).toBeNull();
});
it('uses real ACP model metadata and preserves tool updates', () => {
  expect(grokModels({ modelState: { availableModels: [{ modelId: 'model', name: 'Model', _meta: { reasoningEfforts: [{ value: 'high', label: 'High' }] } }] } })).toEqual([{ id: 'model', name: 'Model', efforts: [{ id: 'high', label: 'High' }] }]);
  expect(normalizeGrok({ sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } } }, 'chunk')).toMatchObject({ delta: 'hello', key: 'chunk' });
  expect(normalizeGrok({ sessionId: 's', update: { sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed' } }, 'chunk')).toMatchObject({ key: 't', state: 'done' });
});
it('rejects privileged or malformed renderer requests', () => {
  expect(() => validate('openExternal', { url: 'javascript:alert(1)' })).toThrow();
  expect(() => validate('send', { sessionId: 'not-an-id', text: 'go' })).toThrow();
  expect(() => validate('snapshot', { method: '_shutdown' })).toThrow();
  expect(() => validate('__proto__' as 'snapshot', {})).toThrow();
  expect(validate('openExternal', { url: 'https://example.com' })).toEqual({ url: 'https://example.com' });
});

it('preserves streamed reasoning when the completed item has an empty summary', () => {
 expect(normalizeCodex('item/reasoning/textDelta', { itemId: 'r', delta: 'Visible reasoning' })).toMatchObject({ kind: 'reasoning', delta: 'Visible reasoning' });
 expect(normalizeCodex('item/completed', { item: { type: 'reasoning', id: 'r', summary: [], content: [] } })).not.toHaveProperty('text');
 expect(normalizeCodex('item/completed', { item: { type: 'reasoning', id: 'r', summary: [], content: ['Visible content'] } })).toMatchObject({ text: 'Visible content' });
});
