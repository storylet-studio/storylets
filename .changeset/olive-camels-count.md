---
"@storylet-studio/model": minor
---

A box that counts in time: `turn: { seconds: N }` (design/engine-server.md 4.8).

A box may declare that its turns are TIME rather than plays. `Box.turn` is the declaration, written in `box.storyletbox` and compiled into the bundle unchanged, and a box that carries it is a timed box.

One branch in `play` is the whole of it in the engine: a play in a timed box defaults to advancing 0 rather than `settings.playAdvancesTurns`, so a designer cannot declare the convention and then forget to switch play-advance off. A call that names `advanceTurns` still gets what it asked for, in either kind of box, because the call says otherwise. The host ticks a timed box with `advanceTurns` exactly as it always could: the runtime has no clock and gains none here, and the seconds are never read by it.

What does change is what the tools SAY. `redraw: N` on a card in a timed box means N x `seconds`, so `redraw: 30` in a sixty-second box is half an hour: the card editor labels the field in the box's unit and converts as the designer types, the box page's new Turns section states the consequence in plain words, and the Board shows the unit beside the counter with advance buttons scaled to it. `describeBundle` reports the unit on `BoxSummary`, and the four bundle inspectors show `turn = 60s` on a timed box and nothing at all on an ordinary one. The coverage report reads its turn budget as time when every box in the project agrees on a unit, and the sweep ticks a timed box itself, since the harness is the host.

The compiler refuses a `seconds` that is not a positive integer, and warns about a timed box whose every card says `redraw: "always"`, since nothing in it then rests and being timed buys the box nothing. `turnSpan` in `model` is the one conversion the four surfaces quote.

Corpus first, as ever: six cases and corpus version 5, passing in all four runtimes.
