import { ArrowUpRight, FolderOpen, ScanSearch, Wrench, Blocks } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from './ui/empty';
import { MooseMark } from './common';
export function Welcome({ projectName, onAdd, onPrompt }: { projectName?: string; onAdd(): void; onPrompt(text: string): void }) {
  const t = useI18n();
  return <div className="welcome"><div className="welcome-symbol"><MooseMark /></div><Empty className="welcome-copy"><EmptyHeader><EmptyTitle className="welcome-title">{t(projectName ? 'startHint' : 'greeting')}</EmptyTitle><EmptyDescription className="welcome-description">{t(projectName ? 'intro' : 'openHint')}</EmptyDescription></EmptyHeader></Empty>
    {projectName ? <div className="suggestions">{([{ icon: Blocks, title: 'buildTogether', prompt: 'buildPrompt' }, { icon: ScanSearch, title: 'explore', prompt: 'explorePrompt' }, { icon: Wrench, title: 'improve', prompt: 'improvePrompt' }] as const).map(({ icon: Icon, title, prompt }) => <button className="suggestion" key={title} onClick={() => onPrompt(t(prompt))}><Icon size={17} /><span>{t(title)}</span><ArrowUpRight size={13} /></button>)}</div> : <Button onClick={onAdd} size="lg"><FolderOpen data-icon="inline-start" />{t('addProject')}</Button>}
    <p className="welcome-footnote">{t('localNote')}</p>
  </div>;
}
