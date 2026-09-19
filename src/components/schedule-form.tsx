import { calendarPreview } from '../../shared/calendar';
import { ScheduleTiming, type TimingDraft } from './schedule-timing';
import { useEffect, useId, useRef, useState } from 'react';
import type {
  BackgroundScope,
  Schedule,
  ScheduledTask,
  ScheduleDefinition,
} from '../../shared/background';
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
    [timing, setTiming] = useState<TimingDraft>({
      frequency: initial?.calendar
        ? initial.calendar.weekdays.length === 7
          ? 'daily'
          : 'weekly'
        : initial?.intervalMs
          ? 'interval'
          : 'once',
      time: initial?.calendar
        ? `${String(initial.calendar.hour).padStart(2, '0')}:${String(initial.calendar.minute).padStart(2, '0')}`
        : '09:00',
      weekdays: initial?.calendar?.weekdays || [1, 2, 3, 4, 5],
      timezone: initial?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    [preview, setPreview] = useState<ScheduleDefinition>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [requestId, setRequestId] = useState(crypto.randomUUID());
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (preview) {
      previewRef.current?.focus({ preventScroll: true });
      previewRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [preview]);
  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const isCalendar = timing.frequency === 'daily' || timing.frequency === 'weekly';
  const [hour, minute] = timing.time.split(':').map(Number);
  const calendar = isCalendar
    ? {
        weekdays: timing.frequency === 'daily' ? [1, 2, 3, 4, 5, 6, 7] : timing.weekdays,
        hour,
        minute,
      }
    : null;
  let times: number[] = [];
  try {
    if (calendar) times = calendarPreview(calendar, timing.timezone, Date.now() + 1000);
  } catch {
    /* Invalid input is shown below. */
  }
  const definition: ScheduleDefinition = {
    name,
    task: { kind, text },
    timezone: isCalendar ? timing.timezone : (initial?.timezone ?? localTimezone),
    calendar,
    startAt: isCalendar
      ? (times[0] ?? NaN)
      : initial && start === localStart(initial.nextAt)
        ? initial.nextAt
        : new Date(start).getTime(),
    intervalMs: timing.frequency === 'interval' ? Number(interval) * 60000 : null,
  };
  function changed() {
    setPreview(undefined);
    setRequestId(crypto.randomUUID());
  }
  async function save() {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      if (initial)
        await window.moose.request('scheduleUpdate', {
          id: initial.id,
          version: initial.version,
          ...preview,
        });
      else await window.moose.request('scheduleCreate', { ...scope, requestId, ...preview });
      setPreview(undefined);
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
      <ScheduleTiming
        value={timing}
        disabled={busy}
        onChange={(value) => {
          setTiming(value);
          if (value.frequency === 'interval' && !Number(interval)) setInterval('60');
          changed();
        }}
      />
      {isCalendar && !times.length && <p role="alert">{t('bgInvalidCalendar')}</p>}
      {!isCalendar && (
        <div className="schedule-time-row">
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
          {timing.frequency === 'interval' && (
            <Field>
              <FieldLabel htmlFor={prefix + '-interval'}>{t('bgInterval')}</FieldLabel>
              <Input
                id={prefix + '-interval'}
                type="number"
                min="1"
                max="525600"
                disabled={busy}
                value={interval}
                onChange={(e) => {
                  setInterval(e.target.value);
                  changed();
                }}
              />
            </Field>
          )}
        </div>
      )}
      <Button
        variant="outline"
        disabled={
          busy ||
          !name.trim() ||
          !text.trim() ||
          !Number.isFinite(definition.startAt) ||
          (timing.frequency === 'interval' &&
            (!Number.isInteger(Number(interval)) ||
              Number(interval) < 1 ||
              Number(interval) > 525600))
        }
        onClick={() => setPreview(definition)}
      >
        {t('bgPreview')}
      </Button>
      {onCancel && (
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </Button>
      )}
      {preview && (
        <Alert ref={previewRef} tabIndex={-1}>
          <AlertDescription>
            {initial && <p>{t('bgEditHint')}</p>}
            <p className="break-all">{cwd}</p>
            <p>
              {name} · {t(kind === 'agent' ? 'bgAgent' : 'bgCommand')} ·{' '}
              {!preview.calendar &&
                new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'short',
                  timeStyle: 'medium',
                  timeZone: preview.timezone,
                }).format(preview.startAt)}{' '}
              ({preview.timezone}){preview.intervalMs ? ` · ${preview.intervalMs / 60000} min` : ''}
            </p>
            {preview.calendar && (
              <>
                <p>{t('bgUpcoming')}</p>
                <ol className="schedule-occurrences">
                  {calendarPreview(preview.calendar, preview.timezone, preview.startAt).map(
                    (time) => (
                      <li key={time}>
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: 'full',
                          timeStyle: 'short',
                          timeZone: preview.timezone,
                        }).format(time)}
                      </li>
                    ),
                  )}
                </ol>
              </>
            )}
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
