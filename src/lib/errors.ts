/**
 * `catch` binds `unknown`, and asserting it to `Error` is a lie: a thrown
 * string, or a rejected promise carrying a plain object, would render
 * "undefined" straight into the UI. Narrow honestly instead.
 */
export function errorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  if (err && typeof err === 'object' && 'message' in err) {
    const { message } = err
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

/** True when a fetch was cancelled deliberately, which is not a failure to report. */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}
