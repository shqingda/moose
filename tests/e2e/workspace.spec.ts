// 端到端验收：临时数据库 + 测试 CLI 驱动真实 Electron 界面，覆盖关键用户流程。
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, chmod, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { Store } from '../../electron/db/store';
import { randomUUID } from 'node:crypto';

let app: ElectronApplication;
let dir: string;
test.afterEach(async () => {
  if (app) await app.close().catch(() => {});
  if (dir) await rm(dir, { recursive: true, force: true });
});
// 创建临时数据与可选种子记录，再启动使用测试代理的 Electron 应用。
async function launch(seed?: (store: Store) => void) {
  dir = await mkdtemp(join(tmpdir(), 'moose-e2e-'));
  const fixture = resolve('tests/fixtures/agent.mjs');
  await chmod(fixture, 0o755);
  const store = new Store(join(dir, 'moose.sqlite'));
  store.setSettings({
    language: 'en',
    theme: 'light',
    codexPath: fixture,
    grokPath: fixture,
    piPath: resolve('tests/fixtures/pi.mjs'),
  });
  seed?.(store);
  store.close();
  const env: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, MOOSE_DATA_DIR: dir }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  await page.waitForSelector('.app-shell');
  return page;
}
test('opens a project, approves a real IPC turn, reviews diff, persists draft and switches themes', async () => {
  const page = await launch();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const projectDir = join(dir, 'project');
  execFileSync('/usr/bin/git', ['init', '-q', projectDir]);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, projectDir);
  await page.locator('.welcome').getByRole('button', { name: 'Open project' }).click();
  await expect(page.locator('.project-heading')).toContainText('project');
  await page.locator('#composer').fill('Implement a focused change');
  await page.locator('#composer').press('Enter');
  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(page.locator('.markdown')).toContainText('Implemented the change.');
  expect(await readFile(join(projectDir, 'approved.txt'), 'utf8')).toBe('moose-approved\n');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.locator('.change-file').click();
  await expect(page.locator('.diff-code')).toContainText('+moose-approved');
  await page.locator('#composer').fill('Saved draft');
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.moose.request('snapshot', {}))).sessions[0].draft,
    )
    .toBe('Saved draft');
  const capability = await page.evaluate(() => ({
    node: typeof (window as unknown as { require?: unknown }).require,
    keys: Object.keys(window.moose),
  }));
  expect(capability.node).toBe('undefined');
  expect(capability.keys.sort()).toEqual(['request', 'subscribe']);
  await expect(
    page.evaluate(() => window.moose.request('openExternal', { url: 'file:///etc/passwd' })),
  ).rejects.toThrow();
  await page.screenshot({ path: 'test-results/workspace-light.png' });
  await page.locator('.review-panel').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.review-frame')).toHaveCSS('width', '0px');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect(page.locator('.review-frame')).not.toHaveAttribute('inert', '');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).click();
  await page.getByRole('option', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveClass('dark');
  await page.getByRole('combobox', { name: 'Language', exact: true }).click();
  await page.getByRole('option', { name: '简体中文' }).click();
  await expect(page.getByRole('heading', { name: '通用', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: '简体中文' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/settings-dark.png' });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/workspace-dark.png' });
  expect(errors).toEqual([]);
});
test('handles 10,000 persisted events, paging, IME input, archive and restore', async () => {
  let sessionId = '';
  const page = await launch((store) => {
    const project = store.addProject(dir),
      session = store.createSession(project.id, 'codex');
    sessionId = session.id;
    store.updateSession(session.id, { title: 'Long conversation', status: 'completed' });
    const runId = randomUUID();
    store.sqlite.transaction(() => {
      for (let i = 0; i < 10000; i++)
        store.saveMessage({
          id: randomUUID(),
          runId,
          sessionId,
          seq: i + 1,
          kind: 'assistant',
          title: '',
          state: 'done',
          text: `Historical entry ${i}`,
          createdAt: i,
        });
    })();
  });
  await page.locator('.session-row').filter({ hasText: 'Long conversation' }).click();
  await expect(page.locator('.markdown')).toHaveCount(80);
  const start = Date.now();
  await page.locator('#composer').fill('正在输入');
  expect(Date.now() - start).toBeLessThan(1000);
  await page
    .locator('#composer')
    .dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  expect(await page.locator('#composer').inputValue()).toBe('正在输入');
  expect(
    (await page.evaluate((id) => window.moose.request('queue', { sessionId: id }), sessionId))
      .length,
  ).toBe(0);
  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(page.locator('.markdown')).toHaveCount(160);
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Session title').fill('Renamed conversation');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.header-title')).toHaveText('Renamed conversation');
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.locator('#composer')).toBeEnabled();
  await expect(page.locator('.header-title')).toHaveCount(0);
  await page.getByRole('button', { name: 'Archived sessions', exact: true }).click();
  await page.locator('.session-row').filter({ hasText: 'Renamed conversation' }).click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.locator('#composer')).toBeEnabled();
  await app.close();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE',
    ),
  );
  app = await electron.launch({ args: ['.'], env: { ...env, MOOSE_DATA_DIR: dir } });
  const restored = await app.firstWindow();
  await expect(restored.locator('#composer')).toHaveValue('正在输入');
  await expect(restored.locator('.header-title')).toHaveText('Renamed conversation');
});
test('Grok approval denial and questions travel through ACP, and cancellation preserves queue', async () => {
  const page = await launch();
  const projectDir = join(dir, 'grok-project');
  execFileSync('/usr/bin/git', ['init', '-q', projectDir]);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, projectDir);
  await page.locator('.welcome').getByRole('button', { name: 'Open project' }).click();
  await page.getByRole('button', { name: 'Model', exact: true }).click();
  await page
    .locator('.model-providers')
    .getByRole('button', { name: 'Grok Build', exact: true })
    .click();
  await page.locator('.model-option').first().click();
  await page.locator('#composer').fill('Change this');
  await page.locator('#composer').press('Enter');
  await page.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(page.locator('.markdown')).toContainText('Permission denied.');
  await page.locator('#composer').fill('ask');
  await page.locator('#composer').press('Enter');
  await expect(page.getByText('Which approach?', { exact: true })).toBeVisible();
  await page.getByPlaceholder('Your answer', { exact: true }).fill('Small change');
  await page.getByRole('button', { name: 'Send answer' }).click();
  await expect(page.locator('.markdown').last()).toContainText('Answer received.');
  await page.locator('#composer').fill('hold');
  await page.locator('#composer').press('Enter');
  await expect(page.getByRole('button', { name: 'Stop task' })).toBeVisible();
  await page.locator('#composer').fill('queued followup');
  await page.locator('#composer').press('Enter');
  await page.getByRole('button', { name: 'Stop task' }).click();
  await page.locator('.queue-panel summary').click();
  await expect(page.locator('.queue-panel')).toContainText('queued followup');
  await expect(page.getByRole('button', { name: 'Resume queue' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('.queue-panel')).toHaveCount(0);
});

test('imports image and text attachments, persists permissions, copies and edits messages, and collapses sidebar', async () => {
  const page = await launch();
  const projectDir = join(dir, 'attachments-project');
  execFileSync('/usr/bin/git', ['init', '-q', projectDir]);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, projectDir);
  await page.locator('.welcome').getByRole('button', { name: 'Open project' }).click();
  const { writeFile } = await import('node:fs/promises');
  const imagePath = join(dir, 'example.png'),
    textPath = join(dir, '说明.md');
  await writeFile(
    imagePath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  await writeFile(textPath, 'Attached context');
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
    },
    [imagePath, textPath],
  );
  await page.getByRole('button', { name: 'Add attachments', exact: true }).click();
  await expect(page.locator('.composer-region .attachment-chip')).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Permissions', exact: true }).click();
  await page.getByRole('option', { name: 'Approve for me', exact: true }).click();
  await page.locator('#composer').fill('inspect-input');
  await page.locator('#composer').press('Enter');
  await expect(page.locator('.markdown')).toContainText('localImage');
  await expect(page.locator('.markdown')).toContainText('Attached context');
  await expect(page.locator('.markdown')).toContainText('auto_review');
  await page.locator('.message-user').hover();
  await page
    .locator('[data-align=end] .message-actions')
    .getByRole('button', { name: 'Copy message', exact: true })
    .click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('inspect-input');
  await page.getByRole('button', { name: 'Edit message', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.user-text')).toHaveCount(1);
  await page.locator('.message-user').hover();
  await page.getByRole('button', { name: 'Edit message', exact: true }).click();
  await expect(page.locator('.message-inline-edit .attachment-chip')).toHaveCount(2);
  await expect(
    page.locator('.message-inline-edit').getByRole('button', { name: /Remove attachment/ }),
  ).toHaveCount(0);
  await page
    .getByRole('textbox', { name: 'Edit message', exact: true })
    .fill('inspect-input revised');
  await page
    .locator('.message-inline-edit')
    .getByRole('button', { name: 'Send message', exact: true })
    .click();
  await expect(page.locator('.user-text')).toHaveText('inspect-input revised');
  await expect(page.locator('.markdown')).toContainText('localImage');
  await expect(page.locator('.markdown')).toContainText('Attached context');
  await expect(page.locator('.composer-region .attachment-chip')).toHaveCount(0);
  await expect(page.locator('.session-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await expect(page.locator('.sidebar-frame')).toHaveAttribute('inert', '');
  await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()!
      .items.flatMap((i) => i.submenu?.items || [])
      .find((i) => i.accelerator === 'CmdOrCtrl+B')!;
    item.click();
  });
  await expect(page.locator('.sidebar-frame')).not.toHaveAttribute('inert', '');
  await page.screenshot({ path: 'test-results/attachments-and-history.png' });
});

test('archives before deletion, opens an unsaved conversation and keeps project files', async () => {
  const page = await launch((store) => {
    const project = store.addProject(dir);
    for (const title of ['One', 'Two']) {
      const s = store.createSession(project.id, 'codex');
      store.updateSession(s.id, { title });
    }
  });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(dir, 'keep.txt'), 'keep');
  await page
    .locator('.sidebar-actions')
    .getByRole('button', { name: /New session/ })
    .click();
  await expect(page.locator('.session-row')).toHaveCount(2);
  await expect(page.locator('#composer')).toBeEnabled();
  await page.locator('.session-row').filter({ hasText: 'One' }).click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.locator('.session-row')).toHaveCount(1);
  await expect(page.locator('#composer')).toBeEnabled();
  await expect(page.locator('.header-title')).toHaveCount(0);
  await page.locator('#composer').fill('inspect-input new conversation');
  await page.locator('#composer').press('Enter');
  await expect(page.locator('.session-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Archived sessions', exact: true }).click();
  await page.getByRole('button', { name: 'Session actions One', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.locator('.session-row')).toHaveCount(0);
  await page.getByRole('button', { name: /Project actions/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Archive project conversations' })).toHaveCount(
    0,
  );
  await page.getByRole('menuitem', { name: 'Delete project', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.project-group')).toHaveCount(1);
  await page.getByRole('button', { name: /Project actions/ }).click();
  await page.getByRole('menuitem', { name: 'Delete project', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.locator('.project-group')).toHaveCount(0);
  expect(await readFile(join(dir, 'keep.txt'), 'utf8')).toBe('keep');
});

test('composer searches project context, selects skills and plan mode with keyboard, and exposes broad navigation targets', async () => {
  let projectId = '';
  const page = await launch((store) => {
    projectId = store.addProject(dir).id;
  });
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(join(dir, '中文 folder'));
  await writeFile(join(dir, '中文 folder', 'Application.tsx'), 'export const example = true;');
  await mkdir(join(dir, '.agents/skills/moose-fixture'), { recursive: true });
  await writeFile(
    join(dir, '.agents/skills/moose-fixture/SKILL.md'),
    '---\nname: moose-fixture\ndescription: Test the current project\n---\nRead Application.tsx.',
  );
  const input = page.locator('#composer');
  await input.fill('@aptsx');
  await expect(page.getByRole('option', { name: /Application.tsx/ })).toBeVisible();
  await input.press('Enter');
  await expect(input).toHaveValue('@"中文 folder/Application.tsx" ');
  await expect(page.locator('.context-chips')).toHaveCount(0);
  await input.press('End');
  await input.pressSequentially('/moose-fixture');
  await expect(page.getByRole('option', { name: /moose-fixture/ })).toBeVisible();
  await input.press('Tab');
  await expect(input).toHaveValue('@"中文 folder/Application.tsx" /moose-fixture ');
  await input.pressSequentially('/plan');
  await expect(page.getByRole('option', { name: /Plan mode/ })).toBeVisible();
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(input).toHaveValue('@"中文 folder/Application.tsx" /moose-fixture /plan');
  await input.press('Enter');
  await expect(page.locator('.context-chips')).toContainText('Plan mode');
  await input.press('Home');
  await input.pressSequentially('inspect-input ');
  await input.press('Enter');
  await expect(page.locator('.markdown')).toContainText('read-only');
  await expect(page.locator('.markdown')).toContainText('moose-fixture');
  await expect(page.locator('.markdown')).toContainText('mention');
  const snapshot = await page.evaluate(() => window.moose.request('snapshot', {}));
  expect(snapshot.sessions[0].projectId).toBe(projectId);
  const messages = await page.evaluate(
    (id) => window.moose.request('messages', { sessionId: id }),
    snapshot.sessions[0].id,
  );
  expect(messages.messages.find((m) => m.kind === 'user')?.context?.mode).toBe('plan');
  await page.screenshot({ path: 'test-results/context-light.png' });
  await input.fill('/');
  await expect(page.getByRole('option', { name: /Goal mode/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /moose-fixture/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/slash-menu.png' });
  await input.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const back = await page.getByRole('button', { name: 'Back', exact: true }).boundingBox();
  const general = await page.getByRole('button', { name: 'General', exact: true }).boundingBox();
  expect(back!.width).toBe(general!.width);
  expect(back!.height).toBeGreaterThanOrEqual(40);
});

test('shows available reasoning and hides empty summaries', async () => {
  const page = await launch((store) => {
    const session = store.createSession(store.addProject(dir).id, 'codex');
    store.updateSession(session.id, { title: 'Reasoning check' });
    const runId = randomUUID();
    for (const [seq, text] of [
      [1, 'A visible summary from the agent'],
      [2, ''],
    ] as const)
      store.saveMessage({
        id: randomUUID(),
        sessionId: session.id,
        runId,
        seq,
        kind: 'reasoning',
        title: '',
        text,
        state: 'done',
        createdAt: Date.now(),
      });
  });
  await page.locator('.session-row').click();
  await expect(page.locator('details.activity')).toHaveCount(1);
  await page.locator('details.activity summary').click();
  await expect(page.locator('details.activity pre')).toHaveText('A visible summary from the agent');
  await expect(page.locator('.activity-empty')).toHaveCount(0);
});

test('project hover stays uniform and its compose button targets that project', async () => {
  let firstId = '',
    secondId = '';
  const page = await launch((store) => {
    const first = store.addProject(dir),
      second = store.addProject(join(dir, 'second'));
    firstId = first.id;
    secondId = second.id;
    const session = store.createSession(first.id, 'codex');
    store.updateSession(session.id, { title: 'Selected conversation' });
  });
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(dir, 'second'));
  await page.locator('.session-row').click();
  const selected = page.locator('.session-entry').filter({ hasText: 'Selected conversation' });
  const project = selected.locator('..').locator('..').locator('.project-heading-row');
  await project.hover();
  const selectedColor = await selected.evaluate((e) => getComputedStyle(e).backgroundColor);
  await expect(project).toHaveCSS('background-color', selectedColor);
  const menu = project.getByRole('button', { name: /Project actions/ });
  await menu.hover();
  await expect(project).toHaveCSS('background-color', selectedColor);
  await expect(menu).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const gap = await selected.evaluate(
    (e) =>
      e.getBoundingClientRect().top -
      e.parentElement!.previousElementSibling!.getBoundingClientRect().bottom,
  );
  expect(gap).toBeGreaterThanOrEqual(2);
  expect(gap).toBeLessThanOrEqual(5);
  await page.screenshot({ path: 'test-results/sidebar-project-hover.png' });
  await menu.click();
  await expect(page.getByRole('menuitem', { name: 'Delete project', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete project', exact: true })).toHaveCSS(
    'white-space',
    'nowrap',
  );
  await page.screenshot({ path: 'test-results/project-menu-english.png' });
  await page.keyboard.press('Escape');
  await selected.hover();
  await expect(
    selected.getByRole('button', { name: 'Archive · Selected conversation', exact: true }),
  ).toBeVisible();
  await expect(selected.getByRole('button', { name: /Session actions/ })).toHaveCount(0);
  const add = page.locator('.project-add-button svg');
  expect(await add.evaluate((e) => e.getBoundingClientRect().height)).toBeCloseTo(
    await page
      .locator('.section-caption')
      .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
    0,
  );
  await page.getByRole('button', { name: 'New session · second', exact: true }).click();
  await expect(page.locator('.header-path')).toHaveText('second');
  await expect(page.locator('.session-row')).toHaveCount(1);
  await page.locator('#composer').fill('inspect-input');
  await page.locator('#composer').press('Enter');
  await expect(page.locator('.markdown')).toBeVisible();
  const snapshot = await page.evaluate(() => window.moose.request('snapshot', {}));
  expect(snapshot.sessions.find((s) => s.title === 'inspect-input')?.projectId).toBe(secondId);
  expect(snapshot.sessions.find((s) => s.title === 'Selected conversation')?.projectId).toBe(
    firstId,
  );
});

test('copies one complete AI turn and only offers editing on the latest user message', async () => {
  const page = await launch((store) => {
    const s = store.createSession(store.addProject(dir).id, 'codex');
    store.updateSession(s.id, { title: 'Grouped reply', status: 'completed' });
    for (const [runId, kind, text] of [
      ['one', 'user', 'Earlier question'],
      ['one', 'assistant', 'Earlier answer'],
      ['two', 'user', 'Latest question'],
      ['two', 'assistant', 'Before tool'],
      ['two', 'tool', 'Tool output'],
      ['two', 'assistant', 'After tool'],
    ] as const)
      store.saveMessage({
        id: randomUUID(),
        sessionId: s.id,
        runId,
        kind,
        text,
        seq: 1,
        title: '',
        state: 'done',
        createdAt: Date.now(),
      });
  });
  await page.getByRole('button', { name: 'Grouped reply', exact: true }).click();
  await expect(
    page
      .locator('.message-user')
      .first()
      .getByRole('button', { name: 'Edit message', exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator('.message-assistant')
      .getByRole('button', { name: 'Return to this message', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('.message-assistant .message-actions')).toHaveCount(2);
  await page.locator('.message-assistant').last().hover();
  await page
    .locator('.message-assistant')
    .last()
    .getByRole('button', { name: 'Copy message', exact: true })
    .click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('Before tool\n\nAfter tool');
});

test('keeps empty workspace chrome quiet and exposes native shortcuts and roomy provider settings', async () => {
  const page = await launch();
  await expect(page.locator('.add-first-project')).toHaveCount(0);
  await expect(page.locator('.header-path')).toHaveText('');
  const accelerators = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!
      .items.flatMap((i) => i.submenu?.items || [])
      .map((i) => i.accelerator),
  );
  expect(accelerators).toContain('CmdOrCtrl+O');
  expect(accelerators).toContain('CmdOrCtrl+Shift+B');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Keyboard shortcuts', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/settings-general-light.png' });
  await page.getByRole('button', { name: 'Providers', exact: true }).click();
  await page.locator('.provider-row').first().click();
  await expect(page.getByLabel('Executable path', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/settings-providers-light.png' });
  await page.evaluate(() => window.moose.request('settings', { theme: 'dark' }));
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('.settings-page')).toHaveCSS('background-color', 'rgb(32, 33, 36)');
  await page.screenshot({ path: 'test-results/settings-providers-dark.png' });
});

test('provider switches persist and usage displays actual windows through Cmd U', async () => {
  const page = await launch((store) => {
    store.addProject(dir);
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Providers', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Enable Codex', exact: true });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect
    .poll(() =>
      page.evaluate(async () => (await window.moose.request('snapshot', {})).settings.codexEnabled),
    )
    .toBe(false);
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()!
      .items.flatMap((i) => i.submenu?.items || [])
      .find((i) => i.accelerator === 'CmdOrCtrl+U')!
      .click();
  });
  await expect(page.locator('.usage-popup')).toContainText('80% remaining');
  await expect(page.locator('.usage-popup')).toContainText('40% remaining');
  await expect(page.locator('.usage-popup')).toContainText('5h limit');
  await expect(page.locator('.usage-popup')).toContainText('Weekly limit');
  await page.screenshot({ path: 'test-results/usage-windows.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Model', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search models…', exact: true }).fill('fixture');
  await expect(page.locator('.model-option')).toHaveCount(1);
  await page.locator('.model-option').click();
  await expect(page.locator('.model-list-trigger')).toContainText('Fixture model');
  await page.locator('#composer').fill('inspect-input');
  await page.locator('#composer').press('Enter');
  await expect(page.locator('.markdown')).toBeVisible();
  await page.getByRole('button', { name: 'Usage', exact: true }).click();
  await expect(page.locator('.usage-popup')).toContainText('1.2k /128.0k (1%)');
});

test('provider rows are compact without hover fill and project rows collapse conversations', async () => {
  const page = await launch((store) => {
    const p = store.addProject(dir);
    const s = store.createSession(p.id, 'codex');
    store.updateSession(s.id, { title: 'Fold me' });
  });
  await expect(page.locator('.session-row')).toBeVisible();
  await page.locator('.session-row').click();
  const titleBefore = await page.locator('.header-title').textContent();
  await page.locator('.project-heading').click();
  await expect(page.locator('.session-row')).not.toBeVisible();
  await expect(page.locator('.header-title')).toHaveText(titleBefore!);
  await page.locator('.project-heading').click();
  await expect(page.locator('.session-row')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Providers', exact: true }).click();
  const row = page.locator('.provider-row').first();
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(64);
  await row.hover();
  await expect(row).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.screenshot({ path: 'test-results/provider-compact-no-hover.png' });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Model', exact: true }).click();
  await expect(page.locator('.model-providers')).toBeVisible();
  await page.screenshot({ path: 'test-results/combined-model-picker.png' });
});

test('aligns sidebar labels at unchanged row heights and reveals message times on hover', async () => {
  const page = await launch((store) => {
    const p = store.addProject(dir),
      s = store.createSession(p.id, 'codex');
    store.updateSession(s.id, { title: 'Timestamp check', status: 'completed' });
    for (const kind of ['user', 'assistant'] as const)
      store.saveMessage({
        id: randomUUID(),
        sessionId: s.id,
        runId: 'time-run',
        kind,
        text: kind,
        seq: 1,
        title: '',
        state: 'done',
        createdAt: new Date(2026, 8, 13, 23, 18).getTime(),
      });
  });
  await page.locator('.session-row').click();
  const sizes = await page.evaluate(() =>
    ['.sidebar-actions button', '.project-heading', '.session-title', '.section-caption'].map(
      (s) => getComputedStyle(document.querySelector(s)!).fontSize,
    ),
  );
  expect(new Set(sizes).size).toBe(1);
  const positions = await page.evaluate(() => {
    const newIcon = document.querySelector('.sidebar-actions button svg')!.getBoundingClientRect();
    const projectIcon = document.querySelector('.project-heading svg')!.getBoundingClientRect();
    const projectText = document.querySelector('.project-heading span')!.getBoundingClientRect();
    const sessionText = document.querySelector('.session-title')!.getBoundingClientRect();
    return [newIcon.left - projectIcon.left, projectText.left - sessionText.left];
  });
  for (const delta of positions) expect(Math.abs(delta)).toBeLessThan(1);
  expect((await page.locator('.session-row').boundingBox())!.height).toBe(32);
  for (const kind of ['user', 'assistant']) {
    const row = page.locator('.message-' + kind);
    await row.hover();
    await expect(row.locator('.message-actions')).toHaveCSS('opacity', '1');
    await expect(row.locator('time')).toHaveText('23:18');
    await expect(
      row.getByRole('button', { name: 'Return to this message', exact: true }),
    ).toHaveCount(0);
  }
  await page.screenshot({ path: 'test-results/sidebar-alignment-and-time.png' });
});

// 验证第三种协议贯穿模型选择、权限选择、发送与持久化，未接触真实模型额度。
test('selects Pi and persists a streamed RPC conversation', async () => {
  const page = await launch((store) => {
    store.addProject(dir);
  });
  await page.getByRole('button', { name: 'Model', exact: true }).click();
  await page.getByRole('button', { name: 'Pi', exact: true }).click();
  await page.locator('.model-option').filter({ hasText: 'Test Pi' }).click();
  await page.locator('.permission-picker').click();
  await page.getByRole('option', { name: 'Full access', exact: true }).click();
  await page.locator('#composer').fill('Hello Pi');
  await page.locator('#composer').press('Enter');
  await expect(page.locator('.markdown')).toContainText('Pi response');
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.moose.request('snapshot', {}))).sessions[0]?.status,
    )
    .toBe('completed');
  const snapshot = await page.evaluate(() => window.moose.request('snapshot', {}));
  expect(snapshot.sessions[0]).toMatchObject({ provider: 'pi', model: 'test/model', mode: 'full' });
  expect(snapshot.sessions[0].nativeId).toContain('pi-session.jsonl');
});

// 路径失焦自动保存，只提交当前字段；缺少 CLI 的行直接说明检测结果。
test('provider path saves on blur without a save button or duplicate model count', async () => {
  const page = await launch((store) => store.setSettings({ piPath: '/missing/pi' }));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .locator('.settings-navigation')
    .getByRole('button', { name: 'Providers', exact: true })
    .click();
  const row = page
    .locator('.provider-card')
    .filter({ has: page.locator('.provider-row strong').filter({ hasText: /^Pi/ }) });
  await expect(row.locator('.provider-path')).toHaveText('Not found in PATH: pi');
  await row.locator('.provider-row').click();
  await expect(row.locator('.provider-details button')).toHaveCount(0);
  await row.locator('input').fill(resolve('tests/fixtures/pi.mjs'));
  await page.getByRole('heading', { name: 'Providers', exact: true }).click();
  await expect
    .poll(
      async () => (await page.evaluate(() => window.moose.request('snapshot', {}))).settings.piPath,
    )
    .toBe(resolve('tests/fixtures/pi.mjs'));
  await expect(row.locator('.provider-path')).toContainText('1 Model');
  await expect(row.locator('.provider-details [data-slot="field-description"]')).toHaveCount(0);
});

for (const provider of ['codex', 'grok'] as const) {
  test(`${provider} displays automatic native delegation without a composer toggle`, async () => {
    let sessionId = '';
    const page = await launch((store) => {
      const session = store.createSession(store.addProject(dir).id, provider);
      sessionId = session.id;
      store.updateSession(session.id, { title: 'Subagent test' });
    });
    await page.locator('.session-row').first().click();
    await expect(page.getByRole('button', { name: 'Subagents', exact: true })).toHaveCount(0);
    await page.locator('#composer').fill('delegate-fixture');
    await page.locator('#composer').press('Enter');
    if (provider === 'codex') {
      await expect(page.locator('.subagent-activity').first()).toContainText('Delegate');
      await page.getByRole('button', { name: 'Allow once', exact: true }).click();
    }
    await expect(page.locator('.markdown')).toContainText('Delegated work complete.');
    const history = await page.evaluate(
      (sessionId) => window.moose.request('messages', { sessionId }),
      sessionId,
    );
    expect(history.messages.find((message) => message.kind === 'user')?.text).toBe(
      'delegate-fixture',
    );
    if (provider === 'codex') {
      expect(
        history.messages.find((message) => message.delegation?.operation === 'wait')?.delegation
          ?.agents,
      ).toEqual([
        { id: 'child-fixture', status: 'completed', message: 'Subagent verified the tests.' },
      ]);
    }
    await page.reload();
    const activity =
      provider === 'codex'
        ? page.locator('.subagent-activity').filter({ hasText: 'Collect results' })
        : page.locator('.activity').filter({ hasText: 'Delegate test review' });
    await activity.locator('summary').click();
    await expect(activity.locator('pre').last()).toContainText('Subagent verified the tests.');
    await page.screenshot({ path: `test-results/${provider}-subagents.png` });
  });
}

test('reviews, edits and approves a native plan, restoring execution permissions', async () => {
  let sessionId = '';
  const page = await launch((store) => {
    const session = store.createSession(store.addProject(dir).id, 'codex');
    sessionId = session.id;
    store.updateSession(session.id, {
      title: 'Native plan test',
      draftContext: { mode: 'plan', references: [], skills: [] },
    });
  });
  await page.getByRole('button', { name: 'Native plan test', exact: true }).click();
  await page.locator('#composer').fill('plan-fixture');
  await page.locator('#composer').press('Enter');
  const plan = page.getByRole('region', { name: 'Review plan' });
  await expect(plan.getByRole('button', { name: 'Approve and execute' })).toBeEnabled();
  await expect(plan).toContainText('Create the approved file.');
  await expect(readFile(join(dir, 'approved.txt'))).rejects.toThrow();
  await plan.getByRole('button', { name: 'Edit plan' }).click();
  await plan
    .getByLabel('Plan text')
    .fill('# Edited plan\n\nOnly create the approved file and report EDITED_SCOPE.');
  await plan.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(plan).toContainText('v2');
  await page.reload();
  await page.getByRole('button', { name: 'Native plan test', exact: true }).click();
  await expect(plan).toContainText('EDITED_SCOPE');
  await page.screenshot({ path: 'test-results/native-plan-review.png' });
  await plan.getByRole('button', { name: 'Approve and execute' }).click();
  await expect(page.locator('.message-assistant')).toContainText('Executed approved text:');
  await expect(page.locator('.message-assistant')).toContainText('EDITED_SCOPE');
  expect(await readFile(join(dir, 'approved.txt'), 'utf8')).toBe('moose-approved\n');
  const messages = await page.evaluate(
    (sessionId) => window.moose.request('messages', { sessionId }),
    sessionId,
  );
  expect(messages.messages.filter((m) => m.kind === 'user')).toHaveLength(2);
  expect(messages.messages.find((m) => m.kind === 'plan')?.plan?.queueId).toBeTruthy();
  await expect(page.getByRole('button', { name: 'Approve and execute' })).toHaveCount(0);
  await expect(page.locator('.context-chips')).toHaveCount(0);
});

test('steers the active Codex turn and persists delivery without enqueueing a new turn', async () => {
  let sessionId = '';
  const page = await launch((store) => {
    const session = store.createSession(store.addProject(dir).id, 'codex');
    sessionId = session.id;
    store.updateSession(session.id, { title: 'Steering test' });
  });
  await page.getByRole('button', { name: 'Steering test', exact: true }).click();
  await page.locator('#composer').fill('steer-fixture');
  await page.locator('#composer').press('Enter');
  await expect(page.locator('.markdown')).toContainText('Waiting for steering.');
  await page.locator('#composer').fill('Use the revised direction');
  await page.getByRole('button', { name: 'Send now', exact: true }).click();
  await expect(page.locator('.message-assistant').last()).toContainText(
    'Use the revised direction',
  );
  await expect(page.getByText('Added to the active turn', { exact: true })).toBeVisible();
  const messages = await page.evaluate(
    (sessionId) => window.moose.request('messages', { sessionId }),
    sessionId,
  );
  const users = messages.messages.filter((m) => m.kind === 'user');
  expect(users).toHaveLength(2);
  expect(users[0].runId).toBe(users[1].runId);
  expect(users[0].nativeTurnId).toBe(users[1].nativeTurnId);
  expect(
    await page.evaluate((sessionId) => window.moose.request('queue', { sessionId }), sessionId),
  ).toEqual([]);
  await page.reload();
  await page.getByRole('button', { name: 'Steering test', exact: true }).click();
  await expect(page.getByText('Added to the active turn', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/native-steering.png' });
});

test('retains rejected steering input and marks disconnects unknown without retrying', async () => {
  let sessionId = '';
  const page = await launch((store) => {
    const session = store.createSession(store.addProject(dir).id, 'codex');
    sessionId = session.id;
    store.updateSession(session.id, { title: 'Steering failures' });
  });
  await page.getByRole('button', { name: 'Steering failures', exact: true }).click();
  await page.locator('#composer').fill('steer-fixture');
  await page.locator('#composer').press('Enter');
  await expect(page.locator('.markdown')).toContainText('Waiting for steering.');
  await page.evaluate(
    (id) =>
      window.moose.request('updateSession', {
        id,
        draftContext: { mode: 'plan', references: [], skills: [] },
      }),
    sessionId,
  );
  await expect(page.locator('.context-chips')).toContainText('Plan mode');
  await page.locator('#composer').fill('Rejected mode change');
  await page.getByRole('button', { name: 'Send now', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Not sent' })).toBeVisible();
  await expect(page.locator('#composer')).toHaveValue('Rejected mode change');
  await page.locator('.context-chips button').click();
  await page.locator('#composer').fill('drop-steer-fixture');
  await page.getByRole('button', { name: 'Send now', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Delivery unknown' })).toBeVisible();
  await expect(page.locator('#composer')).toHaveValue('');
  expect(
    await page.evaluate((sessionId) => window.moose.request('queue', { sessionId }), sessionId),
  ).toEqual([]);
  const messages = await page.evaluate(
    (sessionId) => window.moose.request('messages', { sessionId }),
    sessionId,
  );
  expect(messages.messages.filter((m) => m.delivery).map((m) => m.delivery?.status)).toEqual([
    'rejected',
    'unknown',
  ]);
});
