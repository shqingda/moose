import { constants } from 'node:fs';
import { open, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { NativeEntry, NativeThread } from '../../shared/native-sessions';
import type { NativeSessions } from './native-types';
import { array, record, string, readable } from './types';

const limit = 20_000_000;
const expand = (path: string) => resolve(path.replace(/^~(?=\/|$)/, homedir()));
export const piSessionDirectory = (cwd: string, agentDir: string) =>
  join(
    agentDir,
    'sessions',
    `--${resolve(cwd)
      .replace(/^[/\\]/, '')
      .replace(/[/\\:]/g, '-')}--`,
  );
type Entry = Record<string, unknown>;

/** Follow the last persisted leaf, as Pi does when reopening a session file. */
export function parsePiHistory(text: string) {
  let records: Entry[];
  try {
    records = text
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => record(JSON.parse(line)));
  } catch {
    throw new Error('Pi history contains invalid JSON. The source file was not changed.');
  }
  const [header, ...entries] = records;
  if (header?.type !== 'session' || !string(header.id) || !string(header.cwd))
    throw new Error('Pi history has no valid session header');
  if (header.version !== 2 && header.version !== 3)
    throw new Error('This Pi history format is unsupported (expected version 2 or 3)');
  if (entries.length > 10000) throw new Error('Pi history exceeds the 10,000 entry import limit');
  const index = new Map<string, Entry>();
  for (const entry of entries) {
    const id = string(entry.id);
    if (!id || index.has(id) || (entry.parentId !== null && !index.has(string(entry.parentId))))
      throw new Error('Pi history has an invalid branch or duplicate entry');
    index.set(id, entry);
  }
  const path: Entry[] = [];
  for (let entry = entries.at(-1); entry; entry = index.get(string(entry.parentId)))
    path.push(entry);
  path.reverse();
  let selected = path;
  const compactAt = path.findLastIndex((entry) => entry.type === 'compaction');
  if (compactAt >= 0) {
    const compaction = path[compactAt];
    const keepAt = path.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
    if (keepAt < 0 || keepAt > compactAt)
      throw new Error('Pi compaction has an invalid retained range');
    selected = [compaction, ...path.slice(keepAt, compactAt), ...path.slice(compactAt + 1)];
  }
  let model = '',
    effort = '',
    title = '';
  for (const entry of entries)
    if (entry.type === 'session_info') title = string(entry.name) || title;
  for (const entry of path) {
    if (entry.type === 'model_change') model = `${string(entry.provider)}/${string(entry.modelId)}`;
    if (entry.type === 'thinking_level_change') effort = string(entry.thinkingLevel);
    if (!title && entry.type === 'message' && record(entry.message).role === 'user')
      title = contentText(record(entry.message).content).slice(0, 160);
  }
  const items: NativeEntry[] = [];
  const push = (entry: Entry, kind: NativeEntry['kind'], text: string, title = '') => {
    if (text.length > 500000) throw new Error('Pi history entry exceeds the import limit');
    items.push({ id: `${string(entry.id)}:${items.length}`, turnId: '', kind, text, title });
  };
  for (const entry of selected) {
    if (entry.type === 'compaction' || entry.type === 'branch_summary') {
      push(
        entry,
        'notice',
        string(entry.summary),
        entry.type === 'compaction' ? 'Context compacted' : 'Branch summary',
      );
      continue;
    }
    // A context edit changes future model input, not the original displayed history.
    if (entry.type === 'context_edit') {
      push(
        entry,
        'notice',
        `Future context changed for entry ${string(entry.targetId)}. Original history is preserved.`,
        'Context edit',
      );
      continue;
    }
    if (entry.type === 'custom_message') {
      if (entry.display !== false)
        push(entry, 'notice', contentText(entry.content), string(entry.customType));
      continue;
    }
    if (entry.type !== 'message') continue;
    const message = record(entry.message),
      role = string(message.role);
    if (role === 'system') continue;
    if (role === 'assistant') {
      for (const value of array(message.content)) {
        const block = record(value);
        if (block.type === 'thinking') push(entry, 'reasoning', string(block.thinking));
        else if (block.type === 'toolCall')
          push(entry, 'tool', readable(block.arguments), string(block.name));
        else if (block.type === 'text') push(entry, 'assistant', string(block.text));
      }
      if (message.stopReason === 'error') push(entry, 'error', string(message.errorMessage));
    } else if (role === 'user') push(entry, 'user', contentText(message.content));
    else if (role === 'toolResult')
      push(entry, 'tool', contentText(message.content), string(message.toolName));
    else if (role === 'bashExecution')
      push(entry, 'tool', string(message.output), string(message.command));
    else if (role === 'custom' || role === 'hookMessage')
      push(entry, 'notice', contentText(message.content));
  }
  return { header, items, model, effort, title };
}
function contentText(content: unknown) {
  if (typeof content === 'string') return content;
  return array(content)
    .map((value) => {
      const block = record(value);
      return block.type === 'text' ? string(block.text) : `[${string(block.type) || 'attachment'}]`;
    })
    .join('\n');
}
function page<T>(data: T[], digest: string, cursor?: string) {
  const [revision, position] = cursor?.split(':') || [digest, '0'];
  const offset = Number(position);
  if (revision !== digest)
    throw new Error('Pi history changed. Refresh the preview before importing.');
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid history cursor');
  return {
    data: data.slice(offset, offset + 40),
    nextCursor: offset + 40 < data.length ? `${digest}:${offset + 40}` : null,
  };
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);

/** Pure file reads: never starts Pi, rewrites its JSONL, or executes extensions. */
export class PiSessions implements NativeSessions {
  private cache?: {
    id: string;
    cwd: string;
    value: ReturnType<typeof parsePiHistory>;
    hash: string;
    thread: NativeThread;
  };
  constructor(
    private agentDir = expand(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent')),
    private sessionDir = process.env.PI_CODING_AGENT_SESSION_DIR
      ? expand(process.env.PI_CODING_AGENT_SESSION_DIR)
      : undefined,
  ) {}
  async capabilities() {
    return {
      history: true,
      fork: false,
      compact: false,
      children: false,
      reason: 'Pi JSONL history is read-only. Fork, compaction and child controls are not exposed.',
    };
  }
  private async directory(cwd: string) {
    if (this.sessionDir) return realpath(this.sessionDir);
    const root = await realpath(join(this.agentDir, 'sessions'));
    const directory = await realpath(piSessionDirectory(cwd, this.agentDir));
    if (dirname(directory) !== root)
      throw new Error('Pi history directory is outside the configured session root');
    return directory;
  }
  private async load(id: string, cwd: string) {
    if (this.cache?.id === id && this.cache.cwd === cwd) return this.cache;
    const directory = await this.directory(cwd);
    const path = resolve(id);
    // A native ID is a session file, never an arbitrary path supplied by a renderer.
    if (dirname(path) !== directory || !path.endsWith('.jsonl'))
      throw new Error('Pi history is outside this project session directory');
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await file.stat();
      if (!before.isFile() || before.size > limit)
        throw new Error('Pi history exceeds the file reading limit');
      const buffer = Buffer.alloc(before.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await file.stat();
      if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
        throw new Error(
          'Pi history changed while reading. Try again when the native task is idle.',
        );
      const text = buffer.subarray(0, length).toString('utf8');
      const value = parsePiHistory(text);
      if ((await realpath(string(value.header.cwd))) !== (await realpath(cwd)))
        throw new Error('Native session belongs to a different project');
      const thread: NativeThread = {
        id: path,
        cwd: string(value.header.cwd),
        title: value.title || basename(path),
        updatedAt: before.mtimeMs,
        parentId: null,
        forkedFromId: string(value.header.parentSession) || null,
        status: 'unknown',
        model: value.model,
        effort: value.effort,
        canAcceptInput: false,
      };
      return (this.cache = { id: path, cwd, value, hash: digest(text), thread });
    } finally {
      await file.close();
    }
  }
  async list(cwd: string, cursor?: string) {
    let directory: string;
    try {
      directory = await this.directory(cwd);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { data: [], nextCursor: null };
      throw error;
    }
    const files = (await readdir(directory, { withFileTypes: true }))
      .filter((file) => file.isFile() && file.name.endsWith('.jsonl'))
      .map((file) => file.name)
      .sort()
      .reverse();
    if (files.length > 10000) throw new Error('Pi history directory exceeds the discovery limit');
    const batch = page(files, digest(files.join('\n')), cursor);
    const data: NativeThread[] = [];
    for (const name of batch.data) {
      const id = join(directory, name);
      try {
        data.push((await this.load(id, cwd)).thread);
      } catch (error) {
        // Keep damaged files visible and explain the error when opened, without importing partial data.
        data.push({
          id,
          cwd,
          title: `${name} · ${String(error)}`,
          updatedAt: 0,
          parentId: null,
          forkedFromId: null,
          status: 'error',
          model: '',
          effort: '',
          canAcceptInput: false,
        });
      }
    }
    return { data, nextCursor: batch.nextCursor };
  }
  async read(id: string, cwd: string) {
    return (await this.load(id, cwd)).thread;
  }
  async items(id: string, cwd: string, cursor?: string) {
    const result = await this.load(id, cwd);
    return page(result.value.items, result.hash, cursor);
  }
}
