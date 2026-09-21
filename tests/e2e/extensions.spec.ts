import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, realpath, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
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
  store.close();
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      MOOSE_DATA_DIR: dir,
      PI_CODING_AGENT_DIR: join(dir, 'pi'),
      XDG_CONFIG_HOME: join(dir, 'config'),
    }).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  await page.waitForSelector('.app-shell');
  expect((await page.evaluate(() => window.moose.request('snapshot', {}))).projects).toHaveLength(
    0,
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .locator('.settings-navigation')
    .getByRole('button', { name: 'Configuration & extensions', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Configuration & extensions', exact: true });
  await expect(dialog.getByRole('tab', { name: 'MCP', exact: true })).toBeVisible();
  return {
    page,
    dialog,
    scope: { provider: 'codex' as const },
  };
}
test('previews scoped configuration changes, installs plugins, and never renders credentials', async () => {
  const { page, dialog } = await launch();
  await dialog.getByRole('tab', { name: 'Agent', exact: true }).click();
  await dialog.locator('summary').click();
  await expect(dialog).toContainText('Read only');
  await page.screenshot({ path: 'test-results/extensions-sources.png' });
  await expect(dialog).not.toContainText('SECRET_CANARY');
  await dialog.getByRole('textbox', { name: 'Default model', exact: true }).fill('changed-model');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review configuration change' })).not.toBeVisible();
  await expect(dialog).toContainText('model: changed-model');
  await dialog.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Search plugins' }).fill('fixture');
  await dialog.getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Uninstall', exact: true })).toBeVisible();
  expect(JSON.parse(await readFile(join(dir, 'extensions-fixture.json'), 'utf8'))).toMatchObject({
    model: 'changed-model',
    installed: true,
    writes: 2,
  });
  await expect(
    dialog.getByRole('heading', { name: 'Configuration & extensions', exact: true }),
  ).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Back', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/extensions-panel.png' });
  await page
    .locator('.settings-navigation')
    .getByRole('button', { name: 'General', exact: true })
    .click();
  await page.screenshot({ path: 'test-results/settings-shortcuts.png' });
});
test('cancels native authentication and respects disabled providers without starting a model', async () => {
  const { page, scope } = await launch();
  // Intercept only the browser opener; the runtime authentication lifecycle stays real.
  await app.evaluate(({ shell }) => {
    shell.openExternal = async () => {};
  });
  await page.getByRole('button', { name: 'Authenticate', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('pending');
  await page.getByRole('status').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('cancelled');
  await expect(
    page.evaluate(
      (scope) => window.moose.request('extensionsRead', { ...scope, provider: 'grok' }),
      scope,
    ),
  ).rejects.toThrow('Provider disabled');
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
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(join(dir, 'extensions-fixture.json'), 'utf8').catch(() => '{}'))
          .mcp?.new_server?.enabled,
    )
    .toBe(false);
  await expect(dialog.getByRole('button', { name: 'Enable', exact: true })).toBeVisible();
  const serverOrder = await dialog.locator('.extension-row-heading strong').allTextContents();
  const addButton = dialog.getByRole('button', { name: 'Add MCP server', exact: true });
  const formNode = await addButton.elementHandle();
  const beforeToggle = await dialog.getByRole('tablist').boundingBox();
  await dialog.getByRole('button', { name: 'Enable', exact: true }).click();
  const duringToggle = await dialog.getByRole('tablist').boundingBox();
  expect(duringToggle!.y).toBe(beforeToggle!.y);
  await expect(dialog.getByRole('button', { name: 'Refresh', exact: true })).toHaveCSS(
    'opacity',
    '1',
  );

  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(join(dir, 'extensions-fixture.json'), 'utf8')).mcp.new_server
          .enabled,
    )
    .toBe(true);
  await expect(dialog.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  expect(await formNode!.evaluate((node) => node.isConnected)).toBe(true);
  expect(await dialog.locator('.extension-row-heading strong').allTextContents()).toEqual(
    serverOrder,
  );
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

test('edits MCP configuration and refreshes externally removed servers', async () => {
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
  await review.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(review).not.toBeVisible();
  const state = JSON.parse(await readFile(join(dir, 'extensions-fixture.json'), 'utf8'));
  expect(state.mcp.editable).toMatchObject({
    url: 'https://new.invalid/mcp',
    enabled: false,
    bearer_token_env_var: 'KEEP_TOKEN',
  });
  await expect(dialog.getByRole('button', { name: 'Remove server', exact: true })).toHaveCount(0);
  delete state.mcp.editable;
  await writeFile(join(dir, 'extensions-fixture.json'), JSON.stringify(state));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
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

test('manages Pi and OpenCode user settings without showing unsupported controls', async () => {
  const { page, dialog } = await launch();
  await mkdir(join(dir, 'pi'), { recursive: true });
  await writeFile(join(dir, 'pi/settings.json'), '{"defaultModel":"old"}');
  await mkdir(join(dir, 'config/opencode'), { recursive: true });
  await writeFile(
    join(dir, 'config/opencode/opencode.jsonc'),
    '{"mcp":{"servers":{"local":{"type":"remote","url":"https://example.com","disabled":true}}}}',
  );
  await page.evaluate(
    (path) =>
      window.moose.request('settings', {
        piEnabled: true,
        piPath: path,
        opencodeEnabled: true,
        opencodePath: path,
      }),
    resolve('tests/fixtures/extensions.mjs'),
  );
  await dialog.getByRole('combobox', { name: 'Providers', exact: true }).click();
  await page.getByRole('option', { name: 'Pi', exact: true }).click();
  await expect(dialog.getByRole('tab', { name: 'MCP', exact: true })).toHaveCount(0);
  await dialog.getByRole('textbox', { name: 'Default model', exact: true }).fill('grok-4.6');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(
      async () => JSON.parse(await readFile(join(dir, 'pi/settings.json'), 'utf8')).defaultModel,
    )
    .toBe('grok-4.6');
  await dialog.getByRole('combobox', { name: 'Providers', exact: true }).click();
  await page.getByRole('option', { name: 'OpenCode', exact: true }).click();
  await expect(dialog.getByRole('tab', { name: 'MCP', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Authenticate', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Enable', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Disable', exact: true })).toBeVisible();
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(join(dir, 'config/opencode/opencode.jsonc'), 'utf8')).mcp.servers
          .local.disabled,
    )
    .toBe(false);
});
