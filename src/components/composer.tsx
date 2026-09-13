import { ArrowUp, Square, ChevronUp, Trash2, Pencil, Play, Paperclip, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Attachment, ContextEntry, PromptContext, PermissionMode, Provider, ProviderInfo, QueueItem, Session } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import { InputGroup, InputGroupTextarea, InputGroupAddon } from './ui/input-group';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { AttachmentList, uploadFiles } from './attachments';
import { useSuggestions } from './context-suggestions';
import { emptyContext } from '../../shared/types';
import { IconButton, Picker } from './common';
export function Composer({ projectId, session, options, provider, providers, draft, onDraft, onProvider, onOptions, onSend, onStop, onError, disabled, attachments, onAttachments }: {
  projectId: string; attachments: Attachment[]; onAttachments(items: Attachment[]): void; options: { model: string; effort: string; mode?: string };
  session?: Session; provider: Provider; providers: ProviderInfo[]; draft: string; onDraft(text: string): void; onProvider(provider: Provider): void; onOptions(patch: { model?: string; effort?: string; mode?: PermissionMode }): void; onSend(context: PromptContext): Promise<boolean | undefined>; onStop(): void; onError(error: string): void; disabled?: boolean;
}) {
  const t = useI18n(), info = providers.find(p => p.provider === provider);
  const [context, setContext] = useState<PromptContext>(session?.draftContext || emptyContext);
  const [skills, setSkills] = useState<ContextEntry[]>([]);
  useEffect(() => { let live = true; void window.moose.request('listSkills', { projectId }).then(items => { if (live) setSkills(items); }).catch(error => onError(String(error))); return () => { live = false; }; }, [projectId, onError]);
  const updateContext = (value: PromptContext) => { setContext(value); if (session) void window.moose.request('updateSession', { id: session.id, draftContext: value }).catch(error => onError(String(error))); };
  const suggestions = useSuggestions(projectId, provider, draft, onDraft, context, updateContext, onError);
  const busy = !!session && ['running', 'waiting', 'queued'].includes(session.status);
  const [sending, setSending] = useState(false), [queue, setQueue] = useState<QueueItem[]>([]), [editing, setEditing] = useState(''), [editedText, setEditedText] = useState('');
  useEffect(() => {
    if (!session) { setQueue([]); return; }
    let live = true;
    const refresh = () => { void window.moose.request('queue', { sessionId: session.id }).then(q => { if (live) setQueue(q); }).catch(error => onError(String(error))); };
    refresh(); const stop = window.moose.subscribe(event => { if (event.type === 'changed') refresh(); });
    return () => { live = false; stop(); };
  }, [session?.id, onError]);
  const send = async () => { if ((!draft.trim() && !attachments.length) || sending || disabled || session?.archived || (info?.images === false && attachments.some(a => a.mime.startsWith('image/')))) return; setSending(true); try { if (await onSend(context)) setContext({ ...context, skills: [], references: [] }); } finally { setSending(false); } };
  const model = info?.models.find(m => m.id === options.model);
  const changeQueue = (id: string, remove: boolean, text?: string) => { void window.moose.request('updateQueue', { id, remove, text }).then(() => setEditing('')).catch(error => onError(String(error))); };
  const receive = async (files: File[]) => { try { const added = await uploadFiles(files); if (attachments.length + added.length > 10) throw new Error(t('attachmentLimit')); onAttachments([...attachments, ...added]); } catch (error) { onError(String(error)); } };
  const unsupportedImages = info?.images === false && attachments.some(a => a.mime.startsWith('image/'));
  return <div className="composer-region" onDragOver={e => { e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (!session?.archived) void receive(Array.from(e.dataTransfer.files)); }} onPaste={e => { if (e.clipboardData.files.length && !session?.archived) { e.preventDefault(); void receive(Array.from(e.clipboardData.files)); } }}>
    {queue.length > 0 && <details className="queue-panel"><summary><ChevronUp size={13} /><span>{t('queued')}</span><span>{queue.length}</span></summary><div className="queue-content">{queue.map(item => <div className="queue-item" key={item.id}>{editing === item.id ? <div className="queue-edit"><Textarea aria-label={t('edit')} value={editedText} onChange={e => setEditedText(e.target.value)} /><div className="flex gap-2"><Button size="xs" onClick={() => changeQueue(item.id, false, editedText)} disabled={!editedText.trim()}>{t('save')}</Button><Button size="xs" variant="ghost" onClick={() => setEditing('')}>{t('cancel')}</Button></div></div> : <><p>{item.text}</p><IconButton size="icon-xs" label={t('edit')} onClick={() => { setEditing(item.id); setEditedText(item.text); }}><Pencil /></IconButton><IconButton size="icon-xs" label={t('remove')} onClick={() => changeQueue(item.id, true)}><Trash2 /></IconButton></>}</div>)}{session && !busy && <div className="queue-resume"><span>{t('queuePaused')}</span><Button size="xs" variant="secondary" onClick={() => { void window.moose.request('resumeQueue', { sessionId: session.id }).catch(error => onError(String(error))); }}><Play data-icon="inline-start" />{t('resumeQueue')}</Button></div>}</div></details>}
    {suggestions.menu}
    <InputGroup className="composer-input">{(context.mode !== 'build' || context.references.length > 0 || context.skills.length > 0) && <div className="context-chips">{context.mode !== 'build' && <button onClick={() => updateContext({ ...context, mode: 'build' })}>{t(context.mode === 'plan' ? 'planMode' : 'goalMode')}<X /></button>}{context.references.map(path => <button key={path} onClick={() => updateContext({ ...context, references: context.references.filter(p => p !== path) })}>{path}<X /></button>)}{context.skills.map((id, index) => <button key={id} onClick={() => updateContext({ ...context, skills: context.skills.filter(s => s !== id) })}>{skills.find(skill => skill.id === id)?.name || `${t('skill')} ${index + 1}`}<X /></button>)}</div>}{attachments.length > 0 && <AttachmentList items={attachments} onRemove={id => onAttachments(attachments.filter(a => a.id !== id))} />}
      <InputGroupTextarea ref={suggestions.input} id="composer" aria-autocomplete="list" aria-controls={suggestions.open ? 'context-suggestions' : undefined} aria-activedescendant={suggestions.open ? `context-option-${suggestions.index}` : undefined} onSelect={e => suggestions.setCaret(e.currentTarget.selectionStart)} aria-label={t('prompt')} placeholder={t('prompt')} value={draft} disabled={disabled || session?.archived} onChange={e => { onDraft(e.target.value); suggestions.setCaret(e.target.selectionStart); }} onKeyDown={e => { if (suggestions.onKeyDown(e)) return; if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void send(); } }} />
      <InputGroupAddon align="block-end" className="composer-controls">
        <div className="composer-pickers"><IconButton label={t('attach')} disabled={session?.archived} onClick={() => { void window.moose.request('pickAttachments', {}).then(added => { if (attachments.length + added.length > 10) throw new Error(t('attachmentLimit')); onAttachments([...attachments, ...added]); }).catch(error => onError(String(error))); }}><Paperclip /></IconButton><Picker title={t(options.mode === 'full' ? 'fullDescription' : options.mode === 'auto' ? 'autoDescription' : 'askDescription')} label={t('permissionsLabel')} value={options.mode || 'ask'} onChange={mode => onOptions({ mode: mode as PermissionMode })} disabled={busy} options={(info?.modes.length ? info.modes : [{ id: 'ask' }]).map(m => ({ value: m.id, label: t(m.id as PermissionMode) }))} className={`compact-picker permission-picker ${options.mode === 'full' ? 'permission-full' : ''}`} /><Picker label={t('provider')} value={provider} onChange={value => onProvider(value as Provider)} disabled={!!session} options={[{ value: 'codex', label: 'Codex' }, { value: 'grok', label: 'Grok Build' }]} className="compact-picker agent-picker" />
          <Picker label={t('model')} value={options.model} onChange={model => onOptions({ model, effort: '' })} disabled={busy} options={[{ value: '', label: t('defaultModel') }, ...(info?.models || []).map(m => ({ value: m.id, label: m.name }))]} className="compact-picker model-picker" />
          {!!model?.efforts.length && <Picker label={t('effort')} value={options.effort} onChange={effort => onOptions({ effort })} disabled={busy} options={[{ value: '', label: t('defaultEffort') }, ...model.efforts.map(e => ({ value: e.id, label: e.label }))]} className="compact-picker effort-picker" />}</div>
        <div className="flex shrink-0 items-center gap-1">{busy && <IconButton label={t('stop')} onClick={onStop}><Square fill="currentColor" /></IconButton>}<Button size="icon" className="send-button" aria-label={t('send')} onClick={() => { void send(); }} disabled={disabled || unsupportedImages || (!draft.trim() && !attachments.length) || sending || session?.archived}><ArrowUp /></Button></div>
      </InputGroupAddon>
    </InputGroup>
    <div className="composer-foot">{unsupportedImages && <span>{t('imageUnavailable')}</span>}<span>{session?.archived ? t('archivedHint') : busy ? t('queueHint') : t('sendHint')}</span></div>
  </div>;
}
