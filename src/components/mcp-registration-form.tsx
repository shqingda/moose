import { useState } from 'react';
import type { ConfigSource, ExtensionChange } from '../../shared/extensions';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Field, FieldGroup, FieldLabel } from './ui/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from './ui/select';
import { Alert, AlertDescription } from './ui/alert';
export function McpRegistrationForm({
  source,
  disabled,
  onPreview,
}: {
  source?: ConfigSource;
  disabled: boolean;
  onPreview: (change: ExtensionChange) => void;
}) {
  const t = useI18n(),
    [open, setOpen] = useState(false),
    [transport, setTransport] = useState<'http' | 'stdio'>('http'),
    [name, setName] = useState(''),
    [endpoint, setEndpoint] = useState(''),
    [command, setCommand] = useState(''),
    [args, setArgs] = useState('[]'),
    [variables, setVariables] = useState(''),
    [error, setError] = useState('');
  async function preview() {
    if (!source) return;
    try {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(name)) throw new Error();
      const { mcpRegistration } = await import('../../shared/mcp-registration');
      const server = mcpRegistration.parse(
        transport === 'http'
          ? {
              transport,
              url: endpoint,
              ...(variables.trim() ? { bearerTokenEnvVar: variables.trim() } : {}),
            }
          : {
              transport,
              command,
              args: JSON.parse(args),
              envVars: variables.split(/[\s,]+/).filter(Boolean),
            },
      );
      onPreview({ type: 'mcpAdd', sourceId: source.id, version: source.version, name, server });
      setError('');
    } catch {
      setError(t('mcpInvalid'));
    }
  }
  return (
    <>
      <Button variant="outline" disabled={disabled || !source} onClick={() => setOpen(!open)}>
        {t('mcpAdd')}
      </Button>
      {open && (
        <FieldGroup>
          <p>{t('mcpAddHint')}</p>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field>
            <FieldLabel htmlFor="mcp-name">{t('mcpName')}</FieldLabel>
            <Input
              id="mcp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={disabled}
            />
          </Field>
          <Field>
            <FieldLabel>{t('mcpTransport')}</FieldLabel>
            <Select
              value={transport}
              disabled={disabled}
              onValueChange={(v) => {
                if (v === 'http' || v === 'stdio') {
                  setTransport(v);
                  setVariables('');
                }
              }}
            >
              <SelectTrigger aria-label={t('mcpTransport')}>
                <SelectValue>{transport === 'http' ? 'Streamable HTTP' : 'STDIO'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="http">Streamable HTTP</SelectItem>
                  <SelectItem value="stdio">STDIO</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {transport === 'http' ? (
            <Field>
              <FieldLabel htmlFor="mcp-url">URL</FieldLabel>
              <Input
                id="mcp-url"
                disabled={disabled}
                value={endpoint}
                placeholder="https://example.com/mcp"
                onChange={(e) => setEndpoint(e.target.value)}
              />
            </Field>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="mcp-command">{t('mcpCommand')}</FieldLabel>
                <Input
                  id="mcp-command"
                  disabled={disabled}
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="mcp-args">{t('mcpArgs')}</FieldLabel>
                <Textarea
                  id="mcp-args"
                  disabled={disabled}
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                />
              </Field>
            </>
          )}
          <Field>
            <FieldLabel htmlFor="mcp-env">
              {t(transport === 'http' ? 'mcpBearer' : 'mcpEnv')}
            </FieldLabel>
            <Input
              id="mcp-env"
              disabled={disabled}
              value={variables}
              onChange={(e) => setVariables(e.target.value)}
            />
          </Field>
          <Button disabled={disabled || !source} onClick={preview}>
            {t('mcpPreview')}
          </Button>
        </FieldGroup>
      )}
    </>
  );
}
