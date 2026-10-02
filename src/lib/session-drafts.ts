import { useEffect, useRef, useState } from 'react';
import type { Attachment, Session } from '../../shared/types';
import type { useWorkspace } from './workspace';

/** Keep drafts independent of panel layout and retain unsaved input after failures. */
export function useSessionDrafts(
  session: Session | undefined,
  projectId: string | undefined,
  perform: ReturnType<typeof useWorkspace>['perform'],
) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [attachmentDrafts, setAttachmentDrafts] = useState<Record<string, Attachment[]>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<string, string>());
  const draftKey = session?.id || `new:${projectId || ''}`;
  const attachments = attachmentDrafts[draftKey] ?? session?.draftAttachments ?? [];
  const latest = useRef({ drafts, attachmentDrafts });
  latest.current = { drafts, attachmentDrafts };
  useEffect(() => {
    const drafts = pending.current;
    const saves = timers.current;
    const flush = () => {
      for (const [id, draft] of drafts) {
        clearTimeout(saves.get(id));
        saves.delete(id);
        void window.moose
          .request('updateSession', { id, draft })
          .then(() => {
            if (drafts.get(id) === draft) drafts.delete(id);
          })
          .catch(() => {});
      }
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', hidden);
      flush();
    };
  }, []);
  const onDraft = (draft: string) => {
    latest.current.drafts = { ...latest.current.drafts, [draftKey]: draft };
    setDrafts((old) => ({ ...old, [draftKey]: draft }));
    if (!session) return;
    const id = session.id;
    clearTimeout(timers.current.get(id));
    pending.current.set(id, draft);
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        void perform(async () => {
          const saved = await window.moose.request('updateSession', { id, draft });
          if (pending.current.get(id) === draft) pending.current.delete(id);
          return saved;
        });
      }, 250),
    );
  };
  const onAttachments = (items: Attachment[]) => {
    latest.current.attachmentDrafts = { ...latest.current.attachmentDrafts, [draftKey]: items };
    setAttachmentDrafts((old) => ({ ...old, [draftKey]: items }));
    if (session)
      void perform(() =>
        window.moose.request('updateSession', {
          id: session.id,
          draftAttachments: items.map((item) => item.id),
        }),
      );
  };
  const consumeDraft = (id: string, submitted: string, submittedAttachments: Attachment[]) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    pending.current.delete(id);
    const current = latest.current.drafts[draftKey] ?? session?.draft ?? '';
    const draft = current === submitted ? '' : current;
    const sent = new Set(submittedAttachments.map((item) => item.id));
    const remaining = (latest.current.attachmentDrafts[draftKey] ?? attachments).filter(
      (item) => !sent.has(item.id),
    );
    setDrafts((old) => ({ ...old, [draftKey]: '', [id]: draft }));
    setAttachmentDrafts((old) => ({ ...old, [draftKey]: [], [id]: remaining }));
    return { draft, draftAttachments: remaining.map((item) => item.id) };
  };
  return {
    draftKey,
    attachments,
    drafts,
    setDrafts,
    setAttachmentDrafts,
    onDraft,
    onAttachments,
    consumeDraft,
  };
}
