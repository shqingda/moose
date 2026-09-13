import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Box, File, Folder, Lightbulb, Target } from 'lucide-react';
import type { ContextEntry, PromptContext, Provider } from '../../shared/types';
import { useI18n } from '../lib/i18n';
export function useSuggestions(projectId: string, provider: Provider, draft: string, onDraft: (text: string) => void, context: PromptContext, onContext: (value: PromptContext) => void, onError: (error: string) => void) {
  const t = useI18n(), [caret, setCaret] = useState(0), [dismissed, setDismissed] = useState(false), [entries, setEntries] = useState<ContextEntry[]>([]), [index, setIndex] = useState(0), [loading, setLoading] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const match = draft.slice(0, caret).match(/(?:^|\s)([@/])([^\s@]*)$/);
  const trigger = match?.[1], query = match?.[2] || '', open = !!match && !dismissed;
  useEffect(() => { setDismissed(false); setIndex(0); }, [draft, caret]);
  useEffect(() => {
    if (!open) return;
    let live = true; setLoading(true); setEntries([]);
    const timer = setTimeout(() => { const result = trigger === '@' ? window.moose.request('searchFiles', { projectId, query }) : window.moose.request('listSkills', { projectId });
      void result.then(items => { if (live) setEntries(trigger === '/' ? items.filter(item => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase())) : items); }).catch(error => { if (live) onError(String(error)); }).finally(() => { if (live) setLoading(false); });
    }, 60);
    return () => { live = false; clearTimeout(timer); };
  }, [projectId, trigger, query, open, onError]);
  useEffect(() => { if (!open) return; const dismiss = (event: PointerEvent) => { if (!(event.target instanceof Element) || (!event.target.closest('.context-menu') && event.target !== input.current)) setDismissed(true); }; document.addEventListener('pointerdown', dismiss); return () => document.removeEventListener('pointerdown', dismiss); }, [open]);
  const modes = trigger === '/' ? ([{ id: 'plan', name: t('planMode'), description: t('planDescription') }, { id: 'goal', name: t('goalMode'), description: t('goalDescription') }] as const).filter(item => `${item.id} ${item.name}`.toLowerCase().includes(query.toLowerCase())) : [];
  const rows = [...modes.map(item => ({ ...item, mode: item.id, kind: 'mode' as const, scope: '', path: '' })), ...entries.map(item => ({ ...item, mode: undefined }))];
  const choose = (at: number) => {
    const row = rows[at]; if (!row || !match) return;
    if (row.mode === 'plan' && provider !== 'codex') { onError(t('planUnavailable')); return; }
    const start = caret - query.length - 1;
    const insertion = row.kind === 'file' || row.kind === 'folder' ? `@${JSON.stringify(row.path)} ` : '';
    onDraft(draft.slice(0, start) + insertion + draft.slice(caret));
    onContext(row.mode ? { ...context, mode: row.mode } : row.kind === 'skill' ? { ...context, skills: [...new Set([...context.skills, row.id])] } : { ...context, references: [...new Set([...context.references, row.path])] });
    setDismissed(true);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(start + insertion.length, start + insertion.length); });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || event.nativeEvent.isComposing || event.keyCode === 229) return false;
    if (event.key === 'Escape') { event.preventDefault(); setDismissed(true); return true; }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setIndex(value => (value + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(rows.length, 1)) % Math.max(rows.length, 1)); return true; }
    if ((event.key === 'Enter' || event.key === 'Tab') && rows.length) { event.preventDefault(); choose(index); return true; }
    return false;
  };
  useEffect(() => { if (open) document.getElementById(`context-option-${index}`)?.scrollIntoView({ block: 'nearest' }); }, [index, open]);
  const menu = open && <div className="context-menu" role="listbox" id="context-suggestions" aria-label={trigger === '@' ? t('projectFiles') : t('commandsSkills')}>
    {rows.map((row, i) => <div key={row.id}>{(i === modes.length || (i > modes.length && row.scope !== rows[i - 1]?.scope)) && row.kind === 'skill' && <p>{t(row.scope === 'project' ? 'projectSkills' : 'globalSkills')}</p>}<button id={`context-option-${i}`} role="option" aria-selected={i === index} aria-disabled={row.mode === 'plan' && provider !== 'codex'} tabIndex={-1} onMouseDown={e => e.preventDefault()} onMouseEnter={() => setIndex(i)} onClick={() => choose(i)}>{row.mode === 'plan' ? <Lightbulb /> : row.mode === 'goal' ? <Target /> : row.kind === 'skill' ? <Box /> : row.kind === 'folder' ? <Folder /> : <File />}<strong>{row.name}</strong><small>{row.kind === 'file' || row.kind === 'folder' ? row.path : row.description}</small></button></div>)}
    {loading && <p>{t('loading')}</p>}{!loading && !rows.length && <p>{t('noContextResults')}</p>}
  </div>;
  return { input, menu, onKeyDown, setCaret, open, index };
}
