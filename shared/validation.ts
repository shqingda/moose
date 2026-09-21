import { mcpRegistration } from './mcp-registration';
import { providerIds } from './providers';
import { z } from 'zod';
import type { Method, Requests } from './types';
const id = z.string().uuid();
const text = z.string().trim().min(1).max(100_000);
const area = z.enum(['staged', 'unstaged', 'untracked']);
const empty = z.strictObject({});
const context = z.strictObject({
  inline: z.boolean().optional(),
  mode: z.enum(['build', 'plan', 'goal']),
  references: z.array(z.string().min(1).max(4096)).max(30),
  skills: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(20),
  goalBudget: z.number().int().min(1000).max(1_000_000).optional(),
  subagents: z.boolean().optional(),
});
const nativeId = z.string().min(1).max(200);
const cursor = z.string().min(1).max(4096).optional();
const gitRef = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine((v) => !v.startsWith('-') && !v.includes('\0'));
const backgroundScope = { projectId: id, sessionId: id.optional() };
const scheduleDefinition = {
  calendar: z
    .strictObject({
      weekdays: z
        .array(z.number().int().min(1).max(7))
        .min(1)
        .max(7)
        .refine((days) => new Set(days).size === days.length),
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
    })
    .nullable()
    .optional(),
  name: z.string().trim().min(1).max(100),
  task: z.strictObject({
    kind: z.enum(['command', 'agent']),
    text: z.string().trim().min(1).max(16000),
  }),
  timezone: z
    .string()
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
  startAt: z.number().int().min(0).max(8640000000000000),
  intervalMs: z.number().int().min(60000).max(31536000000).nullable(),
};
const terminalSize = {
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(1).max(200),
};
export const schemas = {
  terminalList: z.strictObject(backgroundScope),
  terminalStart: z.strictObject({ ...backgroundScope, requestId: id, ...terminalSize }),
  terminalRead: z.strictObject({
    id,
    offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }),
  terminalInput: z.strictObject({ id, text: z.string().max(16000), lease: id.optional() }),
  terminalResize: z.strictObject({ id, ...terminalSize, lease: id.optional() }),
  terminalStop: z.strictObject({ id }),
  terminalControl: z.strictObject({
    id,
    action: z.enum(['acquire', 'takeover', 'renew', 'release']),
    lease: id.optional(),
  }),
  commandList: z.strictObject(backgroundScope),
  commandRead: z.strictObject({ id }),
  commandStart: z.strictObject({
    ...backgroundScope,
    requestId: id,
    command: z.string().trim().min(1).max(16000),
  }),
  commandInput: z.strictObject({ id, text: z.string().max(16000), eof: z.boolean().optional() }),
  commandStop: z.strictObject({ id }),
  scheduleList: z.strictObject(backgroundScope),
  scheduleCreate: z.strictObject({
    ...backgroundScope,
    requestId: id,
    ...scheduleDefinition,
  }),
  scheduleUpdate: z.strictObject({
    id,
    version: z.number().int().positive(),
    ...scheduleDefinition,
  }),
  scheduleSet: z.strictObject({ id, version: z.number().int().positive(), enabled: z.boolean() }),
  worktreeList: z.strictObject({ projectId: id }),
  worktreeCreate: z.strictObject({
    projectId: id,
    provider: z.enum(providerIds),
    ref: gitRef,
    branch: gitRef,
    requestId: id,
  }),
  worktreeStatus: z.strictObject({ id }),
  worktreeKeep: z.strictObject({ id, kept: z.boolean() }),
  worktreeRemove: z.strictObject({ id }),
  worktreeMerge: z.strictObject({
    id,
    sourceCommit: z.string().regex(/^[a-f0-9]{40,64}$/),
    targetCommit: z.string().regex(/^[a-f0-9]{40,64}$/),
    targetBranch: gitRef,
  }),
  worktreeResolve: z.strictObject({ id, path: z.string().min(1).max(4096) }),
  worktreeComplete: z.strictObject({ id, indexFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }),
  worktreeAbort: z.strictObject({ id }),
  workspacePath: z.strictObject({ projectId: id, sessionId: id.optional() }),

  nativeCapabilities: z.strictObject({ provider: z.enum(providerIds) }),
  nativeList: z.strictObject({
    sessionId: id.optional(),
    projectId: id,
    provider: z.enum(providerIds),
    cursor,
  }),
  nativeRead: z.strictObject({
    sessionId: id.optional(),
    projectId: id,
    provider: z.enum(providerIds),
    nativeId,
    cursor,
  }),
  nativeImport: z.strictObject({
    sessionId: id.optional(),
    projectId: id,
    provider: z.enum(providerIds),
    nativeId,
  }),
  nativeFork: z.strictObject({ sessionId: id, turnId: nativeId, requestId: id }),
  nativeCompact: z.strictObject({ sessionId: id, requestId: id }),
  childThreads: z.strictObject({ sessionId: id }),
  childRead: z.strictObject({ sessionId: id, nativeId, cursor }),
  childControl: z.strictObject({
    sessionId: id,
    nativeId,
    action: z.enum(['send', 'stop', 'resume']),
    text: text.optional(),
    requestId: id,
  }),

  usage: z.strictObject({ provider: z.enum(providerIds), sessionId: id.optional() }),
  searchFiles: z.strictObject({
    sessionId: id.optional(),
    projectId: id,
    query: z.string().max(300),
  }),
  listSkills: z.strictObject({ sessionId: id.optional(), projectId: id }),
  responseText: z.strictObject({ sessionId: id, runId: z.string().min(1).max(500) }),
  copyText: z.strictObject({ text: z.string().max(1_000_000) }),
  snapshot: empty,
  addProject: empty,
  pickAttachments: empty,
  deleteProject: z.strictObject({ projectId: id }),
  deleteSession: z.strictObject({ sessionId: id }),
  editMessage: z.strictObject({
    sessionId: id,
    messageId: z.string().min(1).max(500),
    text: z.string().trim().max(100_000),
  }),
  uploadAttachment: z.strictObject({
    name: z.string().min(1).max(255),
    data: z
      .string()
      .max(28_000_000)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  }),
  attachmentPreview: z.strictObject({ id }),
  createSession: z.strictObject({ projectId: id, provider: z.enum(providerIds) }),
  updateSession: z.strictObject({
    id,
    title: z.string().trim().min(1).max(160).optional(),
    archived: z.boolean().optional(),
    draft: z.string().max(100_000).optional(),
    model: z.string().max(200).optional(),
    effort: z.string().max(100).optional(),
    mode: z.enum(['ask', 'auto', 'full']).optional(),
    draftContext: context.optional(),
    draftAttachments: z.array(id).max(10).optional(),
  }),
  messages: z.strictObject({ sessionId: id, before: z.number().int().positive().optional() }),
  send: z
    .strictObject({
      sessionId: id,
      text: z.string().trim().max(100_000),
      context: context.optional(),
      attachments: z.array(id).max(10).optional(),
    })
    .refine((a) => a.text.length > 0 || !!a.attachments?.length, 'Add a message or attachment'),
  steer: z
    .strictObject({
      sessionId: id,
      requestId: id,
      text: z.string().trim().max(100_000),
      context: context.optional(),
      attachments: z.array(id).max(10).optional(),
    })
    .refine((a) => a.text.length > 0 || !!a.attachments?.length, 'Add a message or attachment'),
  editPlan: z.strictObject({
    sessionId: id,
    messageId: z.string().min(1).max(500),
    version: z.number().int().positive(),
    text,
  }),
  approvePlan: z.strictObject({
    sessionId: id,
    messageId: z.string().min(1).max(500),
    version: z.number().int().positive(),
  }),
  stop: z.strictObject({ sessionId: id }),
  queue: z.strictObject({ sessionId: id }),
  resumeQueue: z.strictObject({ sessionId: id }),
  updateQueue: z.strictObject({ id, text: text.optional(), remove: z.boolean().optional() }),
  respond: z.strictObject({
    sessionId: id,
    messageId: z.string().min(1).max(500),
    choice: z.string().max(300).optional(),
    answers: z.record(z.string(), z.string().max(10000)).optional(),
  }),
  providers: z.strictObject({ refresh: z.boolean().optional() }),
  settings: z.strictObject({
    codexEnabled: z.boolean().optional(),
    grokEnabled: z.boolean().optional(),
    piEnabled: z.boolean().optional(),
    opencodeEnabled: z.boolean().optional(),
    theme: z.enum(['system', 'light', 'dark']).optional(),
    language: z.enum(['system', 'en', 'zh-CN']).optional(),
    codexPath: z.string().max(4096).optional(),
    grokPath: z.string().max(4096).optional(),
    piPath: z.string().max(4096).optional(),
    opencodePath: z.string().max(4096).optional(),
    fontScale: z.number().min(0.85).max(1.4).optional(),
  }),
  extensionsRead: z.strictObject({
    projectId: id.optional(),
    sessionId: id.optional(),
    provider: z.enum(providerIds),
  }),
  extensionsChange: z.strictObject({
    projectId: id.optional(),
    sessionId: id.optional(),
    provider: z.enum(providerIds),
    requestId: id,
    change: z.discriminatedUnion('type', [
      z.strictObject({
        type: z.enum(['mcpAdd', 'mcpEdit']),
        sourceId: z.string().length(64),
        version: z.string().min(1).max(500),
        name: z
          .string()
          .max(100)
          .regex(/^[A-Za-z0-9_-]+$/),
        server: mcpRegistration,
      }),
      z.strictObject({
        type: z.literal('config'),
        sourceId: z.string().length(64),
        version: z.string().min(1).max(500),
        key: z.enum(['model', 'model_reasoning_effort']),
        value: z
          .string()
          .min(1)
          .max(100)
          .regex(/^[a-zA-Z0-9._/-]+$/),
      }),
      z.strictObject({
        type: z.literal('toggle'),
        sourceId: z.string().length(64),
        version: z.string().min(1).max(500),
        category: z.enum(['mcp', 'plugin']),
        name: z
          .string()
          .min(1)
          .max(300)
          .refine((value) => [...value].every((char) => char.charCodeAt(0) >= 32)),
        enabled: z.boolean(),
      }),
      z.strictObject({
        type: z.literal('plugin'),
        id: z.string().min(1).max(300),
        action: z.enum(['install', 'uninstall']),
      }),
    ]),
  }),
  extensionsLogin: z.strictObject({
    projectId: id.optional(),
    sessionId: id.optional(),
    provider: z.enum(providerIds),
    name: z.string().min(1).max(300),
    requestId: id,
  }),
  extensionsAuth: z.strictObject({ id, cancel: z.boolean().optional() }),
  gitStage: z.strictObject({
    projectId: id,
    sessionId: id.optional(),
    path: z.string().min(1).max(4096),
    staged: z.boolean(),
  }),
  gitCommitPreview: z.strictObject({ projectId: id, sessionId: id.optional() }),
  gitCommit: z.strictObject({
    projectId: id,
    sessionId: id.optional(),
    requestId: id,
    message: z.string().trim().min(1).max(10000),
    preview: z.strictObject({
      head: z.string().nullable(),
      branch: z.string(),
      fingerprint: z.string().length(64),
    }),
  }),
  prPreview: z.strictObject({
    projectId: id,
    sessionId: id.optional(),
    base: z.string().min(1).max(250),
  }),
  prCreate: z.strictObject({
    projectId: id,
    sessionId: id.optional(),
    requestId: id,
    title: z.string().trim().min(1).max(250),
    body: z.string().max(50000),
    preview: z.strictObject({
      repository: z.string().max(300),
      branch: z.string().max(250),
      head: z.string().max(64),
      base: z.string().max(250),
      baseCommit: z.string().max(64),
    }),
  }),
  reviewStart: z.strictObject({
    projectId: id,
    sessionId: id,
    requestId: id,
    target: z.discriminatedUnion('type', [
      z.strictObject({ type: z.literal('uncommittedChanges') }),
      z.strictObject({ type: z.literal('baseBranch'), branch: z.string().min(1).max(250) }),
      z.strictObject({ type: z.literal('commit'), sha: z.string().regex(/^[0-9a-f]{7,64}$/i) }),
    ]),
  }),
  reviewList: z.strictObject({ projectId: id, sessionId: id.optional() }),
  reviewStop: z.strictObject({ projectId: id, id }),
  gitStatus: z.strictObject({ sessionId: id.optional(), projectId: id }),
  gitDiff: z.strictObject({
    sessionId: id.optional(),
    projectId: id,
    path: z.string().min(1).max(4096),
    area,
  }),
  openProject: z.strictObject({
    sessionId: id.optional(),
    projectId: id,
    target: z.enum(['finder', 'editor']),
  }),
  openExternal: z.strictObject({
    url: z
      .url()
      .max(8192)
      .refine(
        (url) => ['https:', 'http:'].includes(new URL(url).protocol),
        'Only HTTP(S) links are allowed',
      ),
  }),
};
/** 从方法白名单选择 Zod schema；未知操作或非法参数在业务执行前拒绝。 */
export function validate<M extends Method>(method: M, input: unknown): Requests[M] {
  if (!Object.hasOwn(schemas, method)) throw new Error('Unknown operation');
  return schemas[method].parse(input) as Requests[M];
}
