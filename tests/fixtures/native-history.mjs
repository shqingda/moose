// Native session endpoints shared by deterministic protocol tests; no model calls.
let childStatus = 'active';
let childReply = 'Child history stays in its own panel.';
export function nativeHistoryPeer(
  { method, id, params: p = {} },
  { result, notify, session, cwd },
) {
  const path = process.env.MOOSE_HISTORY_CWD || p.cwd || cwd;
  const thread = (nativeId) => ({
    id: nativeId,
    name:
      nativeId === 'history-root'
        ? 'Imported native conversation'
        : nativeId === 'history-second'
          ? 'Second native conversation'
          : 'Forked native conversation',
    cwd: path,
    parentThreadId: nativeId === 'child-fixture' ? session : null,
    forkedFromId: nativeId === 'history-fork' ? 'history-root' : null,
    status: { type: nativeId === 'child-fixture' ? childStatus : 'idle' },
    canAcceptDirectInput: nativeId === 'child-fixture',
    model: 'fixture',
    reasoningEffort: 'high',
    updatedAt: 1900000000,
  });
  if (p.threadId === 'child-fixture' && method === 'turn/steer') {
    childReply = 'Child accepted: ' + p.input[0].text;
    result(id, { turnId: 'child-turn' });
    return true;
  }
  if (p.threadId === 'child-fixture' && method === 'turn/interrupt') {
    childStatus = 'idle';
    result(id, {});
    notify('turn/completed', {
      threadId: 'child-fixture',
      turn: { id: 'child-turn', status: 'interrupted' },
    });
    return true;
  }
  if (method === 'thread/list') {
    result(id, {
      data: [thread(p.cursor ? 'history-second' : 'history-root')],
      nextCursor: p.cursor ? null : 'second',
    });
    return true;
  }
  if (method === 'thread/read') {
    result(id, { thread: thread(p.threadId) });
    return true;
  }
  if (method === 'thread/items/list') {
    const child = p.threadId === 'child-fixture';
    result(id, {
      data: [
        {
          turnId: 'history-turn',
          item:
            p.cursor || child
              ? {
                  type: 'agentMessage',
                  id: 'native-answer',
                  text: child ? childReply : 'Native history second page.',
                }
              : {
                  type: 'userMessage',
                  id: 'native-user',
                  content: [{ type: 'text', text: 'Native history first page.' }],
                },
        },
      ],
      nextCursor: p.cursor || child ? null : 'items-second',
    });
    return true;
  }
  if (method === 'thread/turns/list') {
    result(id, { data: [{ id: 'child-turn', status: 'inProgress' }], nextCursor: null });
    return true;
  }
  if (method === 'thread/fork' && p.threadId === 'history-root') {
    result(id, { thread: thread('history-fork') });
    return true;
  }
  if (method === 'thread/compact/start') {
    result(id, {});
    notify('turn/started', { threadId: p.threadId, turn: { id: 'compact-turn' } });
    setTimeout(() => {
      notify('item/completed', {
        threadId: p.threadId,
        item: { id: 'compact-item', type: 'contextCompaction' },
      });
      notify('turn/completed', {
        threadId: p.threadId,
        turn: { id: 'compact-turn', status: 'completed' },
      });
    }, 500);
    return true;
  }
  if (method === 'session/list') {
    result(id, {
      sessions: [
        {
          sessionId: 'grok-history',
          cwd: path,
          title: 'Grok native history',
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    return true;
  }
  if (method === 'session/load' && p.sessionId === 'grok-history') {
    for (const [kind, text] of [
      ['user_message_chunk', 'Grok history question'],
      ['agent_message_chunk', 'Grok history answer'],
    ])
      notify('session/update', {
        sessionId: p.sessionId,
        update: { sessionUpdate: kind, content: { type: 'text', text } },
      });
    result(id, {});
    return true;
  }
  return false;
}
