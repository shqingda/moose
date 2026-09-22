import { webCommand } from './web-shortcuts';

export const WEB_AUTH_REQUIRED = 'moose-auth-required';
export const WEB_AUTH_RESTORED = 'moose-auth-restored';

import type { AppEvent, MooseAPI, Snapshot, Attachment, Method } from '../../shared/types';

const clientId = crypto.randomUUID();

export async function webRequest(method: string, params: unknown): Promise<unknown> {
  // Writes are deliberately never retried: a lost response may already have committed.
  const payload = JSON.stringify({ method, params, clientId });
  const savingDraft = method === 'updateSession' && !!params && 'draft' in (params as object);
  const response = await fetch('/api/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: savingDraft && new TextEncoder().encode(payload).length < 60 * 1024,
    signal: ['terminalControl', 'snapshot'].includes(method)
      ? AbortSignal.timeout(10000)
      : undefined,
  });
  if (response.status === 401) window.dispatchEvent(new Event(WEB_AUTH_REQUIRED));
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body.result;
}
function appearance() {
  return {
    locale: navigator.language,
    dark: matchMedia('(prefers-color-scheme: dark)').matches,
    reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    reduceTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
    highContrast: matchMedia('(prefers-contrast: more)').matches,
  };
}
async function pickFiles(): Promise<Attachment[]> {
  const files = await new Promise<File[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files || []));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
  if (files.length > 10) throw new Error('Select at most 10 attachments');
  const result: Attachment[] = [];
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) throw new Error('Attachments must be at most 20 MB');
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    result.push((await webRequest('uploadAttachment', { name: file.name, data })) as Attachment);
  }
  return result;
}
export function createWebAPI(chooseProject: () => Promise<string | null>): MooseAPI {
  const listeners = new Set<(event: AppEvent) => void>();
  const emit = (event: AppEvent) => {
    for (const listener of listeners) listener(event);
  };
  const keyboard = (event: KeyboardEvent) => {
    const command = webCommand(event);
    if (command) {
      event.preventDefault();
      emit({ type: 'command', command });
    }
  };
  let stream: EventSource | undefined;
  let probing = false;
  const media = [
    'prefers-color-scheme: dark',
    'prefers-reduced-motion: reduce',
    'prefers-reduced-transparency: reduce',
    'prefers-contrast: more',
  ].map((query) => matchMedia(`(${query})`));
  const appearanceChanged = () => emit({ type: 'appearance' });
  const suspend = () => {
    stream?.close();
    stream = undefined;
  };
  const resume = () => {
    if (!listeners.size) return;
    suspend();
    stream = new EventSource('/api/events');
    stream.onmessage = (event) => emit(JSON.parse(event.data));
    stream.onopen = () => emit({ type: 'changed' });
    stream.onerror = () => {
      emit({
        type: 'runtime-error',
        error: navigator.language.startsWith('zh')
          ? '连接已断开，正在重连。请勿重复发送刚才的操作。'
          : 'Disconnected. Reconnecting; do not repeat the last action.',
      });
      // EventSource hides HTTP status. A read-only probe distinguishes expired login from offline.
      if (!probing) {
        probing = true;
        void webRequest('snapshot', {})
          .catch(() => {})
          .finally(() => {
            probing = false;
          });
      }
    };
  };
  let choosingProject = false;
  const request = async (method: Method, params: unknown) => {
    if (method === 'addProject') {
      if (choosingProject) return null;
      choosingProject = true;
      try {
        const path = await chooseProject();
        return path ? await webRequest('webAddProject', { path }) : null;
      } finally {
        choosingProject = false;
      }
    }
    if (method === 'pickAttachments') return pickFiles();
    if (method === 'copyText') {
      await navigator.clipboard.writeText((params as { text: string }).text);
      return null;
    }
    if (method === 'openExternal') {
      const url = new URL((params as { url: string }).url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL');
      window.open(url.href, '_blank', 'noopener,noreferrer');
      return null;
    }
    if (method === 'openProject')
      throw new Error('Open the project on the machine running Moose Web.');
    const result = await webRequest(method, params);
    return method === 'snapshot' ? { ...(result as Snapshot), ...appearance() } : result;
  };
  return {
    host: 'web',
    request: request as MooseAPI['request'],
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        window.addEventListener('keydown', keyboard);
        window.addEventListener('languagechange', appearanceChanged);
        window.addEventListener(WEB_AUTH_REQUIRED, suspend);
        window.addEventListener(WEB_AUTH_RESTORED, resume);
        for (const query of media) query.addEventListener('change', appearanceChanged);
        resume();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          window.removeEventListener('keydown', keyboard);
          window.removeEventListener('languagechange', appearanceChanged);
          window.removeEventListener(WEB_AUTH_REQUIRED, suspend);
          window.removeEventListener(WEB_AUTH_RESTORED, resume);
          for (const query of media) query.removeEventListener('change', appearanceChanged);
          suspend();
        }
      };
    },
  };
}
