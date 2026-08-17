/**
 * Bound a promise's wall-clock time without touching fetch's AbortSignal.
 *
 * Deliberately `Promise.race` + `setTimeout` and NOT AbortController: 1.6.5
 * wrapped the Supabase client's `fetch` in an AbortController timeout to fix
 * this same class of hang, and it broke every Supabase call app-wide (login,
 * Menu, everything) because signal support in this native build's fetch does
 * not behave like browser/Node fetch. Racing a timer never touches the request
 * itself — the underlying call keeps running and its result is simply ignored,
 * so this cannot break a request that would otherwise have worked.
 *
 * Note the tradeoff that buys: nothing is actually cancelled, so callers get a
 * bounded *wait*, not a bounded amount of work.
 */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

export function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label = 'request'
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
