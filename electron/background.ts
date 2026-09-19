import { TerminalSessions } from './terminal-sessions';
import type { Store } from './db/store';
import { BackgroundStore } from './background-store';
import { CommandJobs } from './command-jobs';
import { Schedules, type ScheduleHooks } from './schedules';
import type { BackgroundRequests } from '../shared/background';
type Method = keyof BackgroundRequests;
type Command = { [K in Method]: { method: K; args: BackgroundRequests[K] } }[Method];
export const isBackgroundMethod = (method: string): method is Method =>
  [
    'terminalList',
    'terminalStart',
    'terminalRead',
    'terminalInput',
    'terminalResize',
    'terminalStop',
    'commandList',
    'commandRead',
    'commandStart',
    'commandInput',
    'commandStop',
    'scheduleList',
    'scheduleCreate',
    'scheduleUpdate',
    'scheduleSet',
  ].includes(method);
export class Background {
  readonly commands: CommandJobs;
  readonly terminals: TerminalSessions;
  readonly schedules: Schedules;
  constructor(
    private store: Store,
    hooks: ScheduleHooks & { lock(cwd: string): () => void },
  ) {
    const records = new BackgroundStore(store);
    this.terminals = new TerminalSessions(store, hooks.lock);
    this.commands = new CommandJobs(records, hooks.lock);
    this.schedules = new Schedules(records, this.commands, hooks);
  }
  async handle(method: Method, args: unknown) {
    return this.dispatch({ method, args } as Command);
  }
  private async dispatch(command: Command) {
    switch (command.method) {
      case 'terminalList':
        return this.terminals.list(command.args.projectId);
      case 'terminalStart':
        return this.terminals.start(command.args);
      case 'terminalRead':
        return this.terminals.read(command.args);
      case 'terminalInput':
        this.terminals.input(command.args);
        return null;
      case 'terminalResize':
        this.terminals.resize(command.args);
        return null;
      case 'terminalStop':
        await this.terminals.stop(command.args.id);
        return null;
      case 'commandList':
        this.store.project(command.args.projectId);
        return this.commands.list(command.args.projectId);
      case 'commandRead':
        return this.commands.read(command.args.id);
      case 'commandStart':
        return this.commands.start(command.args);
      case 'commandInput':
        await this.commands.input(command.args);
        return null;
      case 'commandStop':
        await this.commands.stop(command.args.id);
        return null;
      case 'scheduleList':
        this.store.project(command.args.projectId);
        return this.schedules.list(command.args.projectId);
      case 'scheduleCreate':
        return this.schedules.create(command.args);
      case 'scheduleUpdate':
        return this.schedules.update(command.args);
      case 'scheduleSet':
        return this.schedules.set(command.args);
    }
  }
  async close() {
    this.schedules.close();
    await Promise.all([this.commands.close(), this.terminals.close()]);
    this.schedules.reconcileCommands();
  }
}
