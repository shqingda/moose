/** Isolated PTY owner: loss of the runtime pipe also closes its shell and jobs. */
import { spawn, type IPty } from 'node-pty';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
let terminal: IPty | undefined;
let ending = false;
function send(value: object) {
  if (!process.stdout.write(JSON.stringify(value) + '\n')) terminal?.pause();
}
process.stdout.on('drain', () => terminal?.resume());
function stop() {
  if (ending) return;
  ending = true;
  if (terminal) {
    // Interactive shells put foreground jobs in separate process groups.
    // Capture the owned descendants while the shell is alive, never use saved PIDs.
    try {
      const pairs = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], {
        encoding: 'utf8',
        timeout: 2000,
      })
        .trim()
        .split('\n')
        .map((line) => line.trim().split(/\s+/).map(Number));
      const owned = new Set([terminal.pid]);
      for (let changed = true; changed;) {
        changed = false;
        for (const [pid, parent] of pairs)
          if (owned.has(parent) && !owned.has(pid)) {
            owned.add(pid);
            changed = true;
          }
      }
      for (const pid of [...owned].reverse())
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* Already exited. */
        }
    } catch {
      terminal.kill('SIGKILL');
    }
  }
  setTimeout(() => process.exit(0), 200).unref();
}
process.stdin.on('end', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.stdout.on('error', stop);
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const message = JSON.parse(line);
    if (message.type === 'start' && !terminal && !ending) {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      terminal = spawn('/bin/zsh', ['-i'], {
        cwd: message.cwd,
        cols: message.cols,
        rows: message.rows,
        name: 'xterm-256color',
        env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });
      terminal.onData((data) => send({ type: 'data', data }));
      terminal.onExit(({ exitCode }) => {
        ending = true;
        send({ type: 'exit', exitCode });
        process.stdin.destroy();
        process.stdout.end(() => process.exit(0));
      });
      send({ type: 'ready' });
    } else if (message.type === 'input' && !ending) terminal?.write(message.text);
    else if (message.type === 'resize' && !ending) terminal?.resize(message.cols, message.rows);
    else if (message.type === 'stop') stop();
  } catch {
    send({ type: 'error' });
    stop();
    if (!terminal) process.exitCode = 1;
  }
}
stop();
