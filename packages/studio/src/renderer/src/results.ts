// ---------------------------------------------------------------------------
// One way to read a mutation's answer, and one voice to say it in.
//
// Main answers every write with the result or `{ error }`. The error branch was
// hand-written at every one of ~60 call sites, and every new one was another
// chance to leave it out, so `ok` is the only way the editor reads one: a type
// guard that says what went wrong and answers false. The few places that say
// it somewhere other than a toast (the welcome screen's own line, the quiet
// auto-rebuild) hand it their own `report`, so the shape stays the same.
// ---------------------------------------------------------------------------

import { toast } from "@wildwinter/app-shell";

/**
 * The toast is the shell's (@wildwinter/app-shell toast.ts): both apps had one
 * and agreed on nothing but the sentences. `flash` keeps the editor's name for
 * it and its default: here an unqualified remark has always meant something
 * went wrong.
 */
export const flash = (message: string, kind: "error" | "ok" = "error"): void => toast(message, kind);
export const flashError = (message: string): void => flash(message, "error");

/** Said nowhere: for the answers a caller deliberately keeps quiet about. */
export const quietly = (): void => { /* nothing to say */ };

/**
 * Did a mutation land? Reports the error and answers false if not.
 *
 * A type guard, so the caller's `r` narrows afterwards. `report` is the toast
 * unless the caller says where else the sentence goes.
 */
export function ok<T extends object>(r: T | { error: string }, report: (error: string) => void = flashError): r is T {
  if ("error" in r) { report((r as { error: string }).error); return false; }
  return true;
}
