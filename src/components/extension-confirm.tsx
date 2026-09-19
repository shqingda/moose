import type { ExtensionChange } from '../../shared/extensions';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';

/** Keep the decision and its scope visible without exposing raw provider configuration. */
export function ExtensionConfirm({
  change,
  path,
  busy,
  onSave,
  onCancel,
}: {
  change?: ExtensionChange;
  path?: string;
  busy: boolean;
  onSave(): void;
  onCancel(): void;
}) {
  const t = useI18n();
  const rows: [string, string][] = [];
  if (change?.type === 'mcpAdd' || change?.type === 'mcpEdit') {
    rows.push(['MCP', change.name]);
    const server = change.server;
    if (server.transport === 'http') {
      rows.push(['URL', server.url]);
      for (const [header, variable] of Object.entries(server.envHeaders || {}))
        rows.push([header, `${t('mcpHeaderVariable')}: ${variable}`]);
      if (server.bearerTokenEnvVar) rows.push([t('mcpBearer'), server.bearerTokenEnvVar]);
    } else {
      rows.push([t('mcpCommand'), server.command], [t('mcpArgs'), JSON.stringify(server.args)]);
      if (server.envVars.length) rows.push([t('mcpEnv'), server.envVars.join(', ')]);
    }
    if (change.type === 'mcpAdd') rows.push([t('mcpStatus'), t('extDisabled')]);
  } else if (change?.type === 'mcpRemove') rows.push([t('mcpRemove'), change.name]);
  else if (change?.type === 'config') rows.push([change.key, change.value]);
  else if (change?.type === 'toggle')
    rows.push([change.name, t(change.enabled ? 'extEnable' : 'extDisable')]);
  else if (change?.type === 'plugin')
    rows.push([t(change.action === 'install' ? 'extInstall' : 'extUninstall'), change.id]);
  return (
    <Dialog
      open={!!change}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <DialogContent className="native-dialog extension-review" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{t('extConfirm')}</DialogTitle>
          <DialogDescription>
            {t(change?.type === 'mcpRemove' ? 'mcpRemoveHint' : 'extHint')}
          </DialogDescription>
        </DialogHeader>
        <div className="native-dialog-body">
          <dl className="extension-review-values">
            {rows.map(([label, value], index) => (
              <div key={index}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {path && change?.type !== 'plugin' && (
            <details className="extension-details">
              <summary>{t('extSources')}</summary>
              <p className="extension-note break-all">{path}</p>
            </details>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button
            variant={change?.type === 'mcpRemove' ? 'destructive' : 'default'}
            disabled={busy}
            onClick={onSave}
          >
            {t('extApply')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
