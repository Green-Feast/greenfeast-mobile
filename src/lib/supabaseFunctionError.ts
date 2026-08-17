import { FunctionsHttpError } from '@supabase/supabase-js'

// supabase-js's functions.invoke() throws FunctionsHttpError for ANY non-2xx
// response and never parses the body into `data` when that happens — every
// edge function in this project signals a specific error via a non-2xx
// status (json({ error: '...' }, 400)), so `error.message` alone is always
// the generic "Edge Function returned a non-2xx status code" and the actual
// { error: "..." } body is only reachable via error.context.json(). Nothing
// else in the app currently reads it.
export async function extractFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json()
      if (typeof body?.error === 'string') return body.error
    } catch {
      // context wasn't JSON, or was already consumed — fall through
    }
  }
  return (error as { message?: string })?.message || fallback
}
