import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../../electron/db/store';
let app: ElectronApplication, dir: string;
test.afterEach(async () => {
  await app?.close().catch(() => {});
  if (dir) await rm(dir, { recursive: true, force: true });
});
async function launch() {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'moose-extensions-e2e-')));
  const store = new Store(join(dir, 'moose.sqlite'));
  store.setSettings({
    language: 'en',
    opencodeEnabled: false,
    codexPath: resolve('tests/fixtures/extensions.mjs'),
    grokEnabled: false,
    piEnabled: false,
  });
  const project = store.addProject(dir),
    session = store.createSession(project.id, 'codex');
  store.updateSession(session.id, { title: 'Extension checks' });
  store.close();
  const env = Object.fromEntries(
    Object.entries({ ...process.env, MOOSE_DATA_DIR: dir }).filter(
      (e): e is [string, string] => typeof e[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  await page.waitForSelector('.app-shell');
  await page.getByText('Extension checks', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Configuration & extensions', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Configuration & extensions', exact: true });
  await expect(dialog.getByRole('tab', { name: 'MCP', exact: true })).toBeVisible();
  return {
    page,
    dialog,
    scope: { projectId: project.id, sessionId: session.id, provider: 'codex' as const },
  };
}
test('previews scoped configuration changes, installs plugins, and never renders credentials', async () => {
  const { page, dialog } = await launch();
  await dialog.getByRole('tab', { name: 'Agent', exact: true }).click();
  await dialog.locator('summary').click();
  await expect(dialog).toContainText('Read only');
  await expect(dialog).not.toContainText('SECRET_CANARY');
  await dialog.getByRole('textbox', { name: 'Default model', exact: true }).fill('changed-model');
  await dialog.getByRole('button', { name: 'Preview change', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review configuration change' })).toBeVisible();
  await page.getByRole('button', { name: 'Apply reviewed change', exact: true }).click();
  await expect(dialog).toContainText('model: changed-model');
  await dialog.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Search plugins' }).fill('fixture');
  await dialog.getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('button', { name: 'Apply reviewed change', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Uninstall', exact: true })).toBeVisible();
  expect(JSON.parse(await readFile(join(dir, 'extensions-fixture.json'), 'utf8'))).toMatchObject({
    model: 'changed-model',
    installed: true,
    writes: 2,
  });
  await expect(
    dialog.getByRole('heading', { name: 'Configuration & extensions', exact: true }),
  ).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/extensions-panel.png' });
});
test('cancels native authentication and reports unsupported providers without starting a model', async () => {
  const { page, scope } = await launch();
  // Intercept only the browser opener; the runtime authentication lifecycle stays real.
  await app.evaluate(({ shell }) => {
    shell.openExternal = async () => {};
  });
  await page.getByRole('button', { name: 'Authenticate', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('pending');
  await page.getByRole('status').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('cancelled');
  const unsupported = await page.evaluate(
    (scope) => window.moose.request('extensionsRead', { ...scope, provider: 'grok' }),
    scope,
  );
  expect(unsupported.supported).toBe(false);
});
test('previews MCP registration and saves a disabled server without revealing credentials', async () => {
  const { page, dialog } = await launch();
  await dialog.getByRole('button', { name: 'Add MCP server', exact: true }).click();
  await dialog
    .getByRole('textbox', { name: 'Server name (letters, digits, underscore or hyphen)' })
    .fill('new_server');
  await dialog
    .getByRole('textbox', { name: 'URL', exact: true })
    .fill('https://example.invalid/mcp');
  await dialog
    .getByRole('textbox', { name: 'Bearer token environment variable (optional)' })
    .fill('MCP_TOKEN');
  await dialog.getByText('HTTP headers', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Add header', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Header name', exact: true }).fill('X-API-Key');
  await dialog
    .getByRole('textbox', { name: 'Environment variable', exact: true })
    .fill('SERVICE_KEY');
  await dialog.getByRole('button', { name: 'Preview MCP registration' }).click();
  await expect(page.getByRole('dialog', { name: 'Review configuration change' })).toContainText(
    'Disabled',
  );
  await page.getByRole('button', { name: 'Apply reviewed change' }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(join(dir, 'extensions-fixture.json'), 'utf8').catch(() => '{}'))
          .mcp?.new_server?.enabled,
    )
    .toBe(false);
  await expect(dialog.getByRole('button', { name: 'Enable', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Enable', exact: true }).click();
  await page.getByRole('button', { name: 'Apply reviewed change' }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(join(dir, 'extensions-fixture.json'), 'utf8')).mcp.new_server
          .enabled,
    )
    .toBe(true);
  expect(
    JSON.parse(await readFile(join(dir, 'extensions-fixture.json'), 'utf8')).mcp.new_server
      .env_http_headers,
  ).toEqual({ 'X-API-Key': 'SERVICE_KEY' });
  await expect(dialog).not.toContainText('SECRET_CANARY');
  await expect(page.getByRole('dialog', { name: 'Review configuration change' })).not.toBeVisible();
  await expect(dialog.locator('.extension-row').filter({ hasText: 'new_server' })).toContainText(
    'Enabled',
  );
  await page.screenshot({ path: 'test-results/mcp-registration.png' });
});

test('edits and removes an owned MCP server through focused review dialogs', async () => {
  const { page, dialog, scope } = await launch();
  const snapshot = await page.evaluate(
    (scope) => window.moose.request('extensionsRead', scope),
    scope,
  );
  const source = snapshot.sources.find((s) => s.writable)!;
  await page.evaluate(
    ({ scope, source }) =>
      window.moose.request('extensionsChange', {
        ...scope,
        requestId: crypto.randomUUID(),
        change: {
          type: 'mcpAdd',
          sourceId: source.id,
          version: source.version,
          name: 'editable',
          server: {
            transport: 'http',
            url: 'https://old.invalid/mcp',
            bearerTokenEnvVar: 'KEEP_TOKEN',
          },
        },
      }),
    { scope, source },
  );
  await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
  await dialog.getByRole('button', { name: 'Edit connection', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'URL', exact: true }).fill('https://new.invalid/mcp');
  await dialog.getByRole('button', { name: 'Preview change', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review configuration change', exact: true });
  await expect(review).toContainText('https://new.invalid/mcp');
  await review.getByRole('button', { name: 'Apply reviewed change', exact: true }).click();
  await expect(review).not.toBeVisible();
  const state = JSON.parse(await readFile(join(dir, 'extensions-fixture.json'), 'utf8'));
  expect(state.mcp.editable).toMatchObject({
    url: 'https://new.invalid/mcp',
    enabled: false,
    bearer_token_env_var: 'KEEP_TOKEN',
  });
  await dialog.getByRole('button', { name: 'Remove server', exact: true }).click();
  await expect(review).toContainText('Other projects');
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog.getByText('editable', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove server', exact: true }).click();
  await review.getByRole('button', { name: 'Apply reviewed change', exact: true }).click();
  await expect(review).not.toBeVisible();
  await expect(dialog.getByText('editable', { exact: true })).not.toBeVisible();
  await expect(dialog.getByText('fixture', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/extensions-mcp-clean.png' });
  await page.evaluate(() => window.moose.request('settings', { theme: 'light' }));
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.screenshot({ path: 'test-results/extensions-mcp-light.png', animations: 'disabled' });
  await page.evaluate(() =>
    window.moose.request('settings', { language: 'zh-CN', fontScale: 1.3 }),
  );
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(920, 680);
  });
  const chinese = page.getByRole('dialog', { name: '配置与扩展', exact: true });
  await expect(chinese.getByRole('tab', { name: 'MCP', exact: true })).toBeInViewport();
  await chinese.getByRole('tab', { name: 'MCP', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(chinese.getByRole('tab', { name: '插件', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(chinese.getByRole('tab', { name: '插件', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(await chinese.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({
    path: 'test-results/extensions-chinese-large-text.png',
    animations: 'disabled',
  });
});
