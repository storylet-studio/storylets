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
 * Main's error as a sentence: a capital first and a full stop last, since it
 * often arrives as a fragment ("no project open"). Patterpad's `landed()` reads
 * its refusals the same way. A reason that opens with a file name or an address
 * ("storylets.server.json is…", "@story.x…") keeps its case, which is the name's.
 */
export function sentence(error: string): string {
  const t = error.trim();
  if (t === "") return t;
  const first = t.split(/\s/, 1)[0]!;
  const named = /[./@_`"“'‘]/.test(first);
  const s = named ? t : t[0]!.toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(s) ? s : `${s}.`;
}

/**
 * Did a mutation land? Reports the error and answers false if not.
 *
 * A type guard, so the caller's `r` narrows afterwards. `report` is the toast,
 * said as a sentence, unless the caller says where else the sentence goes.
 */
export function ok<T extends object>(r: T | { error: string }, report: (error: string) => void = (e) => flashError(sentence(e))): r is T {
  if ("error" in r) { report((r as { error: string }).error); return false; }
  return true;
}
