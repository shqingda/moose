#!/usr/bin/env node
// Local PR protocol fixture. No network requests or real PRs.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
const args = process.argv.slice(2),
  path = process.env.MOOSE_PR_FIXTURE;
if (!path) process.exit(2);
appendFileSync(
  path + '.log',
  JSON.stringify({
    args,
    ...(args.includes('--body-file')
      ? { body: readFileSync(args[args.indexOf('--body-file') + 1], 'utf8') }
      : {}),
  }) + '\n',
);
if (args[0] !== 'pr') process.exit(2);
if (args[1] === 'list') console.log(existsSync(path) ? readFileSync(path, 'utf8') : '[]');
else if (args[1] === 'create') {
  const pr = {
    url: 'https://github.com/example/moose-fixture/pull/1',
    number: 1,
    title: args[args.indexOf('--title') + 1],
    state: 'OPEN',
    baseRefName: args[args.indexOf('--base') + 1],
    headRefName: args[args.indexOf('--head') + 1],
  };
  writeFileSync(path, JSON.stringify([pr]));
  console.log(pr.url);
} else process.exit(2);
