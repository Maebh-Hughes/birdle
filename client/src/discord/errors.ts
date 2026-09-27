// Discord SDK commands reject with plain `{ code, message }` objects (not Errors)
// when Discord answers with an ERROR frame, and with Errors otherwise.

export function sdkErrorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' ? code : undefined;
}

/** A readable one-line description of anything thrown by the SDK or the API client. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'object' && error !== null) {
    const { message } = error as { message?: unknown };
    const code = sdkErrorCode(error);
    if (typeof message === 'string' && message) return code === undefined ? message : `${message} (code ${code})`;
    if (code !== undefined) return `Discord error ${code}`;
  }
  return String(error);
}
