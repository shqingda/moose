import { useState } from 'react';
import type { Message } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Field, FieldLabel } from './ui/field';
import { Markdown } from './markdown';

export function PlanReview({
  message,
  busy,
  onError,
}: {
  message: Message;
  busy: boolean;
  onError(error: string): void;
}) {
  const t = useI18n();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.text);
  const [sending, setSending] = useState(false);
  const ready = !busy && message.state === 'done' && !!message.plan && !message.plan.queueId;
  const act = async (approve: boolean) => {
    setSending(true);
    try {
      const args = {
        sessionId: message.sessionId,
        messageId: message.id,
        version: message.plan!.version,
      };
      if (approve) await window.moose.request('approvePlan', args);
      else await window.moose.request('editPlan', { ...args, text });
      setEditing(false);
    } catch (error) {
      onError(String(error));
    } finally {
      setSending(false);
    }
  };
  return (
    <section className="request-surface" aria-label={t('planReview')}>
      <div className="request-heading">
        {t('planReview')} · v{message.plan?.version || 1}
      </div>
      {editing ? (
        <Field>
          <FieldLabel htmlFor={`plan-${message.id}`}>{t('planText')}</FieldLabel>
          <Textarea
            id={`plan-${message.id}`}
            value={text}
            disabled={sending}
            onChange={(e) => setText(e.target.value)}
            className="min-h-48"
          />
        </Field>
      ) : (
        <Markdown text={message.text || '…'} onError={onError} />
      )}
      {message.plan?.queueId ? (
        <span>{t('planApproved')}</span>
      ) : (
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button disabled={!ready || sending || !text.trim()} onClick={() => void act(false)}>
                {t('save')}
              </Button>
              <Button variant="ghost" disabled={sending} onClick={() => setEditing(false)}>
                {t('cancel')}
              </Button>
            </>
          ) : (
            <>
              <Button
                disabled={!ready || sending || !message.text.trim()}
                onClick={() => void act(true)}
              >
                {t('approvePlan')}
              </Button>
              <Button
                variant="secondary"
                disabled={!ready || sending}
                onClick={() => {
                  setText(message.text);
                  setEditing(true);
                }}
              >
                {t('editPlan')}
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
