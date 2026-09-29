import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { FileReference, FilePreview } from '../../shared/experience';
import { fault } from '../../shared/errors';
import { useI18n } from '../lib/i18n';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { ErrorNotice } from './error-notice';
const FilesContext = createContext<{
  open(ref: FileReference): void;
  scope?: { projectId: string; sessionId?: string };
}>({ open() {} });
export const useFiles = () => useContext(FilesContext);
export function FilePreviewProvider({
  scope,
  children,
}: {
  scope?: { projectId: string; sessionId?: string };
  children: ReactNode;
}) {
  const trigger = useRef<HTMLElement | null>(null);
  const t = useI18n(),
    [reference, setReference] = useState<FileReference>(),
    [data, setData] = useState<FilePreview>(),
    [error, setError] = useState<ReturnType<typeof fault>>(),
    [attempt, setAttempt] = useState(0),
    [zoom, setZoom] = useState(1),
    [saving, setSaving] = useState(false),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    setData(undefined);
    setError(undefined);
    setZoom(1);
    setCopied(false);
    if (reference)
      void window.moose
        .request('filePreview', reference)
        .then((value) => {
          if (live) setData(value);
        })
        .catch((e) => {
          if (live) setError(fault(e));
        });
    return () => {
      live = false;
    };
  }, [reference, attempt]);
  return (
    <FilesContext
      value={{
        open: (ref) => {
          trigger.current = document.activeElement as HTMLElement;
          setReference(ref);
        },
        scope,
      }}
    >
      {children}
      <Dialog
        open={!!reference}
        onOpenChange={(open) => {
          if (!open) setReference(undefined);
        }}
      >
        <DialogContent className="file-preview-dialog" finalFocus={trigger}>
          <DialogHeader>
            <DialogTitle>{data?.name || t('preview')}</DialogTitle>
          </DialogHeader>
          {error && <ErrorNotice value={error} onReconnect={() => setAttempt((v) => v + 1)} />}{' '}
          {error && <Button onClick={() => setAttempt((v) => v + 1)}>{t('tryAgain')}</Button>}
          {!data && !error && <p role="status">{t('loading')}</p>}
          {data && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={saving}
                  onClick={() => {
                    if (!reference) return;
                    setSaving(true);
                    void window.moose
                      .request('fileDownload', reference)
                      .catch((e) => setError(fault(e)))
                      .finally(() => setSaving(false));
                  }}
                >
                  {t('download')}
                </Button>
                {data.kind === 'text' && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void window.moose
                        .request('copyText', { text: data.content || '' })
                        .then(() => setCopied(true))
                        .catch((e) => setError(fault(e)))
                    }
                  >
                    {t(copied ? 'copied' : 'copyFileText')}
                  </Button>
                )}
                {data.kind === 'image' && (
                  <>
                    <Button
                      variant="secondary"
                      disabled={zoom <= 0.5}
                      onClick={() => setZoom((v) => Math.max(0.5, v - 0.25))}
                    >
                      {t('zoomOut')}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={zoom >= 4}
                      onClick={() => setZoom((v) => Math.min(4, v + 0.25))}
                    >
                      {t('zoomIn')}
                    </Button>
                    <Button variant="ghost" onClick={() => setZoom(1)}>
                      {t('resetZoom')}
                    </Button>
                  </>
                )}
              </div>
              {data.kind === 'image' ? (
                <div className="file-preview-image">
                  <img
                    src={data.content}
                    alt={data.name}
                    onError={() => setError(fault(new Error(t('previewFailed'))))}
                    style={{ width: `${zoom * 100}%`, maxWidth: 'none' }}
                  />
                </div>
              ) : data.kind === 'text' ? (
                <pre className="file-preview-text">
                  <code>{data.content}</code>
                </pre>
              ) : (
                <p>{t('previewUnsupported')}</p>
              )}
              {data.truncated && <p role="status">{t('previewTruncated')}</p>}
            </>
          )}
        </DialogContent>
      </Dialog>
    </FilesContext>
  );
}
export function LocalImage({ path, alt }: { path: string; alt?: string }) {
  const { scope, open } = useFiles(),
    t = useI18n(),
    [data, setData] = useState<FilePreview>(),
    [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setData(undefined);
    setFailed(false);
    if (scope)
      void window.moose
        .request('filePreview', { ...scope, path })
        .then((value) => {
          if (live) {
            setData(value);
            setFailed(value.kind !== 'image');
          }
        })
        .catch(() => {
          if (live) setFailed(true);
        });
    return () => {
      live = false;
    };
  }, [scope?.projectId, scope?.sessionId, path, attempt]);
  if (!scope) return <span>{alt || path}</span>;
  return (
    <span className="local-image">
      {data?.kind === 'image' && !failed ? (
        <button
          aria-label={`${t('preview')} ${alt || path}`}
          onClick={() => open({ ...scope, path })}
        >
          <img src={data.content} alt={alt || path} onError={() => setFailed(true)} />
        </button>
      ) : failed ? (
        <button onClick={() => setAttempt((v) => v + 1)}>
          {t('previewFailed')} · {t('tryAgain')}
        </button>
      ) : (
        <span>{alt || t('loading')}</span>
      )}
    </span>
  );
}
