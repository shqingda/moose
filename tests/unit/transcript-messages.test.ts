import { describe, expect, it } from 'vitest';
import type { Message } from '../../shared/types';
import { mergeMessages, mergeTranscriptPage } from '../../src/lib/transcript-messages';

const row = (id: string, position: number, seq = 1): Message => ({
  id,
  position,
  seq,
  sessionId: 'session',
  runId: 'run',
  kind: 'assistant',
  text: `message ${seq}`,
  title: '',
  state: 'running',
  createdAt: 0,
});

describe('transcript message reconciliation', () => {
  it('ignores stale refreshes without creating a new page or discarding streamed content', () => {
    const previous = { messages: [row('a', 1), row('b', 2, 3)], hasMore: true };
    expect(mergeTranscriptPage(previous, [row('a', 1), row('b', 2, 2)])).toBe(previous);
    expect(mergeMessages(previous.messages, [])).toBe(previous.messages);
    expect(mergeTranscriptPage(previous, [], false)).toEqual({ ...previous, hasMore: false });
  });

  it('replaces a streaming row without mutating old snapshots or unrelated message objects', () => {
    const previous = [row('a', 1), row('b', 2)];
    const update = row('b', 2, 2);
    const next = mergeMessages(previous, [update]);
    expect(next).toEqual([previous[0], update]);
    expect(next[0]).toBe(previous[0]);
    expect(previous[1].seq).toBe(1);
  });

  it('merges overlapping unordered pages and keeps the newest duplicate by ID', () => {
    const previous = [row('c', 3, 5), row('d', 4)];
    const next = mergeMessages(previous, [
      row('b', 2),
      row('a', 1),
      row('c', 3, 4),
      row('b', 2, 3),
      row('b', 2, 2),
      row('e', 5),
    ]);
    expect(next.map((message) => [message.id, message.seq])).toEqual([
      ['a', 1],
      ['b', 3],
      ['c', 5],
      ['d', 1],
      ['e', 1],
    ]);
    expect(next[2]).toBe(previous[0]);
  });

  it('reorders corrected positions while preserving equal-position insertion order', () => {
    const previous = [row('a', 1), row('b', 2), row('c', 3)];
    expect(mergeMessages(previous, [row('c', 0, 2)]).map((message) => message.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(mergeMessages(previous, [row('d', 2)]).map((message) => message.id)).toEqual([
      'a',
      'b',
      'd',
      'c',
    ]);
  });
});
