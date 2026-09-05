// ---------------------------------------------------------------------------
// Paging, once, for every list the console has (wire 6.5).
//
// The wire's rule is one rule: `{ cursor, limit }` in, `{ items, next }` out,
// and `next` absent means that was the last page. So there is one helper here
// rather than a `walk` beside every `list`, and it takes the page function
// rather than being a method on one, which is what lets it walk a list this
// package has never heard of.
//
//   for await (const run of walkPages((at) => producer.runs.list({ installation, ...at }))) { ... }
//
// A CURSOR THAT DOES NOT MOVE ENDS THE WALK. A server that hands back the same
// `next` it was given is a server that would page for ever, and a console
// loading a roster for ever looks exactly like a console that has hung. This
// is the one place a client can notice, so it notices here rather than in
// fourteen call sites.
// ---------------------------------------------------------------------------

import type { Page, PageRequest } from "@storylet-studio/wire";

/** Walk every page of one list, yielding its items in order.
 *
 *  `page` is called with the cursor and the limit and returns the wire's own
 *  page shape; the caller supplies whatever else that particular list needs
 *  (the installation, the filters), which is why this takes a closure rather
 *  than a request object. */
export async function* walkPages<T>(
  page: (at: PageRequest) => Promise<Page<T>>,
  opts: { limit?: number } = {},
): AsyncGenerator<T, void, undefined> {
  let cursor: string | undefined;
  const asked = new Set<string>();
  for (;;) {
    const res = await page({
      ...(cursor !== undefined ? { cursor } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    });
    for (const item of res.items) yield item;
    const next = res.next;
    // No cursor, an empty one, or one already spent: that was the last page.
    if (next === undefined || next === "" || asked.has(next)) return;
    asked.add(next);
    cursor = next;
  }
}
