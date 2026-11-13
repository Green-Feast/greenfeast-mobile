import { friendlyFunctionError } from './friendlyError'

// supabase-js's functions.invoke() throws FunctionsHttpError for any non-2xx
// response; our edge functions put the real reason in the { error } body.
// friendlyFunctionError reads that body and also turns network / internal
// errors into customer-safe text. Kept under the old name for existing callers.
export async function extractFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  return friendlyFunctionError(error, fallback)
}
