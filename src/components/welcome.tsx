import { FolderOpen } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from './ui/empty';
import { MooseMark } from './common';
/** 根据是否选择项目展示欢迎页，引导打开目录或填写任务输入。 */
export function Welcome({ projectName, onAdd }: { projectName?: string; onAdd(): void }) {
  const t = useI18n();
  return (
    <div className="welcome">
      <div className="welcome-symbol">
        <MooseMark />
      </div>
      <Empty className="welcome-copy">
        <EmptyHeader>
          <EmptyTitle className="welcome-title">
            {t(projectName ? 'startHint' : 'greeting')}
          </EmptyTitle>
          {!projectName && (
            <EmptyDescription className="welcome-description">{t('openHint')}</EmptyDescription>
          )}
        </EmptyHeader>
      </Empty>
      {!projectName && (
        <Button onClick={onAdd} size="lg">
          <FolderOpen data-icon="inline-start" />
          {t('addProject')}
        </Button>
      )}
    </div>
  );
}
