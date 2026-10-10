import { ChevronRight, FolderOpen } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from './ui/empty';
import verstaIcon from '../assets/brand/versta-icon.png';
/** 根据是否选择项目展示欢迎页，引导打开目录或填写任务输入。 */
export function Welcome({ projectName, onAdd }: { projectName?: string; onAdd(): void }) {
  const t = useI18n();
  return (
    <div className="welcome">
      <div className="welcome-symbol">
        <img src={verstaIcon} alt="" width={96} height={96} draggable={false} decoding="async" />
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
        <Button
          onClick={onAdd}
          variant="outline"
          className="welcome-project-entry"
          aria-label={t('addProject')}
        >
          <span className="welcome-project-icon" aria-hidden="true">
            <FolderOpen />
          </span>
          <span className="welcome-project-label">
            <span>{t('addProject')}</span>
            <span className="welcome-project-hint">{t('chooseProjectFolder')}</span>
          </span>
          <ChevronRight className="welcome-project-chevron" />
        </Button>
      )}
    </div>
  );
}
