import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, ChevronRight, Copy, Terminal, ShieldCheck, Brain, CircleAlert, Pencil, History } from 'lucide-react';
import type { Message as MessageData, Session } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import { useTranscript } from '../lib/workspace';
import { MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton } from './ui/message-scroller';
import { Message, MessageContent } from './ui/message';
import { Bubble, BubbleContent } from './ui/bubble';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Field, FieldLabel, FieldGroup } from './ui/field';
import { Alert, AlertDescription } from './ui/alert';
import { Marker, MarkerContent } from './ui/marker';
import { Skeleton } from './ui/skeleton';
import { AttachmentList } from './attachments';
import { Picker, IconButton } from './common';

const Markdown = memo(function Markdown({ text, onError }: { text: string; onError(error: string): void }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} skipHtml components={{
    a: ({ href, children }) => <a href={href} onClick={e => { e.preventDefault(); if (href) void window.moose.request('openExternal', { url: href }).catch(error => onError(String(error))); }}>{children}</a>,
    img: ({ alt }) => <span className="image-placeholder">{alt || 'Image'}</span>,
  }}>{text}</ReactMarkdown></div>;
});
function Questions({ message, onError }: { message: MessageData; onError(error: string): void }) {
  const t = useI18n(); const [answers, setAnswers] = useState<Record<string, string>>({}), [sending, setSending] = useState(false);
  const pending = message.state === 'pending';
  return <div className="request-surface"><div className="request-heading"><ShieldCheck size={16} /><span>{t('pending')}</span></div><FieldGroup>{message.questions?.map(q => <Field key={q.id}><FieldLabel htmlFor={`question-${q.id}`}>{q.text}</FieldLabel>{q.options.length > 0 && <Picker label={q.text} value={q.options.includes(answers[q.id]) ? answers[q.id] : ''} disabled={!pending} onChange={answer => setAnswers(old => ({ ...old, [q.id]: answer }))} options={[{ value: '', label: t('yourAnswer') }, ...q.options.map(option => ({ value: option, label: option }))]} />}<Input id={`question-${q.id}`} type={q.secret ? 'password' : 'text'} value={answers[q.id] || ''} onChange={e => setAnswers(old => ({ ...old, [q.id]: e.target.value }))} disabled={!pending} placeholder={t('yourAnswer')} /></Field>)}</FieldGroup>
      {pending ? <Button disabled={sending || message.questions?.some(q => !answers[q.id]?.trim())} onClick={() => { setSending(true); void window.moose.request('respond', { sessionId: message.sessionId, messageId: message.id, answers }).catch(error => onError(String(error))).finally(() => setSending(false)); }}>{t('answer')}</Button> : <span className="request-state">{t(message.state === 'resolved' ? 'resolved' : 'expired')}</span>}</div>;
}
const TranscriptRow = memo(function TranscriptRow({ message, onError, onRewind, busy }: { message: MessageData; onError(error: string): void; onRewind(message: MessageData, edit: boolean): void; busy: boolean }) {
  const t = useI18n(); const [copied, setCopied] = useState(false);
  if (message.kind === 'error') return <Alert variant="destructive"><CircleAlert /><AlertDescription>{message.text}</AlertDescription></Alert>;
  if (message.kind === 'notice') return <Marker><MarkerContent>{message.text}</MarkerContent></Marker>;
  if (message.kind === 'question') return <Questions message={message} onError={onError} />;
  if (message.kind === 'approval') return <div className="request-surface"><div className="request-heading"><ShieldCheck size={16} /><span>{t('approval')}</span></div><strong>{message.title}</strong>{message.text && <pre>{message.text}</pre>}{message.state === 'pending' ? <div className="flex flex-wrap gap-2">{message.choices?.map(choice => <Button key={choice.id} variant={choice.id === 'decline' || choice.kind?.startsWith('reject') ? 'secondary' : 'default'} onClick={() => { void window.moose.request('respond', { sessionId: message.sessionId, messageId: message.id, choice: choice.id }).catch(error => onError(String(error))); }}>{choice.id === 'accept' ? t('allow') : choice.id === 'decline' ? t('deny') : choice.label}</Button>)}</div> : <span className="request-state">{t(message.state === 'resolved' ? 'resolved' : 'expired')}</span>}</div>;
  if (message.kind === 'tool' || message.kind === 'reasoning') return <details className="activity" data-state={message.state}><summary><ChevronRight className="activity-chevron" size={12} />{message.kind === 'tool' ? <Terminal size={14} /> : <Brain size={14} />}<span>{message.title || t(message.kind === 'tool' ? 'tool' : 'reasoning')}</span>{message.state === 'done' && <Check size={13} />}{message.state === 'running' && <span className="activity-dot" />}</summary><pre>{message.text || '…'}</pre></details>;
  return <Message className={`message-${message.kind}`} align={message.kind === 'user' ? 'end' : 'start'}><MessageContent className="message-body"><Bubble variant={message.kind === 'user' ? 'secondary' : 'ghost'} align={message.kind === 'user' ? 'end' : 'start'}><BubbleContent>{!!message.attachments?.length && <AttachmentList items={message.attachments} />}{message.kind === 'user' ? <div className="user-text">{message.text}</div> : <Markdown text={message.text || '…'} onError={onError} />}</BubbleContent></Bubble>{message.state !== 'running' && <div className="message-actions"><IconButton size="icon-xs" label={copied ? '✓' : t('copy')} onClick={() => { void window.moose.request('copyText', { text: message.text }).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(error => onError(String(error))); }}>{copied ? <Check /> : <Copy />}</IconButton>{message.kind === 'user' && <IconButton label={t('editMessage')} disabled={busy} onClick={() => onRewind(message, true)}><Pencil /></IconButton>}<IconButton label={t('rewind')} disabled={busy} onClick={() => onRewind(message, false)}><History /></IconButton></div>}</MessageContent></Message>;
});
export function Transcript({ session, onError, onRewind }: { session: Session; onError(error: string): void; onRewind(message: MessageData, edit: boolean): void }) {
  const t = useI18n(), { messages, hasMore, loading, earlier } = useTranscript(session.id, onError);
  return <MessageScrollerProvider autoScroll defaultScrollPosition="end"><MessageScroller className="transcript"><MessageScrollerViewport><MessageScrollerContent className="transcript-content">
    {hasMore && <MessageScrollerItem messageId="load-earlier"><Button variant="ghost" size="sm" onClick={() => { void earlier(); }} disabled={loading}>{t('loadEarlier')}</Button></MessageScrollerItem>}
    {loading && !messages.length && <MessageScrollerItem messageId="loading"><div className="flex flex-col gap-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div></MessageScrollerItem>}
    {messages.map(message => <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.kind === 'user'}><TranscriptRow message={message} onError={onError} onRewind={onRewind} busy={['running', 'waiting', 'queued'].includes(session.status)} /></MessageScrollerItem>)}
    {['running', 'waiting'].includes(session.status) && <MessageScrollerItem messageId="working"><div className="working-status" role="status"><span className="activity-dot" /><span className={session.status === 'running' ? 'shimmer' : ''}>{t(session.status === 'waiting' ? 'waiting' : 'thinking')}</span></div></MessageScrollerItem>}
  </MessageScrollerContent></MessageScrollerViewport><MessageScrollerButton aria-label={t('latest')} /></MessageScroller></MessageScrollerProvider>;
}
