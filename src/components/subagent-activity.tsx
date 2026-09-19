import { SubagentPanel } from './subagent-panel';
import { ChevronRight, Users } from 'lucide-react';
import type { Delegation, Message } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import { Badge } from './ui/badge';

const operationLabels = {
  spawn: 'agentSpawn',
  message: 'agentMessage',
  resume: 'agentResume',
  wait: 'agentWait',
  close: 'agentClose',
  interrupt: 'agentInterrupt',
  list: 'agentList',
  activity: 'agentActivity',
} as const;
const statusLabels = {
  pending: 'agentPending',
  running: 'agentRunning',
  completed: 'agentCompleted',
  interrupted: 'agentInterrupted',
  failed: 'agentFailed',
  closed: 'agentClosed',
  unknown: 'agentUnknown',
} as const;

/** 原生委派工具的状态与每个子任务的状态分开显示，历史记录可直接重放。 */
export function SubagentActivity({
  message,
  delegation,
}: {
  message: Message;
  delegation: Delegation;
}) {
  const t = useI18n();
  return (
    <details className="activity subagent-activity" data-state={message.state}>
      <summary>
        <ChevronRight className="activity-chevron" size={12} />
        <Users size={14} />
        <span>
          {t('subagents')} · {t(operationLabels[delegation.operation])}
        </span>
        {!!delegation.agents.length && (
          <Badge variant="secondary">{delegation.agents.length}</Badge>
        )}
        {message.state === 'running' && <span className="activity-dot" />}
        {message.state === 'error' && <Badge variant="destructive">{t('agentFailed')}</Badge>}
      </summary>
      <div className="flex flex-col gap-3 p-3">
        {message.title && <strong>{message.title}</strong>}
        {delegation.model && <span>{delegation.model}</span>}
        {message.text && <pre>{message.text}</pre>}
        {delegation.agents.map((agent) => (
          <div key={agent.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <code>{agent.id}</code>
              <SubagentPanel sessionId={message.sessionId} nativeId={agent.id} />
              <Badge variant={agent.status === 'failed' ? 'destructive' : 'outline'}>
                {t(statusLabels[agent.status])}
              </Badge>
            </div>
            {agent.message && <pre>{agent.message}</pre>}
          </div>
        ))}
      </div>
    </details>
  );
}
