---
"@storylet-studio/model": minor
---

Park one flow, and price a load before you take it (design/engine-server.md 4.1 and 4.9).

`Engine.saveFlow(id)` takes one flow's state and `openFlow(id, { restore })` opens that name as it was. An option on `openFlow` rather than a `restore` verb, because restoring INTO a running flow is the trap replace semantics set. Closing a parked flow releases its shared claims, so a card it held can be dealt elsewhere while it is away; on the way back, a shared card the world has since given out is dropped as `claimed-elsewhere` rather than double-claimed.

`previewLoad(envelope)` and `previewFlowRestore(id, save)` say what a restore would change without changing it, and `loadGame` now returns the same `LoadReport` (new, in `model`): cards evicted and why, cooldowns and spent entries for cards the build no longer has, properties dropped, defaulted or retyped, and `version` / `hash` drift, which used to load in silence. A save for another project is still the one refusal.

A load also prunes what it reports now: an undeclared property, a cooldown for a deleted card, and a saved value that no longer fits its declaration are dropped rather than carried into the next save.
