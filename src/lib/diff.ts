export interface DiffLine {
  text: string;
  kind: 'added' | 'removed' | 'hunk' | 'context' | 'meta';
  old?: number;
  next?: number;
}
/** 解析 unified diff，计算新增、删除和上下文行对应的新旧行号。 */
export function diffLines(text: string): DiffLine[] {
  let old = 0,
    next = 0,
    inHunk = false;
  return text.split('\n').map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (match) {
      old = Number(match[1]);
      next = Number(match[2]);
      inHunk = true;
      return { text: line, kind: 'hunk' };
    }
    if (!inHunk || line.startsWith('\\')) return { text: line, kind: 'meta' };
    if (line.startsWith('+')) return { text: line.slice(1), kind: 'added', next: next++ };
    if (line.startsWith('-')) return { text: line.slice(1), kind: 'removed', old: old++ };
    if (line.startsWith(' '))
      return { text: line.slice(1), kind: 'context', old: old++, next: next++ };
    return { text: line, kind: 'meta' };
  });
}
