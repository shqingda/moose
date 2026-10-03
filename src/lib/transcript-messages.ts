import type { Message, TranscriptPage } from '../../shared/types';

/** Keep unchanged snapshots referentially stable and avoid sorting every streamed delta. */
export function mergeMessages(previous: Message[], incoming: Message[]): Message[] {
  let result = previous;
  let reordered = false;
  // A stream normally updates one of the last rows. Only build an index for page merges.
  const indices =
    incoming.length > 1
      ? new Map(previous.map((message, index) => [message.id, index]))
      : undefined;
  for (const message of incoming) {
    const index = indices
      ? (indices.get(message.id) ?? -1)
      : result.findLastIndex((row) => row.id === message.id);
    const old = result[index];
    if (old && old.seq >= message.seq) continue;
    if (result === previous) result = previous.slice();
    if (old) {
      reordered ||= old.position !== message.position;
      result[index] = message;
    } else {
      reordered ||= !!result.length && result[result.length - 1].position > message.position;
      indices?.set(message.id, result.length);
      result.push(message);
    }
  }
  if (reordered) result.sort((a, b) => a.position - b.position);
  return result;
}

export function mergeTranscriptPage(
  previous: TranscriptPage,
  incoming: Message[],
  hasMore = previous.hasMore,
): TranscriptPage {
  const messages = mergeMessages(previous.messages, incoming);
  return messages === previous.messages && hasMore === previous.hasMore
    ? previous
    : { messages, hasMore };
}
