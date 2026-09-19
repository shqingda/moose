import { memo, useState } from 'react';
import { Markdown } from './markdown';
import { PlanReview } from './plan-review';
import {
  Check,
  ChevronRight,
  Copy,
  Terminal,
  ShieldCheck,
  Brain,
  CircleAlert,
  Pencil,
} from 'lucide-react';
import type { Message as MessageData, Session } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import { useTranscript } from '../lib/workspace';
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from './ui/message-scroller';
import { Message, MessageContent } from './ui/message';
import { Bubble, BubbleContent } from './ui/bubble';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';
import { Field, FieldLabel, FieldGroup } from './ui/field';
import { Alert, AlertDescription } from './ui/alert';
import { Marker, MarkerContent } from './ui/marker';
import { Skeleton } from './ui/skeleton';
import { AttachmentList } from './attachments';
import { Picker, IconButton } from './common';
import { SubagentActivity } from './subagent-activity';

/** 展示代理提问并提交答案，由后台校验请求是否仍有效。 */
function Questions({ message, onError }: { message: MessageData; onError(error: string): void }) {
  const t = useI18n();
  const [answers, setAnswers] = useState<Record<string, string>>({}),
    [sending, setSending] = useState(false);
  const pending = message.state === 'pending';
  return (
    <div className="request-surface">
      <div className="request-heading">
        <ShieldCheck size={16} />
        <span>{message.title || t('pending')}</span>
      </div>
      <FieldGroup>
        {message.questions?.map((q) => (
          <Field key={q.id}>
            <FieldLabel htmlFor={`question-${q.id}`}>{q.text}</FieldLabel>
            {q.options.length > 0 && (
              <Picker
                label={q.text}
                value={q.options.includes(answers[q.id]) ? answers[q.id] : ''}
                disabled={!pending}
                onChange={(answer) => setAnswers((old) => ({ ...old, [q.id]: answer }))}
                options={[
                  { value: '', label: t('yourAnswer') },
                  ...q.options.map((option) => ({ value: option, label: option })),
                ]}
              />
            )}
            <Input
              id={`question-${q.id}`}
              type={q.secret ? 'password' : 'text'}
              value={answers[q.id] || ''}
              onChange={(e) => setAnswers((old) => ({ ...old, [q.id]: e.target.value }))}
              disabled={!pending}
              placeholder={t('yourAnswer')}
            />
          </Field>
        ))}
      </FieldGroup>
      {pending ? (
        <Button
          disabled={sending || message.questions?.some((q) => !answers[q.id]?.trim())}
          onClick={() => {
            setSending(true);
            void window.moose
              .request('respond', { sessionId: message.sessionId, messageId: message.id, answers })
              .catch((error) => onError(String(error)))
              .finally(() => setSending(false));
          }}
        >
          {t('answer')}
        </Button>
      ) : (
        <span className="request-state">
          {t(message.state === 'resolved' ? 'resolved' : 'expired')}
        </span>
      )}
    </div>
  );
}
/** 按消息类型展示正文、工具或审批；用户仅可编辑最新消息，AI 按整轮复制。 */
const TranscriptRow = memo(function TranscriptRow({
  message,
  onError,
  onEdit,
  busy,
  latestUser,
  lastAssistant,
}: {
  message: MessageData;
  onError(error: string): void;
  onEdit(message: MessageData, text: string): Promise<void>;
  busy: boolean;
  latestUser: boolean;
  lastAssistant: boolean;
}) {
  const t = useI18n();
  const [copied, setCopied] = useState(false),
    [editing, setEditing] = useState(false),
    [edited, setEdited] = useState(message.text),
    [sending, setSending] = useState(false);
  if (message.kind === 'plan')
    return <PlanReview message={message} busy={busy} onError={onError} />;
  if (message.kind === 'error')
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertDescription>{message.text}</AlertDescription>
      </Alert>
    );
  if (message.kind === 'notice')
    return (
      <Marker>
        <MarkerContent>{message.text}</MarkerContent>
      </Marker>
    );
  if (message.kind === 'question') return <Questions message={message} onError={onError} />;
  if (message.kind === 'approval')
    return (
      <div className="request-surface">
        <div className="request-heading">
          <ShieldCheck size={16} />
          <span>{t('approval')}</span>
        </div>
        <strong>{message.title}</strong>
        {message.text && <pre>{message.text}</pre>}
        {message.state === 'pending' ? (
          <div className="flex flex-wrap gap-2">
            {message.choices?.map((choice) => (
              <Button
                key={choice.id}
                variant={
                  choice.id === 'decline' || choice.kind?.startsWith('reject')
                    ? 'secondary'
                    : 'default'
                }
                onClick={() => {
                  void window.moose
                    .request('respond', {
                      sessionId: message.sessionId,
                      messageId: message.id,
                      choice: choice.id,
                    })
                    .catch((error) => onError(String(error)));
                }}
              >
                {choice.id === 'accept'
                  ? t('allow')
                  : choice.id === 'decline'
                    ? t('deny')
                    : choice.label}
              </Button>
            ))}
          </div>
        ) : (
          <span className="request-state">
            {t(message.state === 'resolved' ? 'resolved' : 'expired')}
          </span>
        )}
      </div>
    );
  if (message.delegation)
    return <SubagentActivity message={message} delegation={message.delegation} />;
  if (message.kind === 'reasoning' && !message.text.trim()) return null;
  if (message.kind === 'tool' || message.kind === 'reasoning')
    return (
      <details className="activity" data-state={message.state}>
        <summary>
          <ChevronRight className="activity-chevron" size={12} />
          {message.kind === 'tool' ? <Terminal size={14} /> : <Brain size={14} />}
          <span>{message.title || t(message.kind === 'tool' ? 'tool' : 'reasoning')}</span>
          {message.state === 'done' && <Check size={13} />}
          {message.state === 'running' && <span className="activity-dot" />}
        </summary>
        <pre>{message.text || '…'}</pre>
      </details>
    );
  if (editing)
    return (
      <div className="message-inline-edit">
        {!!message.attachments?.length && <AttachmentList items={message.attachments} />}
        <Textarea
          autoFocus
          aria-label={t('editMessage')}
          value={edited}
          disabled={sending}
          onChange={(e) => setEdited(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.nativeEvent.isComposing && !sending) setEditing(false);
          }}
        />
        <div className="inline-edit-actions">
          <Button variant="secondary" disabled={sending} onClick={() => setEditing(false)}>
            {t('cancel')}
          </Button>
          <Button
            disabled={sending || busy || (!edited.trim() && !message.attachments?.length)}
            onClick={() => {
              setSending(true);
              void onEdit(message, edited)
                .then(() => setEditing(false))
                .catch((error) => onError(String(error)))
                .finally(() => setSending(false));
            }}
          >
            {t('send')}
          </Button>
        </div>
      </div>
    );
  return (
    <Message
      className={`message-${message.kind}`}
      align={message.kind === 'user' ? 'end' : 'start'}
    >
      <MessageContent className="message-body">
        <Bubble
          variant={message.kind === 'user' ? 'secondary' : 'ghost'}
          align={message.kind === 'user' ? 'end' : 'start'}
        >
          <BubbleContent>
            {!!message.attachments?.length && <AttachmentList items={message.attachments} />}
            {message.kind === 'user' ? (
              <div>
                <div className="user-text">{message.text}</div>
                {message.delivery && (
                  <small role="status">
                    {t(
                      message.delivery.status === 'accepted'
                        ? 'steerAccepted'
                        : message.delivery.status === 'rejected'
                          ? 'steerRejected'
                          : message.delivery.status === 'sending' && message.state === 'pending'
                            ? 'steerSending'
                            : 'steerUnknown',
                    )}
                    {message.delivery.error && ` · ${message.delivery.error}`}
                  </small>
                )}
              </div>
            ) : (
              <Markdown text={message.text || '…'} onError={onError} />
            )}
          </BubbleContent>
        </Bubble>
        {message.state !== 'running' && (message.kind === 'user' || lastAssistant) && (
          <div className="message-actions">
            <IconButton
              size="icon-xs"
              label={copied ? '✓' : t('copy')}
              onClick={() => {
                void (async () => {
                  const text =
                    message.kind === 'assistant'
                      ? await window.moose.request('responseText', {
                          sessionId: message.sessionId,
                          runId: message.runId,
                        })
                      : message.text;
                  await window.moose.request('copyText', { text });
                })()
                  .then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  })
                  .catch((error) => onError(String(error)));
              }}
            >
              {copied ? <Check /> : <Copy />}
            </IconButton>
            {message.kind === 'user' && latestUser && !message.delivery && (
              <IconButton
                label={t('editMessage')}
                disabled={busy}
                onClick={() => {
                  setEdited(message.text);
                  setEditing(true);
                }}
              >
                <Pencil />
              </IconButton>
            )}
            <time className="message-time" dateTime={new Date(message.createdAt).toISOString()}>
              {new Intl.DateTimeFormat('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              }).format(message.createdAt)}
            </time>
          </div>
        )}
      </MessageContent>
    </Message>
  );
});
/** 管理历史分页、阅读位置与最新消息跟随，避免流式输出打断上翻阅读。 */
export function Transcript({
  session,
  onError,
  onEdit,
}: {
  session: Session;
  onError(error: string): void;
  onEdit(message: MessageData, text: string): Promise<void>;
}) {
  const t = useI18n(),
    { messages, hasMore, loading, earlier } = useTranscript(session.id, onError);
  const latestUser = messages.findLast((m) => m.kind === 'user')?.id;
  const lastAssistants = new Map(
    messages.filter((m) => m.kind === 'assistant').map((m) => [m.runId, m.id]),
  );
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="transcript">
        <MessageScrollerViewport>
          <MessageScrollerContent className="transcript-content">
            {hasMore && (
              <MessageScrollerItem messageId="load-earlier">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void earlier();
                  }}
                  disabled={loading}
                >
                  {t('loadEarlier')}
                </Button>
              </MessageScrollerItem>
            )}
            {loading && !messages.length && (
              <MessageScrollerItem messageId="loading">
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </MessageScrollerItem>
            )}
            {messages
              .filter((message) => message.kind !== 'reasoning' || message.text.trim())
              .map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.kind === 'user'}
                >
                  <TranscriptRow
                    message={message}
                    latestUser={message.id === latestUser}
                    lastAssistant={lastAssistants.get(message.runId) === message.id}
                    onError={onError}
                    onEdit={onEdit}
                    busy={
                      session.archived || ['running', 'waiting', 'queued'].includes(session.status)
                    }
                  />
                </MessageScrollerItem>
              ))}
            {['running', 'waiting'].includes(session.status) && (
              <MessageScrollerItem messageId="working">
                <div className="working-status" role="status">
                  <span className="activity-dot" />
                  <span className={session.status === 'running' ? 'shimmer' : ''}>
                    {t(session.status === 'waiting' ? 'waiting' : 'thinking')}
                  </span>
                </div>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label={t('latest')} />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
