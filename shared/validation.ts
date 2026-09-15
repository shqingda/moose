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
});
export const schemas = {
  usage: z.strictObject({ provider: z.enum(providerIds), sessionId: id.optional() }),
  searchFiles: z.strictObject({ projectId: id, query: z.string().max(300) }),
  listSkills: z.strictObject({ projectId: id }),
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
  gitStatus: z.strictObject({ projectId: id }),
  gitDiff: z.strictObject({ projectId: id, path: z.string().min(1).max(4096), area }),
  openProject: z.strictObject({ projectId: id, target: z.enum(['finder', 'editor']) }),
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
