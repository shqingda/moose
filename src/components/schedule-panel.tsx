import { useState } from 'react';
import {
  scheduleFinished,
  schedulePending,
  type BackgroundScope,
  type Schedule,
} from '../../shared/background';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { ScheduleForm } from './schedule-form';

export function SchedulePanel({
  scope,
  cwd,
  schedules,
  onChanged,
}: {
  scope: BackgroundScope;
  cwd: string;
  schedules: Schedule[];
  onChanged: () => Promise<void>;
}) {
  const t = useI18n(),
    [editing, setEditing] = useState<Schedule>(),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function toggle(schedule: Schedule) {
    setBusy(true);
    setError('');
    try {
      await window.moose.request('scheduleSet', {
        id: schedule.id,
        version: schedule.version,
        enabled: !schedule.enabled,
      });
      await onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="outline" disabled={!!editing} onClick={() => setCreating(!creating)}>
        {t(creating ? 'cancel' : 'bgNewSchedule')}
      </Button>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!editing && creating && (
        <ScheduleForm
          scope={scope}
          cwd={cwd}
          onSaved={async () => {
            setCreating(false);
            await onChanged();
          }}
        />
      )}
      {schedules.map((schedule) => (
        <section
          key={schedule.id}
          aria-label={schedule.name}
          className="flex flex-col gap-2 rounded-md border p-3"
        >
          <p>
            {schedule.name} · {schedule.enabled ? t('bgEnabled') : t('bgPaused')} ·{' '}
            {t(schedule.task.kind === 'agent' ? 'bgAgent' : 'bgCommand')}
          </p>
          <p className="whitespace-pre-wrap break-all">{schedule.task.text}</p>
          <p className="text-xs break-all">{schedule.cwd}</p>
          <p>
            {t('bgNext')}:{' '}
            {scheduleFinished(schedule)
              ? '—'
              : new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'short',
                  timeStyle: 'medium',
                  timeZone: schedule.timezone,
                }).format(schedule.nextAt)}{' '}
            ({schedule.timezone})
          </p>
          {schedule.calendar && (
            <p className="text-sm text-muted-foreground">
              {schedule.calendar.weekdays.length === 7
                ? t('bgFrequency_daily')
                : schedule.calendar.weekdays.map((day) => t(`bgDay${day}` as 'bgDay1')).join(' · ')}
              {' · '}
              {String(schedule.calendar.hour).padStart(2, '0')}:
              {String(schedule.calendar.minute).padStart(2, '0')}
            </p>
          )}
          {schedule.last && (
            <p>
              {t('bgLast')}: {schedule.last.status} {schedule.last.error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={busy || !!editing || (!schedule.enabled && scheduleFinished(schedule))}
              onClick={() => void toggle(schedule)}
            >
              {schedule.enabled ? t('bgPause') : t('bgResume')}
            </Button>
            <Button
              variant="outline"
              disabled={
                busy ||
                !!editing ||
                schedule.enabled ||
                schedulePending(schedule) ||
                scheduleFinished(schedule)
              }
              onClick={() => {
                setCreating(false);
                setEditing(schedule);
              }}
            >
              {t('bgEdit')}
            </Button>
          </div>
          {editing?.id === schedule.id && (
            <ScheduleForm
              key={editing.id}
              scope={{ projectId: editing.projectId, sessionId: editing.sessionId }}
              cwd={editing.cwd}
              initial={editing}
              onCancel={() => setEditing(undefined)}
              onSaved={async () => {
                setEditing(undefined);
                await onChanged();
              }}
            />
          )}
        </section>
      ))}
      {!!schedules.length && (
        <details className="extension-details">
          <summary>{t('bgEdit')}</summary>
          <p className="extension-note">{t('bgEditAvailability')}</p>
        </details>
      )}
    </>
  );
}
