import { execFile } from 'node:child_process';
const run = (
  file: string,
  args: string[],
  options: { signal: AbortSignal; timeout: number; maxBuffer: number },
) =>
  new Promise<{ stdout: string }>((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr }));
      else resolve({ stdout });
    });
  });
let active = false;

export function nativeDirectoryAvailable() {
  return (
    process.platform === 'darwin' &&
    !process.env.SSH_CONNECTION &&
    !process.env.SSH_TTY &&
    process.env.MOOSE_WEB_DIRECTORY_PICKER !== 'browse'
  );
}

/** The local host opens the OS chooser; no browser file handle or project upload is involved. */
export async function pickWebDirectory(signal: AbortSignal): Promise<string | null> {
  if (active) throw new Error('A folder chooser is already open');
  active = true;
  try {
    const { stdout } = await run(
      '/usr/bin/osascript',
      [
        '-e',
        'set selectedFolder to choose folder with prompt "Moose — Open project"',
        '-e',
        'POSIX path of selectedFolder',
      ],
      { signal, timeout: 300000, maxBuffer: 64 * 1024 },
    );
    return stdout.replace(/[\r\n]+$/, '') || null;
  } catch (error) {
    const failure = error as { code?: number; stderr?: string };
    if (!signal.aborted && failure.code === 1 && /\(-128\)/.test(failure.stderr || '')) return null;
    throw error;
  } finally {
    active = false;
  }
}
