// Process-tree memory for the perf scripts. RSS counts a shared page once in every process that maps
// it, so per-role RSS sits next to macOS physical footprint (vmmap, then top) or Linux PSS/USS.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const units: Record<string, number> = { '': 1 / 1024, B: 1 / 1024, K: 1, M: 1024, G: 1024 ** 2 };
const mib = (kib: number) => Math.round((kib / 1024) * 10) / 10;

export type Role =
  | 'main'
  | 'gpu'
  | 'renderer'
  | 'utility'
  | 'zygote'
  | 'crashpad'
  | 'other'
  | 'service'
  | 'service-child';
interface Row {
  pid: number;
  ppid: number;
  rssKiB: number;
  command: string;
}
interface Physical {
  footprintKiB?: number;
  pssKiB?: number;
  ussKiB?: number;
}

async function processTable(): Promise<Row[]> {
  const { stdout } = await exec('/bin/ps', ['-axww', '-o', 'pid=,ppid=,rss=,command='], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match ? [{ pid: +match[1], ppid: +match[2], rssKiB: +match[3], command: match[4] }] : [];
  });
}

function electronRole(command: string): { role: Role; detail?: string } {
  // Chromium children also carry --crashpad-handler-pid, so the process type decides first.
  const type = /--type=([\w-]+)/.exec(command)?.[1];
  if (type === 'gpu-process') return { role: 'gpu' };
  if (type === 'renderer') return { role: 'renderer' };
  if (type === 'zygote') return { role: 'zygote' };
  if (type === 'utility')
    return { role: 'utility', detail: /--utility-sub-type=([\w.]+)/.exec(command)?.[1] };
  if (type === 'crashpad-handler' || (!type && command.includes('crashpad')))
    return { role: 'crashpad' };
  return { role: 'other', detail: type };
}

async function footprints(pids: number[]): Promise<[Map<number, Physical>, string | null]> {
  const result = new Map<number, Physical>();
  await Promise.all(
    pids.map(async (pid) => {
      let output = '';
      try {
        output = (await exec('/usr/bin/vmmap', ['-summary', String(pid)], { timeout: 30000 }))
          .stdout;
      } catch (error) {
        output = String((error as { stdout?: string }).stdout ?? '');
      }
      const match = /^Physical footprint:\s+([\d.]+)([BKMG]?)\b/m.exec(output);
      if (match) result.set(pid, { footprintKiB: +match[1] * units[match[2]] });
    }),
  );
  const fromVmmap = result.size;
  if (fromVmmap === pids.length) return [result, 'vmmap'];
  try {
    const { stdout } = await exec('/usr/bin/top', ['-l', '1', '-s', '0', '-stats', 'pid,mem'], {
      maxBuffer: 16 * 1024 * 1024,
    });
    for (const line of stdout.split('\n')) {
      const match = /^\s*(\d+)\s+([\d.]+)([BKMG])[+-]?\s*$/.exec(line);
      if (match && pids.includes(+match[1]) && !result.has(+match[1]))
        result.set(+match[1], { footprintKiB: +match[2] * units[match[3]] });
    }
  } catch {
    /* Keep whatever vmmap returned. */
  }
  const source = [fromVmmap && 'vmmap', result.size > fromVmmap && 'top'].filter(Boolean).join('+');
  return [result, source ? source + (result.size < pids.length ? ' (partial)' : '') : null];
}

async function proportional(pids: number[]): Promise<[Map<number, Physical>, string | null]> {
  const result = new Map<number, Physical>();
  await Promise.all(
    pids.map(async (pid) => {
      try {
        const text = await readFile(`/proc/${pid}/smaps_rollup`, 'utf8');
        const field = (name: string) =>
          +(new RegExp(`^${name}:\\s+(\\d+) kB`, 'm').exec(text)?.[1] ?? 0);
        result.set(pid, {
          pssKiB: field('Pss'),
          ussKiB: field('Private_Clean') + field('Private_Dirty'),
        });
      } catch {
        /* The process exited between ps and the read. */
      }
    }),
  );
  return [
    result,
    result.size ? 'smaps_rollup' + (result.size < pids.length ? ' (partial)' : '') : null,
  ];
}

/** Memory of the desktop tree (main and Chromium helpers) and the service tree, by process role. */
export async function processMemory(roots: { desktop?: number; service?: number }) {
  const rows = await processTable();
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const children = new Map<number, Row[]>();
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
  const tree = (root?: number) => {
    const found: Row[] = [];
    const pending = root && byPid.has(root) ? [root] : [];
    while (pending.length) {
      const pid = pending.pop()!;
      found.push(byPid.get(pid)!);
      for (const child of children.get(pid) ?? []) pending.push(child.pid);
    }
    return found;
  };
  const service = tree(roots.service);
  const owned = new Set(service.map((row) => row.pid));
  const processes = [
    ...tree(roots.desktop)
      .filter((row) => !owned.has(row.pid))
      .map((row) => ({
        ...row,
        ...(row.pid === roots.desktop ? { role: 'main' as Role } : electronRole(row.command)),
      })),
    ...service.map((row) => ({
      ...row,
      role: (row.pid === roots.service ? 'service' : 'service-child') as Role,
      detail: row.pid === roots.service ? undefined : row.command.split(' ')[0].split('/').pop(),
    })),
  ];
  const pids = processes.map((row) => row.pid);
  const [physical, physicalSource] =
    process.platform === 'darwin'
      ? await footprints(pids)
      : process.platform === 'linux'
        ? await proportional(pids)
        : [new Map<number, Physical>(), null];
  const detail = processes.map((row) => {
    const extra = physical.get(row.pid);
    return {
      pid: row.pid,
      role: row.role,
      ...(row.detail ? { detail: row.detail } : {}),
      rssMiB: mib(row.rssKiB),
      ...(extra?.footprintKiB !== undefined ? { footprintMiB: mib(extra.footprintKiB) } : {}),
      ...(extra?.pssKiB !== undefined
        ? { pssMiB: mib(extra.pssKiB), ussMiB: mib(extra.ussKiB!) }
        : {}),
    };
  });
  const total = (rows: typeof detail) => {
    const sum = (key: 'rssMiB' | 'footprintMiB' | 'pssMiB' | 'ussMiB') =>
      rows.some((row) => row[key] !== undefined)
        ? Math.round(rows.reduce((value, row) => value + (row[key] ?? 0), 0) * 10) / 10
        : undefined;
    return {
      count: rows.length,
      rssMiB: sum('rssMiB')!,
      footprintMiB: sum('footprintMiB'),
      pssMiB: sum('pssMiB'),
      ussMiB: sum('ussMiB'),
    };
  };
  const roles = Object.fromEntries(
    [...new Set(detail.map((row) => row.role))].map((role) => [
      role,
      total(detail.filter((row) => row.role === role)),
    ]),
  );
  return {
    /** 0.23.0 definition: RSS of both trees summed, rounded to MiB. */
    residentMiB: Math.round(processes.reduce((sum, row) => sum + row.rssKiB, 0) / 1024),
    physicalSource,
    total: total(detail),
    roles,
    processes: detail,
  };
}
