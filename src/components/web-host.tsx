import { useEffect, useRef, useState } from 'react';
import App from '../app';
import { WebDirectoryPicker } from './web-directory-picker';
import { createWebAPI, webRequest, WEB_AUTH_REQUIRED, WEB_AUTH_RESTORED } from '../lib/web-api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Field, FieldLabel } from './ui/field';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
export function WebHost() {
  const [zh, setZh] = useState(navigator.language.startsWith('zh'));
  const api = useRef<ReturnType<typeof createWebAPI> | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [ready, setReady] = useState(false),
    [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef<(path: string | null) => void>(() => {});
  const initialized = useRef(false);
  function finish(value: string | null) {
    pending.current(value);
    setOpen(false);
  }
  async function login(value: string) {
    setBusy(true);
    setError('');
    try {
      if (value) {
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: value }),
        });
        if (!response.ok)
          throw new Error(
            zh
              ? '访问令牌无效，请使用服务启动时打印的链接。'
              : 'Invalid access token. Use the link printed by the service.',
          );
      }
      api.current ??= createWebAPI(async () => {
        const result = (await webRequest('webPickDirectory', {})) as {
          supported: boolean;
          path?: string | null;
        };
        if (result.supported) return result.path ?? null;
        return new Promise((resolve) => {
          pending.current = resolve;
          setOpen(true);
        });
      });
      const snapshot = await api.current.request('snapshot', {});
      setZh(
        snapshot.settings.language === 'system'
          ? navigator.language.startsWith('zh')
          : snapshot.settings.language === 'zh-CN',
      );
      window.moose = api.current;
      setToken('');
      setAuthRequired(false);
      window.dispatchEvent(new Event(WEB_AUTH_RESTORED));
      setReady(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const requireAuth = () => {
      finish(null);
      setAuthRequired(true);
      setError('');
    };
    window.addEventListener(WEB_AUTH_REQUIRED, requireAuth);
    return () => window.removeEventListener(WEB_AUTH_REQUIRED, requireAuth);
  }, []);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const value = new URLSearchParams(location.hash.slice(1)).get('token') || '';
    history.replaceState(null, '', location.pathname);
    void login(value);
  }, []);
  if (!ready)
    return (
      <main className="web-login">
        <h1>Moose Web</h1>
        <p>
          {zh
            ? '使用服务启动时打印的访问链接，或输入令牌。'
            : 'Use the access link printed by the service, or enter its token.'}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void login(token);
          }}
        >
          <Field>
            <FieldLabel htmlFor="web-token">{zh ? '访问令牌' : 'Access token'}</FieldLabel>
            <Input
              id="web-token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </Field>
          <Button disabled={busy || !token} type="submit">
            {zh ? '连接' : 'Connect'}
          </Button>
        </form>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  return (
    <>
      <App />
      <Dialog open={authRequired}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{zh ? '重新连接工作区' : 'Reconnect to workspace'}</DialogTitle>
            <DialogDescription>
              {zh
                ? '登录已失效。输入当前服务的访问令牌重新连接；页面中的草稿会保留。'
                : 'Your login expired. Enter the current service token to reconnect. Drafts on this page are kept.'}
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void login(token);
            }}
          >
            <Field>
              <FieldLabel htmlFor="web-reconnect-token">
                {zh ? '访问令牌' : 'Access token'}
              </FieldLabel>
              <Input
                id="web-reconnect-token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </Field>
            <Button type="submit" disabled={busy || !token}>
              {zh ? '连接' : 'Connect'}
            </Button>
            {error && <p role="alert">{error}</p>}
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) finish(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{zh ? '打开项目' : 'Open project'}</DialogTitle>
            <DialogDescription>
              {zh
                ? '选择运行 Moose Web 的机器上的文件夹。'
                : 'Choose a folder on the machine running Moose Web.'}
            </DialogDescription>
          </DialogHeader>
          {open && <WebDirectoryPicker zh={zh} onChoose={finish} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
