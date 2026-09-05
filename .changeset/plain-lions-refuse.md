---
"@storylet-studio/model": minor
"@storylet-studio/compiler": minor
"@storylet-studio/ops": minor
---

The installation contract: what an author may not break (design/engine-server.md 4.11, net 1).

A new shard kind, `contracts/<installation>.storyletcontract`, JSON5 and canonical like every other. A venue is provisioned against NAMES - the hands its stations deal, the boxes its scheduler ticks, the properties its clocks drive, the fields its crew and its bridges read - and a rename that reaches the venue is a dark kiosk on the night. So the venue's server writes those names down, one file per installation, in its own folder because its owner is the venue and not the author, and `validate` refuses a build that breaks one.

`ContractShard` in `model`, `SourceProject.contracts` in the compiler, and `contractIssues` in ops, which raises an ERROR for each break: a contracted hand gameId that no longer exists, a contracted box whose turn is no longer that many seconds (or is no longer timed at all), a contracted property that has gone or whose type changed, a contracted card field no box declares any more, and two files claiming the same installation. Every message names the dependency and the venue, because a refusal that does not say who cares is one that gets worked around. Each is anchored to the shard that would fix it wherever the entity is still there to be fixed, and to the contract when the name has gone entirely.

Property paths use the engine's own address grammar with no `@` ("world.time_wall", "story.visits"), which is how `listProperties()` prints them, and the owner segment is accepted as either the gameId or the internal id. A property may be written as a bare path or as `{ path, type }`; only the second form can catch a type change, which is the break that costs a producer most.

**The contract never compiles.** It is project-side config like `coverage` and `export`: the server does not need its own contract back, it needs the bundle to still honour it. It merges as one atomic file, because the server rewrites it whole from provisioning and interleaving two halves would synthesise a contract no venue was ever provisioned against.

`contractNotes` is the one derivation of "what depends on this entity", so `storyletengine contract show`, the editor's quiet line and the errors cannot come to disagree. The server that writes these does not exist yet: a project either has none, which is the normal state and changes nothing, or one written by hand.

A box may still be CALLED contracts - Port Meridian's is - so the registry is recognised by extension inside that folder, not by the folder alone.
