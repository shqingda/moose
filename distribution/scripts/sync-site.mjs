import { access, cp, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = resolve('distribution/site/dist/client');
const destination = resolve('distribution/public');
const protectedFiles = ['install.sh', 'latest-darwin-arm64.txt'];
const protectedPaths = [...protectedFiles, 'releases'];
await access(resolve(source, 'index.html'));
const sourceEntries = await readdir(source);
if (protectedPaths.some((path) => sourceEntries.includes(path))) {
  throw new Error('Site build contains reserved distribution paths.');
}
const before = await Promise.all(
  protectedFiles.map((file) => readFile(resolve(destination, file))),
);
await cp(source, destination, { recursive: true });
const after = await Promise.all(protectedFiles.map((file) => readFile(resolve(destination, file))));
if (before.some((contents, index) => !contents.equals(after[index]))) {
  throw new Error('Site build changed installer distribution files.');
}
console.log('Updated landing page assets; installer and release files are unchanged.');
