import type { ThreadStartParams } from './generated/codex/v2/ThreadStartParams';
/** 把界面权限档位映射为 Codex 审批策略、审批人和沙箱配置。 */
export function codexPermissions(
  mode: string,
): Pick<ThreadStartParams, 'approvalPolicy' | 'approvalsReviewer' | 'sandbox' | 'config'> {
  return mode === 'full'
    ? { approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'danger-full-access' }
    : {
        approvalPolicy: 'on-request',
        approvalsReviewer: mode === 'auto' ? 'auto_review' : 'user',
        sandbox: 'workspace-write',
        config: { 'sandbox_workspace_write.network_access': false, web_search: 'disabled' },
      };
}
