import { MooseError } from '../../shared/errors';
import { useFiles } from './file-preview';
import { useEffect, useState } from 'react';
import { File, X } from 'lucide-react';
import type { Attachment } from '../../shared/types';
import { IconButton } from './common';
import { useI18n } from '../lib/i18n';
/** 加载单个附件的图片预览，按需要提供移除入口。 */
function AttachmentItem({ item, onRemove }: { item: Attachment; onRemove?(): void }) {
  const files = useFiles();
  const isImage = item.mime.startsWith('image/');
  const [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  const t = useI18n(),
    [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setFailed(false);
    setImage(null);
    if (item.mime.startsWith('image/'))
      void window.moose
        .request('attachmentPreview', { id: item.id })
        .then((data) => {
          if (live) setImage(data);
        })
        .catch(() => {
          if (live) setFailed(true);
        });
    return () => {
      live = false;
    };
  }, [item.id, item.mime, attempt]);
  return (
    <div
      className={`attachment-chip${isImage ? ' attachment-image' : ''}`}
      data-hover-surface={isImage ? 'image' : ''}
    >
      <button
        className="attachment-preview-button"
        aria-label={`${t('preview')} ${item.name}`}
        onClick={() => files.open({ attachmentId: item.id })}
      >
        {image ? (
          <img
            src={image}
            alt={item.name}
            onError={() => {
              setImage(null);
              setFailed(true);
            }}
          />
        ) : (
          <File size={20} />
        )}
        {!isImage && (
          <span>
            <strong>{item.name}</strong>
            <small>{Math.max(1, Math.round(item.size / 1024))} KB</small>
          </span>
        )}
      </button>
      {failed && (
        <button className="attachment-retry" onClick={() => setAttempt((v) => v + 1)}>
          {t('previewFailed')} · {t('tryAgain')}
        </button>
      )}
      {onRemove && (
        <IconButton
          className="attachment-remove"
          label={`${t('removeAttachment')} ${item.name}`}
          onClick={onRemove}
        >
          <X />
        </IconButton>
      )}
    </div>
  );
}
/** 展示附件集合，可用于可编辑草稿或只读历史消息。 */
export function AttachmentList({
  items,
  onRemove,
}: {
  items: Attachment[];
  onRemove?(id: string): void;
}) {
  return (
    <div className="attachment-list">
      {items.map((item) => (
        <AttachmentItem
          key={item.id}
          item={item}
          onRemove={onRemove ? () => onRemove(item.id) : undefined}
        />
      ))}
    </div>
  );
}
/** 将浏览器 File 转成 IPC 可传输的数据，交给后台校验和保存。 */
export async function uploadFiles(files: File[]): Promise<Attachment[]> {
  if (files.length > 10 || files.some((f) => f.size > 20 * 1024 * 1024))
    throw new MooseError('attachments', 'Up to 10 attachments, 20 MB each.');
  return Promise.all(
    files.map(async (file) => {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      return window.moose.request('uploadAttachment', {
        name: file.name || 'pasted-image.png',
        data,
      });
    }),
  );
}
