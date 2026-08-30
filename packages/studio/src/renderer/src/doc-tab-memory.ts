// ---------------------------------------------------------------------------
// Which machinery tab a document shows, remembered for the session at PAGE
// TYPE level (the author's ruling, 2026-08-28): an author who picked Outcomes
// on one card and moves to another card - by any road, the navigator, a
// coverage row, a link - is usually comparing outcomes, so the choice follows
// them across matching page types rather than sticking to the page it was
// made on. One slot per type ("card:", "box:", ...); the most recent act
// wins, whether it was a click on the bar or a jump that targeted a tab.
// A remembered tab a page cannot show (a box whose map group stopped being
// spatial) is the page's own problem to guard, and the box view does.
// ---------------------------------------------------------------------------

const docTabState = new Map<string, string>();

/** "card:arrival/c_gate" -> "card": the page type the memory is keyed by. */
const tabType = (key: string): string => {
  const i = key.indexOf(":");
  return i < 0 ? key : key.slice(0, i);
};

export function currentDocTab(key: string, def: string): string {
  return docTabState.get(tabType(key)) ?? def;
}

/** The remembered tab, or undefined when the type has never been switched:
 *  the difference matters for remembering the page, where "no tab yet" must
 *  not be recorded as though the author had chosen the default. */
export function docTabFor(key: string): string | undefined {
  return docTabState.get(tabType(key));
}

export function setDocTab(key: string, tab: string): void {
  docTabState.set(tabType(key), tab);
}

/** A different project is a different sitting: the defaults (a mapped box
 *  leads with its Map) get to give their first answer again instead of
 *  inheriting the previous project's habits. Also the seam tests reset on. */
export function resetDocTabMemory(): void {
  docTabState.clear();
}
