import { createPortal } from 'react-dom';
import { Picker } from './common';
import { TerminalPanel } from './terminal-panel';
import { useEffect, useState } from 'react';
import { Terminal, X } from 'lucide-react';
import type { BackgroundScope, CommandJob, Schedule } from '../../shared/background';
import { useI18n } from '../lib/i18n';
import { IconButton } from './common';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Field, FieldGroup, FieldLabel } from './ui/field';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { SchedulePanel } from './schedule-panel';
import { Alert, AlertDescription } from './ui/alert';
export type BackgroundPlacement = 'dialog' | 'bottom' | 'right';
export function BackgroundTools({
  scope,
  dockHost,
  onDockChange,
  reviewOpen,
}: {
  reviewOpen: boolean;
  scope: BackgroundScope;
  dockHost: HTMLDivElement | null;
  onDockChange(position: BackgroundPlacement | null): void;
}) {
  const t = useI18n(),
    [open, setOpen] = useState(false),
    [jobs, setJobs] = useState<Omit<CommandJob, 'output'>[]>([]),
    [schedules, setSchedules] = useState<Schedule[]>([]),
    [selected, setSelected] = useState(''),
    [job, setJob] = useState<CommandJob>(),
    [command, setCommand] = useState(''),
    [requestId, setRequestId] = useState(crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [input, setInput] = useState(''),
    [cwd, setCwd] = useState('');
  const [placement, setPlacement] = useState<BackgroundPlacement>(() => {
    const saved = localStorage.getItem('moose.terminalPlacement');
    return saved === 'bottom' || saved === 'right' ? saved : 'dialog';
  });
  useEffect(() => {
    if (open && reviewOpen && placement === 'right') setPlacement('bottom');
  }, [open, reviewOpen, placement]);
  const [tab, setTab] = useState('terminal');
  const [terminalId, setTerminalId] = useState('');
  useEffect(() => {
    onDockChange(open && placement !== 'dialog' ? placement : null);
  }, [open, placement, onDockChange]);
  useEffect(() => () => onDockChange(null), [onDockChange]);
  const read = () =>
    Promise.all([
      window.moose.request('commandList', scope),
      window.moose.request('scheduleList', scope),
      selected ? window.moose.request('commandRead', { id: selected }) : undefined,
      window.moose.request('workspacePath', scope),
    ]);
  function apply([next, timers, detail, path]: Awaited<ReturnType<typeof read>>) {
    setJobs(next);
    setSchedules(timers);
    setJob(detail);
    setCwd(path);
  }
  async function refresh() {
    apply(await read());
  }
  useEffect(() => {
    if (!open) return;
    let live = true,
      running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const result = await read();
        if (live) apply(result);
      } catch (e) {
        if (live) setError(String(e));
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 750);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [open, scope.projectId, selected]);
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function start() {
    void act(async () => {
      const created = await window.moose.request('commandStart', { ...scope, command, requestId });
      setSelected(created.id);
      setJob(created);
      setCommand('');
      setRequestId(crypto.randomUUID());
    });
  }
  const content = (
    <div className="background-content">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(String(value))}
        className="background-tabs"
      >
        <div className="background-bar">
          <TabsList variant="line" aria-label={t('bgTitle')}>
            <TabsTrigger value="terminal">{t('ptyTitle')}</TabsTrigger>
            <TabsTrigger value="commands">{t('bgTabCommands')}</TabsTrigger>
            <TabsTrigger value="schedules">{t('bgTabSchedules')}</TabsTrigger>
          </TabsList>
          <Picker
            label={t('bgPosition')}
            value={placement}
            options={(['dialog', 'bottom', 'right'] as const).map((value) => ({
              value,
              label: t(`bgPosition_${value}`),
            }))}
            onChange={(value) => {
              const next = value as BackgroundPlacement;
              setPlacement(next);
              localStorage.setItem('moose.terminalPlacement', next);
            }}
          />
          <IconButton label={t('close')} onClick={() => setOpen(false)}>
            <X />
          </IconButton>
        </div>
        <TabsContent value="terminal" className="background-terminal">
          <TerminalPanel scope={scope} selected={terminalId} onSelect={setTerminalId} />
        </TabsContent>
        <TabsContent value="commands" className="extension-section background-scroll">
          <p className="extension-note break-all">{cwd}</p>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="bg-command">{t('bgCommand')}</FieldLabel>
              <Textarea
                id="bg-command"
                disabled={busy}
                value={command}
                onChange={(e) => {
                  setCommand(e.target.value);
                  setRequestId(crypto.randomUUID());
                }}
                placeholder="pnpm test"
              />
            </Field>
            <Button disabled={busy || !command.trim()} onClick={start}>
              {t('bgRun')}
            </Button>
          </FieldGroup>
          <h3>{t('bgJobs')}</h3>
          {jobs.length === 0 && <p>{t('bgEmpty')}</p>}
          {jobs.map((row) => (
            <Button
              key={row.id}
              variant="outline"
              className="h-auto justify-start whitespace-normal text-left"
              onClick={() => {
                setSelected(row.id);
                setJob(undefined);
                setInput('');
              }}
            >
              {row.command.slice(0, 100)} · {row.status}
            </Button>
          ))}
          {job && (
            <section className="flex flex-col gap-2" aria-label={t('bgOutput')}>
              <p className="break-all">Moose · {job.cwd}</p>
              <p>
                {job.status} · {t('bgExit')}: {job.exitCode ?? '—'} {job.signal}
              </p>
              {job.truncated && <p>{t('bgTruncated')}</p>}
              <pre
                className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border p-3"
                data-testid="command-output"
              >
                {job.output}
              </pre>
              {job.status === 'running' && (
                <>
                  <Field>
                    <FieldLabel htmlFor="bg-input">{t('bgInput')}</FieldLabel>
                    <Input id="bg-input" value={input} onChange={(e) => setInput(e.target.value)} />
                  </Field>
                  <div className="flex gap-2">
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await window.moose.request('commandInput', {
                            id: job.id,
                            text: input + '\n',
                          });
                          setInput('');
                        })
                      }
                    >
                      {t('bgSend')}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          window.moose.request('commandInput', {
                            id: job.id,
                            text: '',
                            eof: true,
                          }),
                        )
                      }
                    >
                      {t('bgEof')}
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() =>
                        void act(() => window.moose.request('commandStop', { id: job.id }))
                      }
                    >
                      {t('bgStop')}
                    </Button>
                  </div>
                </>
              )}
            </section>
          )}
        </TabsContent>
        <TabsContent value="schedules" className="extension-section background-scroll">
          <SchedulePanel scope={scope} cwd={cwd} schedules={schedules} onChanged={refresh} />
        </TabsContent>
      </Tabs>
    </div>
  );
  return (
    <>
      <IconButton
        label={t('bgTitle')}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Terminal />
      </IconButton>
      {placement === 'dialog' ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="background-dialog" showCloseButton={false}>
            <DialogHeader className="sr-only">
              <DialogTitle>{t('bgTitle')}</DialogTitle>
              <DialogDescription>{t('bgHint')}</DialogDescription>
            </DialogHeader>
            {content}
          </DialogContent>
        </Dialog>
      ) : (
        open &&
        dockHost &&
        createPortal(
          <section className="background-docked" aria-label={t('bgTitle')}>
            {content}
          </section>,
          dockHost,
        )
      )}
    </>
  );
}
