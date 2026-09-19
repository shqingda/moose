import { useId, useState } from 'react';
import type { BackgroundScope, Schedule, ScheduledTask } from '../../shared/background';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Field, FieldGroup, FieldLabel } from './ui/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from './ui/select';
import { Alert, AlertDescription } from './ui/alert';
function localStart(time = Date.now() + 300000) {
  const date = new Date(time);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}
export function ScheduleForm({
  scope,
  cwd,
  initial,
  onSaved,
  onCancel,
}: {
  scope: BackgroundScope;
  cwd: string;
  initial?: Schedule;
  onSaved: () => Promise<void>;
  onCancel?: () => void;
}) {
  const t = useI18n(),
    prefix = useId(),
    [name, setName] = useState(initial?.name ?? ''),
    [kind, setKind] = useState<ScheduledTask['kind']>(
      initial?.task.kind ?? (scope.sessionId ? 'agent' : 'command'),
    ),
    [text, setText] = useState(initial?.task.text ?? ''),
    [start, setStart] = useState(() => localStart(initial?.nextAt)),
    [interval, setInterval] = useState(String((initial?.intervalMs ?? 0) / 60000)),
    [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [requestId, setRequestId] = useState(crypto.randomUUID());
  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const definition = {
    name,
    task: { kind, text },
    timezone: initial?.timezone ?? localTimezone,
    startAt:
      initial && start === localStart(initial.nextAt) ? initial.nextAt : new Date(start).getTime(),
    intervalMs: Number(interval) === 0 ? null : Number(interval) * 60000,
  };
  function changed() {
    setPreview(false);
    setRequestId(crypto.randomUUID());
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      if (initial)
        await window.moose.request('scheduleUpdate', {
          id: initial.id,
          version: initial.version,
          ...definition,
        });
      else await window.moose.request('scheduleCreate', { ...scope, requestId, ...definition });
      setPreview(false);
      setName('');
      setText('');
      setRequestId(crypto.randomUUID());
      await onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <FieldGroup>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <p>{t(initial ? 'bgEditHint' : 'bgScheduleHint')}</p>
      <p className="break-all">{cwd}</p>
      <Field>
        <FieldLabel htmlFor={prefix + '-name'}>{t('bgName')}</FieldLabel>
        <Input
          id={prefix + '-name'}
          disabled={busy}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            changed();
          }}
        />
      </Field>
      <Field>
        <FieldLabel>{t('bgKind')}</FieldLabel>
        <Select
          value={kind}
          disabled={busy}
          onValueChange={(v) => {
            if (v === 'agent' || v === 'command') {
              setKind(v);
              changed();
            }
          }}
        >
          <SelectTrigger aria-label={t('bgKind')}>
            <SelectValue>{t(kind === 'agent' ? 'bgAgent' : 'bgCommand')}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="agent" disabled={!scope.sessionId}>
                {t('bgAgent')}
              </SelectItem>
              <SelectItem value="command">{t('bgCommand')}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor={prefix + '-text'}>{t('bgTask')}</FieldLabel>
        <Textarea
          id={prefix + '-text'}
          disabled={busy}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            changed();
          }}
        />
      </Field>
      <div className="flex gap-3">
        <Field>
          <FieldLabel htmlFor={prefix + '-start'}>
            {t(initial ? 'bgNext' : 'bgStart')} ({localTimezone})
          </FieldLabel>
          <Input
            id={prefix + '-start'}
            type="datetime-local"
            step="1"
            disabled={busy}
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              changed();
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={prefix + '-interval'}>{t('bgInterval')}</FieldLabel>
          <Input
            id={prefix + '-interval'}
            type="number"
            min="0"
            max="525600"
            disabled={busy}
            value={interval}
            onChange={(e) => {
              setInterval(e.target.value);
              changed();
            }}
          />
        </Field>
      </div>
      <Button
        variant="outline"
        disabled={
          busy ||
          !name.trim() ||
          !text.trim() ||
          !Number.isFinite(definition.startAt) ||
          !Number.isFinite(Number(interval)) ||
          Number(interval) < 0
        }
        onClick={() => setPreview(true)}
      >
        {t('bgPreview')}
      </Button>
      {onCancel && (
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </Button>
      )}
      {preview && (
        <Alert>
          <AlertDescription>
            {initial && <p>{t('bgEditHint')}</p>}
            <p className="break-all">{cwd}</p>
            <p>
              {name} · {t(kind === 'agent' ? 'bgAgent' : 'bgCommand')} ·{' '}
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: 'short',
                timeStyle: 'medium',
                timeZone: definition.timezone,
              }).format(definition.startAt)}{' '}
              ({definition.timezone}) · {interval} min
            </p>
            <p className="whitespace-pre-wrap break-all">{text}</p>
            <Button disabled={busy} onClick={save}>
              {t(initial ? 'bgSave' : 'bgCreate')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </FieldGroup>
  );
}
