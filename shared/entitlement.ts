import { MooseError, type ErrorCode } from './errors';

export type Entitlement = 'subscription' | 'model' | 'auth';

const messages: Record<Entitlement, string> = {
  subscription: 'Subscription expired',
  model: 'Model unavailable',
  auth: 'Sign in required',
};

/** 从 CLI 原文里识别订阅、模型或登录失败，不把普通超时算进去。 */
export function entitlementKind(message: string): Entitlement | undefined {
  if (
    /subscription|entitlement|payment required|upgrade your plan|plan (?:has )?expired|usage limit|quota exceeded|billing/i.test(
      message,
    )
  )
    return 'subscription';
  if (
    /model (?:is )?(?:unavailable|not available|not found)|unknown model|model_not_found|no access to (?:the )?model|not entitled to (?:the )?model/i.test(
      message,
    )
  )
    return 'model';
  if (
    /\b401\b|unauthorized|not signed in|sign in|authentication required|login required|invalid api key/i.test(
      message,
    )
  )
    return 'auth';
  return undefined;
}

export function entitlementMessage(kind: Entitlement) {
  return messages[kind];
}

/** 把可识别的底座错误收成短消息；其他错误保持原样。 */
export function entitlementError(error: unknown): MooseError | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const kind = entitlementKind(message);
  if (!kind) return undefined;
  const code: ErrorCode = kind;
  return new MooseError(code, messages[kind]);
}
