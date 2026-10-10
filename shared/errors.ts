export type ErrorCode =
  | 'attachments'
  | 'unknown'
  | 'disconnected'
  | 'auth'
  | 'subscription'
  | 'model'
  | 'provider'
  | 'busy'
  | 'version'
  | 'uncertain'
  | 'missing-file'
  | 'file-size'
  | 'file-access';
export interface Fault {
  code: ErrorCode;
  message: string;
}
export class MooseError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MooseError';
  }
}
export function fault(error: unknown): Fault {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error)
    return {
      code: ([
        'attachments',
        'disconnected',
        'auth',
        'subscription',
        'model',
        'provider',
        'busy',
        'version',
        'uncertain',
        'missing-file',
        'file-size',
        'file-access',
      ].includes(String(error.code))
        ? error.code
        : 'unknown') as ErrorCode,
      message: String(error.message),
    };
  return { code: 'unknown', message: error instanceof Error ? error.message : String(error) };
}
export function restoreError(error: unknown): MooseError {
  const value = fault(error);
  return new MooseError(value.code, value.message);
}
// Only known read operations can safely describe a transport failure as disconnected.
export function transportError(method: string, error: unknown) {
  const read =
    /^(snapshot|providers|messages|sessionActivity|searchMessages|locateMessage|fileInfo|filePreview|listDirectory|fileDownload|queue|usage|workspacePath|searchFiles|listSkills|gitStatus|gitDiff|terminalList|terminalRead|commandList|commandRead|scheduleList|nativeList|nativeRead|childThreads|childRead|extensionsRead|clientPresence|claimNotice)$/.test(
      method,
    );
  return new MooseError(read ? 'disconnected' : 'uncertain', fault(error).message);
}
