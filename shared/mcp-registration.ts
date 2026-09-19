import { z } from 'zod';
const clean = z
  .string()
  .max(4096)
  .refine((value) => !value.includes('\0'));
const variable = z
  .string()
  .max(128)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const endpoint = z
  .string()
  .max(4096)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  }, 'Use HTTPS or loopback HTTP, without credentials, query parameters or fragments');
export const mcpRegistration = z.discriminatedUnion('transport', [
  z.strictObject({
    transport: z.literal('http'),
    url: endpoint,
    bearerTokenEnvVar: variable.optional(),
  }),
  z.strictObject({
    transport: z.literal('stdio'),
    command: clean.min(1).refine((value) => value.trim().length > 0),
    args: z.array(clean).max(100),
    envVars: z.array(variable).max(50),
  }),
]);
export type McpRegistration = z.infer<typeof mcpRegistration>;
/** New registrations remain disabled until the user explicitly enables them. */
export function mcpConfig(input: McpRegistration) {
  const value = mcpRegistration.parse(input);
  return value.transport === 'http'
    ? {
        url: value.url,
        enabled: false,
        ...(value.bearerTokenEnvVar ? { bearer_token_env_var: value.bearerTokenEnvVar } : {}),
      }
    : { command: value.command, args: value.args, env_vars: value.envVars, enabled: false };
}
