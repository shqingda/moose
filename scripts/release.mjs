// One release operation for both hosts. A release stays draft until Web verification succeeds.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const mode = process.argv[2];
const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: 'inherit', ...options });
const output = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();
const pnpm = (...args) => run('pnpm', args);
const dmg = `release/Moose-${version}-arm64.dmg`;
const notes = `docs/releases/${version}.md`;
const checksums = `release/Moose-${version}-SHA256SUMS.txt`;
const webArchive = `release/Moose-${version}-web-darwin-arm64.tar.gz`;
if (mode === 'prepare') {
  if (output('git', ['status', '--porcelain']))
    throw new Error('Commit release changes before preparing packages.');
  await access(notes);
  pnpm('format:check');
  pnpm('lint');
  pnpm('test');
  pnpm('build');
  pnpm('--filter', '@moose/site', 'typecheck');
  pnpm('site:build');
  pnpm('exec', 'playwright', 'test');
  pnpm('exec', 'electron-builder', '--mac', 'dmg', '--arm64');
  pnpm('exec', 'tsx', 'scripts/package-smoke.ts');
  const nodeArchive = '/tmp/moose-node-v24.21.0.tar.gz';
  try {
    await access(nodeArchive);
  } catch {
    run('curl', [
      '-fsSL',
      '--retry',
      '3',
      'https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-arm64.tar.gz',
      '-o',
      nodeArchive,
    ]);
  }
  run(process.execPath, ['distribution/scripts/package.mjs', nodeArchive]);
  run(process.execPath, ['distribution/scripts/smoke.mjs']);
  const { copyFile } = await import('node:fs/promises');
  await copyFile('distribution/.build/package.tar.gz', webArchive);
  const files = [dmg, webArchive];
  await writeFile(
    checksums,
    (
      await Promise.all(
        files.map(
          async (file) =>
            `${createHash('sha256')
              .update(await readFile(file))
              .digest('hex')}  ${file.split('/').at(-1)}`,
        ),
      )
    ).join('\n') + '\n',
  );
  await writeFile(
    'release/prepared.json',
    JSON.stringify({
      version,
      commit: output('git', ['rev-parse', 'HEAD']),
      dmg,
      webArchive,
      checksums,
    }),
  );
  console.log(`Both ${version} packages are prepared and verified.`);
} else if (mode === 'publish') {
  if (output('git', ['status', '--porcelain']))
    throw new Error('Commit the complete release before publishing.');
  const prepared = JSON.parse(await readFile('release/prepared.json'));
  const commit = output('git', ['rev-parse', 'HEAD']);
  if (prepared.version !== version || prepared.commit !== commit)
    throw new Error('Run release:prepare from the current release commit first.');
  const manifest = (await readFile('distribution/public/latest-darwin-arm64.txt', 'utf8')).trim();
  if (!manifest.startsWith(version + '-'))
    throw new Error('Web version differs from desktop version.');
  const webChecksum = createHash('sha256')
    .update(await readFile(webArchive))
    .digest('hex');
  if (manifest.split(' ')[1] !== webChecksum)
    throw new Error('Web archive differs from the distribution manifest.');
  run('shasum', ['-a', '256', '-c', resolve(checksums)], { cwd: resolve('release') });
  if (
    output('/usr/libexec/PlistBuddy', [
      '-c',
      'Print :CFBundleShortVersionString',
      'release/mac-arm64/Moose.app/Contents/Info.plist',
    ]) !== version
  )
    throw new Error('Desktop package version mismatch.');
  const tag = `v${version}`;
  let existing;
  try {
    existing = JSON.parse(output('gh', ['release', 'view', tag, '--json', 'isDraft']));
  } catch {
    /* first publish */
  }
  if (existing && !existing.isDraft)
    throw new Error('This version is already published; bump the version.');
  // Push the actual release commit and tag; never replace an existing tag.
  run('git', ['push', 'origin', 'HEAD']);
  let tagCommit;
  try {
    tagCommit = output('git', ['rev-list', '-n', '1', tag]);
  } catch {
    /* new tag */
  }
  if (tagCommit && tagCommit !== commit)
    throw new Error('Release tag points to a different commit.');
  if (!tagCommit) run('git', ['tag', tag]);
  run('git', ['push', 'origin', tag]);
  if (!existing)
    run('gh', [
      'release',
      'create',
      tag,
      '--verify-tag',
      '--draft',
      '--title',
      `Moose ${version}`,
      '--notes-file',
      notes,
    ]);
  run('gh', [
    'release',
    'upload',
    tag,
    dmg,
    webArchive,
    checksums,
    'distribution/install.sh',
    '--clobber',
  ]);
  pnpm('dlx', 'wrangler@4.135.0', 'deploy', '--config', 'distribution/wrangler.jsonc');
  run(process.execPath, ['distribution/scripts/smoke.mjs'], {
    env: { ...process.env, MOOSE_SMOKE_BASE: 'https://moose.shqingda.workers.dev' },
  });
  const published = output('curl', [
    '-fsSL',
    '--max-time',
    '30',
    'https://moose.shqingda.workers.dev/latest-darwin-arm64.txt',
  ]);
  if (published.trim() !== manifest)
    throw new Error('Published Web manifest mismatch; desktop release remains draft.');
  run('gh', ['release', 'edit', tag, '--draft=false', '--latest']);
  console.log(`Published desktop and Web ${version}.`);
} else {
  throw new Error('Usage: node scripts/release.mjs prepare|publish');
}
