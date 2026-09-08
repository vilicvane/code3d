export class AgentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export function object(
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AgentError('invalid_input', label + ' must be an object.');
  if (Object.keys(value).some(key => !fields.includes(key)))
    throw new AgentError(
      'invalid_input',
      label + ' contains an unknown field.',
    );
  return value as Record<string, unknown>;
}

export function string(
  value: unknown,
  label: string,
  allowEmpty = false,
): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0))
    throw new AgentError('invalid_input', label + ' must be a string.');
  return value;
}

export function identifier(value: unknown, label: string): string {
  const result = string(value, label);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(result))
    throw new AgentError(
      'invalid_input',
      label + ' is not a valid identifier.',
    );
  return result;
}

export function projectPath(value: unknown): string {
  const path = string(value, 'Project path');
  if (
    !path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    (path !== '/' &&
      path
        .split('/')
        .slice(1)
        .some(p => !p || p === '.' || p === '..'))
  )
    throw new AgentError(
      'invalid_input',
      'Use an absolute path within the project.',
    );
  return path;
}

export function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean')
    throw new AgentError('invalid_input', label + ' must be a boolean.');
  return value;
}

export function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new AgentError(
      'invalid_input',
      label + ' must be a positive integer.',
    );
  return value as number;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function decodeBase64(
  value: unknown,
  label: string,
): Uint8Array<ArrayBuffer> {
  const encoded = string(value, label, true);
  if (!/^[A-Za-z0-9_-]*$/.test(encoded) || encoded.length % 4 === 1)
    throw new AgentError(
      'invalid_input',
      label + ' must use unpadded base64url.',
    );
  const decoded = Uint8Array.from(
    atob(encoded.replaceAll('-', '+').replaceAll('_', '/')),
    c => c.charCodeAt(0),
  );
  if (encodeBase64(decoded) !== encoded)
    throw new AgentError(
      'invalid_input',
      label + ' must use canonical base64url.',
    );
  return decoded;
}

export function secret(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length !== 43 ||
    decodeBase64(value, label).length !== 32
  )
    throw new AgentError(
      'invalid_input',
      label + ' must encode 32 random bytes.',
    );
  return value;
}
