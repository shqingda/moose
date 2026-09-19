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
export const schemas = {
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
    theme: z.enum(['system', 'light', 'dark']).optional(),
    language: z.enum(['system', 'en', 'zh-CN']).optional(),
    codexPath: z.string().max(4096).optional(),
    grokPath: z.string().max(4096).optional(),
    piPath: z.string().max(4096).optional(),
    fontScale: z.number().min(0.85).max(1.4).optional(),
  }),
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
