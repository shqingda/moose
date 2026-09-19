import type { McpRegistration } from './mcp-registration';
import type { Provider } from './types';
export interface ExtensionScope {
  projectId: string;
  sessionId?: string;
  provider: Provider;
}
export interface ConfigSource {
  id: string;
  kind: string;
  path: string;
  version: string;
  writable: boolean;
  disabled: boolean;
}
export interface ExtensionSnapshot {
  supported: boolean;
  reason?: string;
  version: string;
  cwd: string;
  sources: ConfigSource[];
  settings: { key: string; value: string; source: string }[];
  mcp: { name: string; enabled: boolean; auth: string; tools: number; failed: boolean }[];
  plugins: {
    id: string;
    name: string;
    marketplace: string;
    installed: boolean;
    enabled: boolean;
    installable: boolean;
    removable: boolean;
  }[];
  hooks: { key: string; event: string; source: string; enabled: boolean; handler: string }[];
  diagnostics: { area: string; path?: string; message: string }[];
}
export type ExtensionChange =
  | { type: 'mcpAdd'; sourceId: string; version: string; name: string; server: McpRegistration }
  | {
      type: 'config';
      sourceId: string;
      version: string;
      key: 'model' | 'model_reasoning_effort';
      value: string;
    }
  | {
      type: 'toggle';
      sourceId: string;
      version: string;
      category: 'mcp' | 'plugin';
      name: string;
      enabled: boolean;
    }
  | { type: 'plugin'; id: string; action: 'install' | 'uninstall' };
export interface ExtensionAuth {
  id: string;
  name: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled' | 'expired';
}
export interface ExtensionRequests {
  extensionsRead: ExtensionScope;
  extensionsChange: ExtensionScope & { requestId: string; change: ExtensionChange };
  extensionsLogin: ExtensionScope & { name: string; requestId: string };
  extensionsAuth: { id: string; cancel?: boolean };
}
export interface ExtensionResponses {
  extensionsRead: ExtensionSnapshot;
  extensionsChange: ExtensionSnapshot;
  extensionsLogin: ExtensionAuth & { url: string };
  extensionsAuth: ExtensionAuth;
}
