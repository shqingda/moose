import type { Store } from './db/store';
import { BackgroundStore } from './background-store';
import { CommandJobs } from './command-jobs';
import { Schedules, type ScheduleHooks } from './schedules';
import type { BackgroundRequests } from '../shared/background';
type Method = keyof BackgroundRequests;
type Command = { [K in Method]: { method: K; args: BackgroundRequests[K] } }[Method];
export const isBackgroundMethod = (method: string): method is Method =>
  [
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
  readonly schedules: Schedules;
  constructor(
    private store: Store,
    hooks: ScheduleHooks & { lock(cwd: string): () => void },
  ) {
    const records = new BackgroundStore(store);
    this.commands = new CommandJobs(records, hooks.lock);
    this.schedules = new Schedules(records, this.commands, hooks);
  }
  async handle(method: Method, args: unknown) {
    return this.dispatch({ method, args } as Command);
  }
  private async dispatch(command: Command) {
    switch (command.method) {
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
    await this.commands.close();
    this.schedules.reconcileCommands();
  }
}
