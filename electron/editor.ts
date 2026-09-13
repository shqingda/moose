import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
const execute = promisify(execFile);
export async function openEditor(path: string) {
  // Honor an explicitly registered source-code association before choosing an installed editor.
  try {
    const preferences = join(homedir(), 'Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist');
    const { stdout } = await execute('/usr/bin/plutil', ['-extract', 'LSHandlers', 'json', '-o', '-', preferences], { timeout: 3000, maxBuffer: 1024 * 1024 });
    const handlers = JSON.parse(stdout) as Record<string, string>[];
    const handler = handlers.find(item => item.LSHandlerContentType === 'public.source-code') || handlers.find(item => item.LSHandlerContentTagClass === 'public.filename-extension' && ['ts', 'tsx', 'js', 'rs', 'py', 'swift'].includes(item.LSHandlerContentTag));
    const bundle = handler?.LSHandlerRoleEditor || handler?.LSHandlerRoleAll;
    if (bundle && /^[a-zA-Z0-9.-]+$/.test(bundle) && !bundle.startsWith('com.apple.')) { await execute('/usr/bin/open', ['-b', bundle, path], { timeout: 8000 }); return; }
  } catch { /* No registered source-code handler; use a directory-capable coding editor below. */ }
  for (const editor of ['/Applications/Cursor.app', '/Applications/Visual Studio Code.app', '/Applications/Zed.app']) {
    try { await access(editor); } catch { continue; }
    await execute('/usr/bin/open', ['-a', editor, path], { timeout: 8000 }); return;
  }
  throw new Error('Install Cursor, Visual Studio Code, or Zed, or register a default source-code editor in macOS.');
}
