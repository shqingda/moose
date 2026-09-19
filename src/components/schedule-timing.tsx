import { useId } from 'react';
import { useI18n } from '../lib/i18n';
import { Picker } from './common';
import { Field, FieldGroup, FieldLabel, FieldSet, FieldLegend } from './ui/field';
import { Input } from './ui/input';
export type ScheduleFrequency = 'once' | 'interval' | 'daily' | 'weekly';
export interface TimingDraft {
  frequency: ScheduleFrequency;
  time: string;
  weekdays: number[];
  timezone: string;
}
export function ScheduleTiming({
  value,
  onChange,
  disabled,
}: {
  value: TimingDraft;
  onChange(value: TimingDraft): void;
  disabled: boolean;
}) {
  const t = useI18n(),
    prefix = useId();
  const calendar = value.frequency === 'daily' || value.frequency === 'weekly';
  return (
    <FieldGroup>
      <Field>
        <FieldLabel>{t('bgFrequency')}</FieldLabel>
        <Picker
          label={t('bgFrequency')}
          value={value.frequency}
          disabled={disabled}
          options={(['once', 'interval', 'daily', 'weekly'] as const).map((frequency) => ({
            value: frequency,
            label: t(`bgFrequency_${frequency}`),
          }))}
          onChange={(frequency) =>
            onChange({ ...value, frequency: frequency as ScheduleFrequency })
          }
        />
      </Field>
      {calendar && (
        <>
          {value.frequency === 'weekly' && (
            <FieldSet>
              <FieldLegend>{t('bgWeekdays')}</FieldLegend>
              <div className="schedule-weekdays">
                {([1, 2, 3, 4, 5, 6, 7] as const).map((day) => (
                  <Field key={day} orientation="horizontal">
                    <input
                      id={`${prefix}-${day}`}
                      type="checkbox"
                      disabled={disabled}
                      checked={value.weekdays.includes(day)}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          weekdays: event.target.checked
                            ? [...value.weekdays, day].sort()
                            : value.weekdays.filter((d) => d !== day),
                        })
                      }
                    />
                    <FieldLabel htmlFor={`${prefix}-${day}`}>{t(`bgDay${day}`)}</FieldLabel>
                  </Field>
                ))}
              </div>
            </FieldSet>
          )}
          <div className="schedule-time-row">
            <Field>
              <FieldLabel htmlFor={prefix + '-time'}>{t('bgTime')}</FieldLabel>
              <Input
                id={prefix + '-time'}
                type="time"
                value={value.time}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, time: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={prefix + '-zone'}>{t('bgTimezone')}</FieldLabel>
              <Input
                id={prefix + '-zone'}
                list={prefix + '-zones'}
                value={value.timezone}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, timezone: e.target.value })}
              />
              <datalist id={prefix + '-zones'}>
                {['UTC', ...Intl.supportedValuesOf('timeZone')].map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
            </Field>
          </div>
          <p className="extension-note">{t('bgDstHint')}</p>
        </>
      )}
    </FieldGroup>
  );
}
