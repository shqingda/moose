import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { ExperienceResponses } from '../shared/experience';
type Permission = ExperienceResponses['notificationPermission'];
const require = createRequire(import.meta.url);
let native: { permission(request: boolean): Promise<Permission> } | undefined;
let pending: Promise<Permission> | undefined;
export function notificationPermission(request = false): Promise<Permission> {
  if (process.platform !== 'darwin') return Promise.resolve('unsupported');
  native ||= require(
    fileURLToPath(new URL('../../dist-native/notifications.node', import.meta.url)),
  );
  // Merge concurrent settings reads and requests without prompting on a read.
  if (!request) return native!.permission(false);
  pending ||= native!.permission(true).finally(() => {
    pending = undefined;
  });
  return pending;
}
