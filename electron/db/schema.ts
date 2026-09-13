import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(), name: text('name').notNull(), path: text('path').notNull().unique(), createdAt: integer('created_at').notNull(),
});
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id),
  provider: text('provider').notNull(), title: text('title').notNull(), archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  nativeId: text('native_id'), model: text('model').notNull().default(''), effort: text('effort').notNull().default(''), mode: text('mode').notNull().default(''),
  draftContext: text('draft_context', { mode: 'json' }).$type<import('../../shared/types').PromptContext>(),
  draftAttachments: text('draft_attachments', { mode: 'json' }).$type<import('../../shared/types').Attachment[]>().notNull().default([]), historySeed: text('history_seed').notNull().default(''),
  draft: text('draft').notNull().default(''), status: text('status').notNull().default('idle'), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
});
export const messages = sqliteTable('messages', {
  position: integer('position').primaryKey({ autoIncrement: true }), id: text('id').notNull().unique(), sessionId: text('session_id').notNull().references(() => sessions.id),
  runId: text('run_id').notNull(), seq: integer('seq').notNull(), kind: text('kind').notNull(), text: text('text').notNull(), title: text('title').notNull(),
  state: text('state').notNull(), details: text('details').notNull().default('{}'), createdAt: integer('created_at').notNull(),
}, table => [index('messages_session_position').on(table.sessionId, table.position)]);
export const queue = sqliteTable('queue', { context: text('context', { mode: 'json' }).$type<import('../../shared/types').PromptContext>(), attachments: text('attachments', { mode: 'json' }).$type<import('../../shared/types').Attachment[]>().notNull().default([]), id: text('id').primaryKey(), sessionId: text('session_id').notNull().references(() => sessions.id), text: text('text').notNull(), createdAt: integer('created_at').notNull() });
export const settings = sqliteTable('settings', { key: text('key').primaryKey(), value: text('value').notNull() });
