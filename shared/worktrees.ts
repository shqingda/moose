export interface Worktree {
  id: string;
  projectId: string;
  path: string;
  branch: string;
  baseRef: string;
  baseCommit: string;
  status: 'creating' | 'ready' | 'removing' | 'removed' | 'error';
  kept: boolean;
  error: string;
  createdAt: number;
  merge?: {
    targetPath: string;
    targetBranch: string;
    targetCommit: string;
    sourceCommit: string;
    state: 'starting' | 'pending' | 'conflicts' | 'complete' | 'aborted' | 'unknown';
  };
}
export interface WorktreeStatus {
  worktree: Worktree;
  sourceCommit: string;
  targetCommit: string;
  targetBranch: string;
  dirty: boolean;
  merged: boolean;
  changes: string;
  truncated: boolean;
  conflicts: string[];
  indexFingerprint: string;
  error?: string;
}
