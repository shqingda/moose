export interface WorkspaceScope {
  projectId: string;
  sessionId?: string;
}
export interface CommitPreview {
  head: string | null;
  branch: string;
  fingerprint: string;
  files: string[];
  diff: string;
  truncated: boolean;
}
export interface PullRequestInfo {
  url: string;
  number: number;
  title: string;
  state: string;
  baseRefName: string;
  headRefName: string;
}
export interface PullRequestTarget {
  repository: string;
  branch: string;
  head: string;
  base: string;
  baseCommit: string;
}
export interface PullRequestPreview extends PullRequestTarget {
  commits: string;
  diff: string;
  truncated: boolean;
  existing: PullRequestInfo[];
}
export type ReviewTarget =
  | { type: 'uncommittedChanges' }
  | { type: 'baseBranch'; branch: string }
  | { type: 'commit'; sha: string };
export interface CodeReview {
  id: string;
  projectId: string;
  sessionId: string;
  cwd: string;
  target: ReviewTarget;
  nativeId?: string;
  status: 'running' | 'completed' | 'failed' | 'unknown' | 'cancelled';
  text: string;
  error?: string;
  createdAt: number;
}
export interface GitRequests {
  gitStage: WorkspaceScope & { path: string; staged: boolean };
  gitCommitPreview: WorkspaceScope;
  gitCommit: WorkspaceScope & {
    preview: Pick<CommitPreview, 'head' | 'branch' | 'fingerprint'>;
    message: string;
    requestId: string;
  };
  prPreview: WorkspaceScope & { base: string };
  prCreate: WorkspaceScope & {
    preview: PullRequestTarget;
    title: string;
    body: string;
    requestId: string;
  };
  reviewStart: { projectId: string; sessionId: string; target: ReviewTarget; requestId: string };
  reviewList: WorkspaceScope;
  reviewStop: { projectId: string; id: string };
}
export interface GitResponses {
  gitStage: null;
  gitCommitPreview: CommitPreview;
  gitCommit: string;
  prPreview: PullRequestPreview;
  prCreate: string;
  reviewStart: CodeReview;
  reviewList: CodeReview[];
  reviewStop: null;
}
