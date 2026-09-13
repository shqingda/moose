import { useEffect, useState } from 'react';
import { File, X } from 'lucide-react';
import type { Attachment } from '../../shared/types';
import { IconButton } from './common';
import { useI18n } from '../lib/i18n';
function AttachmentItem({ item, onRemove }: { item: Attachment; onRemove?(): void }) {
  const t = useI18n(), [image, setImage] = useState<string | null>(null);
  useEffect(() => { let live = true; if (item.mime.startsWith('image/')) void window.moose.request('attachmentPreview', { id: item.id }).then(data => { if (live) setImage(data); }).catch(() => {}); return () => { live = false; }; }, [item.id, item.mime]);
  return <div className="attachment-chip" title={item.name}>{image ? <img src={image} alt={item.name} /> : <File size={20} />}<span><strong>{item.name}</strong><small>{Math.max(1, Math.round(item.size / 1024))} KB</small></span>{onRemove && <IconButton label={`${t('removeAttachment')} ${item.name}`} onClick={onRemove}><X /></IconButton>}</div>;
}
export function AttachmentList({ items, onRemove }: { items: Attachment[]; onRemove?(id: string): void }) { return <div className="attachment-list">{items.map(item => <AttachmentItem key={item.id} item={item} onRemove={onRemove ? () => onRemove(item.id) : undefined} />)}</div>; }
export async function uploadFiles(files: File[]): Promise<Attachment[]> {
  if (files.length > 10 || files.some(f => f.size > 20 * 1024 * 1024)) throw new Error('Up to 10 attachments, 20 MB each.');
  return Promise.all(files.map(async file => {
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
    return window.moose.request('uploadAttachment', { name: file.name || 'pasted-image.png', data });
  }));
}
