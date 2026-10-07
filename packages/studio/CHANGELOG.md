# Changelog

All notable changes to **Storyletter**, the Storylets desktop editor, are documented here.
Storyletter is released by tagging `vX.Y.Z`, which drives `.github/workflows/storyletter.yml`:
its own pipeline, separate from the CLI's `cli-v*` tags and from the engine ports.

The release job reads the section for the tagged version out of this file and uses it as the
GitHub Release notes, and it FAILS if there is no dated section matching the tag. So a heading
here is part of shipping, not a courtesy.

## [Unreleased]

### Changed

- **Cmd+P opens the Board**, as it plays a scene in Patterpad. It was Cmd+T.
- **The menus are in Patterpad's order.** File keeps Open Recent and Close Project with New and Open, then saving and the pack items; Duplicate sits below Select All; View runs Project Overview and Up a Level, then Back and Forward, then the panes; Follow System is first among the colour themes. On Linux the last File item says Quit (Exit stays on Windows), and macOS no longer lists Enter Full Screen twice.
- **Menu items that need a project are greyed when none is open**: Close Project, Save, New Card, Share Scopes, The Board, the Publish items and the Storyletpack export and merge. New Card waits for a deck to be open.
- **Review Feedback and Show Resolved Comments start off each time Storyletter opens**, as they do in Patterpad.
- **Undo keeps the last 100 steps.**
- **A double-clicked Storyletpack opens the way File > Open Storyletpack does**: into a folder you choose, merging into the project if the folder already holds it, with the progress strip.
- **Every field saves as you type**, and Esc puts back what the field held when you clicked into it, everywhere. Card and outcome Fields values, a card's Redraw turns, hand and hand template slots, a box's turn seconds and tag names used to save only when you left the field, so Cmd+S, Play and the review walk could act on or lose a value you had just typed. A deck's or a box's title still saves when you leave it, since renaming either moves a file; their purposes now save as you type.
- **Esc goes up a level from any page** when you're not typing in a field, as the back buttons' tips have always said. It used to work only from a card.
- **Deletes ask only when there's something to lose**: a hand template with hands of its kind, a hand with a pin on the map, a box with decks or hands, a card with anything written on it. The question names what goes and says you can undo it, and the menus say "Delete card…" (with the ellipsis only when a question follows). A deck that still has cards, like a tag group that cards still use, is refused rather than asked about, saying why.
- **Skipping the name prompt on first run is final**, as it is in Patterpad, and the prompt says "Welcome to Storyletter".
- **The problems bar matches Patterpad's**: the kind reads "Error" or "Warning", the bar's colour follows the problem you're on rather than the worst one, and its tip says "Go to issue". Clicking the problem count goes to the first problem; its tip says "N problems. Click to step through them."
- **The welcome screen lists eight recent projects**, as the File menu does.
- **New Project's buttons say what follows**: "Choose location…" for a kit and "Open a copy…" for an example.
- **Publish Bundle says "Published"**, as the other two Publish commands do, and the confirmations share one shape.
- **Copy tidied against the house style**: "Links…", "+ New deck" in the navigator, "Remove tag" and "Remove outcome", real plurals ("1 card"), plain placeholders in Fields ("Text", "A number"), a sentence for an empty tier on a hand's Cards tab, "standalone" as the one name for a hand with its own rule, and the themed tooltip on the game id chip. The project page's More button opens a menu (Project settings…, Show in Finder) rather than going straight to Project settings.
- **A new item's title is ready to type into** for every kind: boxes, hands, hand templates, tag groups and maps, and every duplicate, as it already was for cards and decks.
- **Coverage waits for Run**, as Patterpad's does. The window opens on the last report, saying when it ran and marking it once the project has changed since, or on a Run button. It no longer sweeps when it opens or when the project changes.
- **Coverage's fields read "Runs", "Max turns" and "Seed"**, and refuse a blank value, or 0 runs or turns, rather than reporting every card never dealt. Run waits until they're fixed. The Board's seed field reads "Seed" too.
- **Escape on the Board clears a selected hand, or the zone selected on the map, before it closes the window.** Closing the Board once the session has moved on from its opening deal asks first, as Restart does, whichever way it is closed: Escape, its close button, Ctrl+W, Alt+F4 or the window menu. Quitting and installing an update never wait on it. Restart and Close no longer ask about an untouched session.
- **The tool windows share one look**: the Board, Coverage, Links and Find draw the same frame, type size and fields. With no project open, each says in one sentence what to do.
- **Find's empty states are sentences** ("No matches.", "Open a project to search."), and clicking or hovering a result moves the keyboard highlight to it, as in Patterpad.
- **Links' Follow the editor is a toggle that stays put.** Turn it off to stay on the card shown.
- **A restore on the Board says what it cost**: when a save no longer fits the build exactly, a note names the properties dropped or reset and counts the cards that left their hands.
- **The Board's journal Copy takes what the journal shows**, with the same quotes and the same rows.
- **Camera moves ease.** Fit everything, fit the selection, back to 100%, centring on a comment from the review walk, revealing an arrangement that landed off screen and returning to a pin on the map now travel there over a quarter of a second, rather than jumping. Your own pans and zooms, and a canvas reopening where you left it, stay instant, and none of it moves under Reduce motion.
- **Delete in the map's Edit layout takes the selected pin, zone or picture off the map**, as its right-click Remove from the map does, in one undo step each. A picked corner of a zone is still what Delete removes when one is picked.
- **Arrange has no single-letter key any more.** It is the Arrange button and the canvas's right-click menu; L did it before, and the family keeps no bare-letter shortcuts.
- **The canvas's keys act on the canvas only when it is yours**: Cmd+A, Delete, F, Home and the zoom keys work while you last clicked on the canvas, or the pointer is over it with nothing else focused, and no longer reach through to a deck canvas while you're in the navigator.
- **One cursor at a time on the canvases**: the hand while Space is held or a pan is under way, then what the pointer is over (an open hand on a card or a frame's bar you can drag, a resize arrow on a picture's corner, a pointer on a comment), then the armed tool's crosshair.
- **A small wobble is a click everywhere**: dragging a card, panning and sweeping a marquee all start at the same three pixels. Shift or Cmd adds to the selection for a sweep as it does for a click, and Ctrl-click on macOS opens the menu, as right-click does.
- **A comment's hover line is the app's own tooltip**, naming who wrote it.
- **The zoom controls no longer fade** as the pointer crosses the canvas; they dim and brighten at once.
- **A frame's name gives way below 60% zoom**, with the name in the hover tip there, rather than shrinking out of its bar.
- **Arrange lays cards out on the grid**, so a card dragged afterwards snaps in step with its neighbours.
- **Zooming a large canvas is two to three times cheaper**: a card, a pin or a frame is redrawn only when the zoom crosses the point where it shows or hides its name, and a placed, locked picture on the map is no longer redrawn while a pin is dragged.

### Fixed

- **Switching back to Storyletter no longer moves you.** The window used to redraw everything on focus, which dropped the caret, scrolled the navigator to the top and rebuilt a deck's canvas. Now nothing redraws unless a file changed on disk, and then only the navigator and the problems bar, and the open document only if its own content changed. A redraw of the document you're in keeps its scroll and the field you're typing in.
- **Deleting several cards is one undo step**, as the question always promised, even when a box's Contents selection spans several decks. It was one step per card.
- **Delete works on a card in a box's Contents tab**, from the right-click menu and the Delete key.
- **The Story page saves like every other document**, so the save indicator, Play and Close see its edits.
- **A problem opens the box it is in.** A box whose name appeared inside another box's folder path could claim that box's problems.
- **The arrow keys no longer redraw a deck's canvas** in node view.
- **A save that version control refuses changes nothing.** A batch of files is now written whole or not at all, and nothing is deleted unless the writes landed: renaming a deck whose new file was refused used to delete the deck, with nothing to undo. The message names the file and, where a lock is the reason, who holds it, and the project in the editor stays as the files say.
- **Undo and Redo say when they can't write a file**, and keep the step so you can try again.
- **Edits made while a push to a server is under way still count as unpushed** once it lands.
- **Making a map is its own undo step.** It used to join the tag group edit before it, so one undo took both, and Create map is now one step rather than two.
- **Deleting a hand takes its pin off the map in the same undo step**, rather than leaving a pin for a hand that is gone.
- **Deleting a tag group that cards still use is refused**, saying how many cards carry it, as deleting a deck with cards in it is. Deleting something that has already gone says so rather than adding an empty undo step, and no message shows an internal id.
- **Update prompts go to the editor window**, which is the one that answers them. With the Board or Find in front, a prompt waited five minutes and answered itself.
- **A coverage test still running when you open another project is stopped**, and its report is not shown for the new one.
- **Importing a session save into the Board reads older saves** that the engine still loads.
- **Live Link refuses a connection from a web page**, by Patterpad's rule: a game that sends no origin (Unity, Godot) or a loopback one (Unreal's bare address, a browser game on a local dev server) connects; any other site, a sandboxed frame, and a name that only resolves to this machine are turned away.
- **The Live Link chip reads "Live Link"**, capitalised as in the menus.
- **Links follows again** after a project change, and an explicit Links… on a card always lands, even after you walked the graph. It used to keep showing the old project's cards.
- **Links keeps its pan, zoom and selection** while the editor redraws. It used to rebuild its canvas and fit it on every editor render.
- **Escape during a marquee in Links abandons the marquee** instead of closing the window.
- **Coverage's Run and Add coverage drivers are disabled while a sweep runs.** A second click used to start a second sweep, and a sweep that finished after a project change showed the old project's report.
- **Coverage refreshes its drivers note when you come back to it**, and keeps its scroll position across redraws.
- **The Board's Live mode no longer paints the game's cards with your local session's run marks.**
- **A failed play on the Board clears on the next thing that works**, rather than staying until a rebuild. Snapshots no longer carry over to another project.
- **The Board's map**: clicking a pin no longer clears the zone filter, a click redraws once, not twice, and another box's or group's map is framed whole.
- **The Board keeps the keyboard where it was** across its redraws, and a hand's header can be reached and selected from the keyboard.
- **The Board stays linked to Patterpad after a rebuild.** It used to drop a working link and reconnect every ten seconds.
- **Locked outcomes and Live mode's playthrough picker use the themed tooltip**, not the system's.
- **A map picture scaled by its corners redraws at its new size** straight away, and a picture you moved stays put when you show or hide a layer. Both used to be saved but not shown, until something else redrew the map.
- **A marquee round the cards inside a frame selects the cards, not the frame**: a frame is selected from its title bar, by a click or a sweep. And when a selection does hold a frame and cards, the frame goes only once the cards' delete is confirmed; cancelling used to keep the cards and lose the frame.
- **Clicking a comment marker with a tool armed opens the comment** without also dropping a pin, a corner or a new comment where you clicked.
- **Dropping a comment on a pin goes by the pin's dot**, as clicking it does, so a comment dropped just beside a pin no longer files itself against it.
- **Another project's pictures and camera no longer show through.** A map picture or a remembered view from one project could appear in another that used the same names, as the examples do; a picture that failed to load is looked for again the next time the map opens, and a picture replaced on disk under the same name is shown afresh.
- **Reading the map no longer renames a frame** on a double-click, and a frame name being typed when the canvas redraws is kept.
- **Space held while switching to another app no longer leaves the canvas panning** on the next click.
- **Select All (Cmd+A) selects the canvas's cards when you're working on the canvas**, and otherwise the text of the field you're in, never the whole window. The menu's built-in Select All took the key before the canvas could, as Patterpad found.
- **The playable page you publish credits Storylet Studio again**, and a project without a name is "A Storylet Studio project" there. 0.18.6 changed both to Storyletter in error: Storylet Studio is the whole (the format, the engine, the editor), Storyletter the editor alone.
- **The Board says what happened when the editor's project changes under it**: "Another project was opened in the editor. Restart to play it." or "The project was closed in the editor. Restart to clear the Board.", where it used to call either one a change to the project.
- **Coverage remembers when its report ran** in the app itself, so "Ran 5 minutes ago" and "The project has changed since" survive closing the window, and are right after Add coverage drivers.

## [0.18.8] - 2026-10-06

### Fixed

- **Each dialog keeps its own width however the app's styles load** (`@wildwinter/app-shell` 0.46.4). The dialog frame's default width could override a dialog's own when the built styles loaded in a different order, which opened Patterpad's New Project at the width of an ordinary dialog; Storyletter's dialogs are now guarded against the same.

## [0.18.7] - 2026-10-06

### Fixed

- **"+ Add group" asks for the group's first two conditions.** It used to insert a group starting with a condition you hadn't chosen and an empty second half, which the problems list then flagged. Now you pick both conditions through the usual condition menu, and the group is added only once both are chosen; cancelling at either step adds nothing (`@wildwinter/expr-editor` 0.16.1).

## [0.18.6] - 2026-10-06

### Changed

- **Publish Bundle refuses a project with a load error**, naming the file that would not load. A file that did not parse used to be left out and the rest published, so the bundle shipped without that deck's cards. Publish Playable HTML refuses it too.
- **Live Link sends nothing into a running game while the project has a load error** or does not compile, and the Live link chip's tip says why. The game keeps the build it has until a save fixes it.
- **The playable page you publish says Storyletter**, not the retired name, under the project's title.
- **A Storyletpack lands only what a pack is for**: shards, pictures in the project's `assets/` folder and the game's scopes files. A pack carrying anything whose path starts with a dot (a `.git/config`, say) is refused whole, and any other file it carries is left out rather than written.
- **Merge Returned Storyletpack rewrites only the files the merge changed.** A shard that comes back saying what it already says is left exactly as it is on disk, as a pull from a server already did.
- **The files a new project starts with say Storyletter**, not the retired name, and its project file is written last.
- **Find and Replace covers the project map's group** as it does every box's groups.
- **Two decks can no longer share a name anywhere in the project**, as two cards, hands or boxes cannot: a deck's name is its address in a game, and the problems bar says which two files clash.
- **Coverage plays a card that has no outcomes**, as a game does, so a masthead or a notice no longer holds its hand's slot for the whole run and hides the cards behind it. It is still never counted as dealt and never played.
- **The Links window's observed links reach cards pinned to a hand.** The coverage run now looks hand by hand, so a card that only comes up at one hand can be seen opening: on the Village, 85 of its 86 cards, where it saw 14. A coverage run takes longer for it.
- **Coverage's "gated on state nothing sets" hint reads what decides whether a card is dealt**: its condition, its deck's gate and a computed priority, and no longer an outcome's gate.
- **Coverage names a hand whose own condition reads an @hand name it never has**, and an outcome that writes one, beside the cards that read one.
- **The Links window draws a write of exactly the threshold as enabling** a card that asks for at least (`>=`) or at most (`<=`) that much. It was drawn as disabling it.

### Fixed

- **Publish Bundle writes in the same order as the command line**: a map's pictures first, then the bundle that names them, so a picture that cannot be written stops the publish before a bundle lands without it.
- **Export Spreadsheet no longer freezes the app** when two deck titles share their first 31 characters. Their sheets are numbered, starting at 2.
- **New Box no longer writes over a box you have renamed.** A box keeps the folder it was made in, and that folder now counts as taken; a kit added twice also names its second copy's decks apart.
- **Two people moving different zones of the project map merge cleanly** in Merge Returned Storyletpack and a pull, instead of conflicting over the whole map.
- **A box called Assets is no longer mistaken for pictures**: its files are never swept away as unused pictures at the end of a session, and a pack carries it as a box.
- **The map upgrade never moves a background picture whose name points outside the box's folder**, and says so.
- **Opening a file that is not a Storyletpack says so**, rather than reporting the zip reader's error.
- **Coverage no longer stops when the engine refuses a play**, such as an outcome writing an @hand name the hand does not have. The refusal is listed among the run's warnings and the run carries on.
- **Coverage no longer reports warnings raised by its own look-ahead** for the Links window, such as Port Meridian's "@hand.patrolled is not declared", which no deal ever raised.
- **Validate no longer says a card can never be dealt because of @hand state**: every hand holds its own, so one hand's history says nothing about another's.
- **Validate's unset-flag warning counts `@y = set_flags(@x, +a)` as setting y's flag**, not x's.
- **New Deck, Duplicate Deck and Duplicate Box name a deck apart from every box's decks**, not only its own box's, so a second box's first deck no longer clashes with the first box's.

## [0.18.5] - 2026-10-06

### Changed

- **The Board performs Patter scenes on Patter's 0.19.0 runtime**, as Patterpad does, in place of 0.14.0: an option greyed out by its condition cannot be chosen, a choice whose every option is greyed out runs dry, and an option's prompt carries its tags. The playable page you publish carries the same runtime, and the Storylet Engine 0.11.1.

## [0.18.4] - 2026-10-06

### Changed

- **The Board runs the Storylet Engine 0.11.0**, with the shared expression kernel's fixes: a listener's error is no longer reported as a read-only refusal, and every listener hears each write once. The playable page you publish carries the same engine.
- **The Board's New run carries durable state through the engine's own verbs**, the ones a game calls: the player's pocket and the installation's memory are saved, the world restarts, and both go back in. A durable value whose property is no longer durable, or has moved between shared and per-player, now starts the new run at its default, as it would in a game.

## [0.18.3] - 2026-10-06

### Changed

- **The Board runs the Storylet Engine 0.10.0**, the October engine review: a play is all-or-nothing, so a refused write leaves nothing half-done; a shared one-shot taken in one playthrough leaves the others' hands at their next deal; a card whose deck moved to another box leaves its hand as vanished; and a priority that comes out as NaN is not dealt. The playable page you publish carries the same engine.

## [0.18.2] - 2026-10-02

### Added

- **The Why not? tab links into the editor.** A card's name opens the card, and its reason opens where the reason lives: "condition not met" lands on the card's When condition on its Dealing tab, lit for a moment, "deck condition not met" on its deck's When, and a full hand, a cooldown or a copy held elsewhere on the card's Dealing tab, where priority, redraw and copies are set.

### Fixed

- **Update prompts come to the front.** Check for Updates, and the prompt that says an update is ready, opened in the main window even when the Board or another pinned window was covering it, so the editor dimmed behind a prompt you could not see. The main window now comes forward, above pinned windows, until you answer, and the pins go back afterwards. A prompt that arrives while Storyletter is in the background waits until you come back to it. The "Update ready to install" prompt starts on Later, so a key pressed for the window it covered cannot restart Storyletter by accident.

## [0.18.1] - 2026-10-02

### Changed

- **The Why not? tab reads as a list.** The hand is a heading with its deal beneath it, each section counts its cards, and each card stands on its own with its reason indented beneath it, rather than one run of names and reasons in a monospace column. The cards under Not for this hand line up with the fold's title.
- **The Board model's unused peek is gone**, with the bookkeeping that kept its diagnostics out of the journal. Nothing in the window had called it since the Why not? tab replaced Peek.

## [0.18.0] - 2026-10-02

### Changed

- **The Board's Why not? tab replaces Peek.** Select a hand (click its name, its pin on the map, or open one of its cards) and the new tab beside Journal and State reads that hand's latest deal back: every card that could have come up there and didn't, with the reason, a full hand's near misses first, and the box's cards that were never meant for the hand folded away beneath. Because it is the hand's own deal, conditions that read the hand, its size and the copies held elsewhere all count, which a box-wide peek could not see. Live mode uses the same tab for the game's deals, in place of its "Not listed, and why" fold.

### Fixed

- **The Board keeps its place.** Opening a card, or selecting a hand, low in the list no longer jumps the list back to the top, and editing a value in the State tab no longer scrolls it away.

## [0.17.1] - 2026-10-02

### Changed

- **The Board's map shows each hand's card count inside its pin.** The number used to sit on a
  plate above the pin at a fixed size, so zoomed out it covered the hands beside it. It now sits
  in the disc, in whichever colour reads on that box's colour, and a hand holding more than 99
  cards shows 99+.

## [0.17.0] - 2026-10-02

### Added

- **One map for the whole project.** A project now has a single map, above its boxes, with a
  **Map** row in the navigator under Story. Zones are drawn once; each box that uses the map lays
  out its own hands on it, so a story box and a news box can share one town. Turn it on for a box
  with **Use the project map** on the box's page, and take it off from the box's **...** menu.
- **Layers on the map.** Each box on the map is a layer of its hands, in a colour of its own, with
  Zones and Pictures beneath. Hide or show a layer with its eye, use **Show all** and **Hide all**,
  or Option-click an eye to see that layer alone. **+ Hand** adds to the active layer and offers
  the box's kinds of hand by title. Hiding a layer hides its hands from the panels too, and the
  panel says how many are hidden. Your layers are remembered per project and never saved into it.
- **A hand opens on its cards.** Click a hand on the map, in the navigator or on the Board, and its
  **Cards** tab lists what can come up there: **Only here**, **Anywhere in** a zone, **Wherever**
  an npc or area is, and a count of the rest, with **+ New card here**. A card placed at a hand
  that can never deal it is shown with the reason.
- **Group by.** A box's Contents and a deck's cards can be grouped by deck, by hand, or by any of
  the box's tag groups, such as an npc or an act.
- **Upgrading older projects.** A project whose map belonged to one box opens with an offer to
  upgrade it, listing what will change. It's one step you can undo; where it can't go ahead, it
  says what to rename first.

### Changed

- **A card says where it comes up first.** Its Dealing tab opens with **Comes up at** a hand, or
  anywhere in a zone, **when** its condition, before When, Priority and Redraw.
- **Every property says whose it is.** On a project set to **Shared world**, each property reads
  "One value for every guest." or "Each guest has their own.", following its Shared box. A zone's
  property also says it is one value for every box that uses the zone.
- **"Hand" is the one word for where cards are dealt.** A hand's own kind (its template's title,
  such as "Places in the village") shows under its name.
- **This release includes the Electron 42.11.10 security update** from 0.14.2.

## [0.14.2] - 2026-09-30

### Security

- **Electron 42.11.10.** Storyletter runs on the latest Electron 42 release, which fixes several security
  problems in how Electron keeps windows and web content apart. Nothing else changes.

## [0.16.0] - 2026-09-30

### Added

- **A fourth example, The Hamlet (Patter Version).** The Hamlet's cards paired with a Patter project that holds a scene for each, copied side by side, so the Board plays each card's scene, **Edit Scene in Patterpad** works straight away, and Patterpad's **Show Card in Storyletter** finds its way back. It's offered on the welcome screen too, beside the Hamlet you start with, which has no Patter in it.

### Changed

- **Help ▸ Open an Example is first in Help**, above the documentation, since Help is where anyone looks for the demos. Patterpad's Open an Example sits in the same place.
- **The gameId chip drops its "Pinned" and "Auto" label**, as Patterpad shows it: an id still following the title reads faded, a pinned one plainly, and hovering says which.

## [0.15.0] - 2026-09-29

### Changed

- **The documentation has moved to [storylets.dev](https://storylets.dev).** The Help menu and the
  About box open the new address. The old one still forwards, so a link you saved keeps working.
- **Coverage leads with the cards it reached least.** The Coverage window opens on a table of
  every card, with the cards no run dealt at the top, then the rarest, down to the ones every run
  deals. Its columns have headings, **Runs dealt**, **Times dealt**, and **Times played**, and each
  explains itself on hover. A card is dealt before it's played, so the top of the window counts
  three things worth a look: cards never dealt, cards rarely dealt, and cards dealt but never
  played. A card dealt in fewer than 5% of runs is tagged **Rare**. A card dealt but never played
  has a tint of its own, apart from the never dealt. A never-dealt card still says why, where
  coverage can tell. A card with no outcomes shows **no outcomes** where the others show how often they were played.
  A switch puts the table in **Deck order**, and the window remembers your choice.
- **Coverage counts each hand out of the cards that could come up there.** The per-hand counts
  now sit below the card table, folded away. They used to count out of every card in the hand's
  box, so on the Village each place read something like 6/86, a nearly empty bar for coverage
  that was complete. A card pinned to another place, or tagged for another hand, no longer counts
  against this one, so a short bar is now a real gap. Each row names the hand by its title and
  shows how many deals it had, and the caption says the counts are over all the runs. A run that
  goes to the turn cap now reads as **ran to the turn cap**, which is normal for a story with
  branches.

### Fixed

- **Opening Coverage or the Board no longer logs an error.** Each opened its window and then tried to hand the window itself back to the editor, which cannot be passed between processes, so every open left "An object could not be cloned" in the log. The windows opened regardless; now nothing is left behind.

## [0.14.1] - 2026-09-28

### Fixed

- **Buttons in a dialog over the welcome screen work.** Clicking Close in the About box did nothing
  while the welcome screen was showing; Escape worked. The welcome screen lets you drag the window
  from anywhere on it, and those clicks were being taken as the start of a drag. Dialogs, menus and
  popups are no longer part of that area, wherever they open.

  **Updating from an earlier version:** the prompt that brings you this release still has the
  problem, if it opens over the welcome screen. If **Restart now** doesn't respond to a click, press
  Enter, or just quit Storyletter: a downloaded update installs when you quit.

## [0.14.0] - 2026-09-27

### Added

- **New Project and New Box show their kits as a gallery.** Pick a tile and the panel beside it
  says what the kit is for, what you'll see when you press Play, and what you get, before
  anything is made. Each kit carries a few tags naming what its game has, such as *Rising
  tension* or *City news*, so kits compare at a glance.
- **Seven new kits.** In New Project: **Map-based story**, a village on a drawn map whose first
  scene opens the rest of it, and **Action game**, five boxes on one city map (jobs, street
  encounters, finds, a codex and the news) where a job gone loud brings checkpoints and makes
  the news. In New Box: **Job board**, **Stash**, **Codex** and **News**, each cut from the Port
  Meridian example to stand on its own, and **Story acts**, beats that wait for their act.
- **The welcome screen shows the kits and the examples as tiles.** Pick one to open New Project
  on it.
- **Help ▸ Open an Example**, so the worked examples are a menu away from inside a project.
- **The examples are in New Project too**, as a second group beside the kits, with **Open a
  Copy** in place of Create.

### Changed

- **The box kits say what they are for.** RPG encounters is now **Encounters on a map**, and
  Dialogue topics **Conversation topics**; each leads with its use rather than with the parts
  of the model it teaches.

### Fixed

- **The Patter pairing's problems read as sentences.** "has a scene named ... but it hasn't been
  published yet" was shown as an expression that "doesn't hold up"; it and the pairing's four
  other problems now say what is wrong and what to do.

## [0.13.0] - 2026-09-26

### Added

- **The Board plays Patter scenes.** On a paired project, tick **Performed by Patter** on a box's
  Dealing tab, and opening one of its cards on the Board plays the card's scene: its lines, its
  choices (greyed when Patter's condition or the card's outcome is shut), then the outcome it
  reached, with Continue. Both engines share one set of properties, and a save or a restart
  carries Patter's part too. With Live Link on in Patterpad, the Board connects to it like a game:
  each save there updates the scenes it plays, and Patterpad's playhead follows the Board.
- **Create the scene in Patter.** A card in a box Patter performs that has no scene gets a quick
  fix that writes a stub scene into the Patter project (named after the card, its purpose as the
  first line, one option per outcome) and opens it in Patterpad. Until it's published, the
  problem is a reminder to publish.
- **Starter project with Patter**, in New Project: the starter project and a Patter project
  beside it, paired, the box performed by Patter, and a stub scene for each card.
- **Publish Playable HTML carries the dialogue.** On a paired project with boxes Patter performs,
  the page plays those cards' Patter scenes the way the Board does, from the Patter project's
  published bundle, still as one file that opens in any browser.
- **Performed by Patter also sharpens the check.** Only those boxes are checked, and a card in one
  with no scene of its name is an error.

## [0.12.0] - 2026-09-26

### Added

- **Pair a project with its Patter project.** Project Settings ▸ General ▸ Patter project takes
  the `.patter` folder whose scenes your cards play, saved in the project as a relative path so
  the whole team shares it. Each card is then checked against the scene of the same name in the
  Patter project's published bundle: a scene that names an outcome the card doesn't have, or a
  branch that can't say which of several outcomes it reached, is an error in the problems bar,
  and an outcome no branch reaches, or a scene no card plays, is a warning. `storyletengine
  validate` runs the same check.
- **Edit ▸ Edit Scene in Patterpad** opens Patterpad at the open card's scene, when the project
  is paired. If Storyletter can't find Patterpad it asks you to point to it once, and remembers.
- **Each outcome says how its Patter scene reaches it.** Expand an outcome on a paired card and
  an In Patter section names the option the player picks, in the scene's own words, or the
  gameEvent that fires it, or the scene ending for a card's only outcome.
- **Add the outcome a scene names, in one click.** When a paired scene names an outcome its card
  doesn't have, the problem offers Add outcome "…": the card gets an outcome with that gameId,
  pinned, titled from it, and it opens for you to finish.
- **A Working with Patter page in the docs**, for pairing, the check, and Edit Scene in Patterpad.

### Changed

- **Publish Bundle pins every game id that still follows a title.** A box, deck, card, outcome, hand or
  hand template takes its game id from its title until you pin one, so retitling a card after the game
  started dealing it moved the name the game calls. The first time an item is published, its game id is
  written down as it is, and a later title edit (or a Replace) leaves it alone. It is one undo step, and the
  confirmation says how many were pinned. New items still follow their title until they are published, so
  a card can be called "New Card" while you decide. Auto Rebuild, Live Link and `storyletengine export`
  never pin. Patterpad does the same for its scenes and blocks, so a card and the scene named after it
  stay paired.

## [0.11.0] - 2026-09-24

### Added

- **Share Scopes with Other Tools.** A new File menu command makes a `game-scopes/` folder (by default at the root of your repository) and writes the project's `@story` declarations to `storylets.scopes.json` and its `@world` to `game.scopes.json`, so Patterpad and the game's other editing tools can read them. Nothing makes the folder but this command.
- **Where the game shares its scopes, the editors know the other tools' properties.** The condition and outcome editors offer `@patter.visits` and the rest in the picker, each pill's tip saying who declares it, and a misspelt name is marked. A game's own scope such as `@player` can be named at all. Problems lists a reference its owner's file doesn't allow as a warning, never an error, since the other project may be a save behind.
- **Storyletpacks carry the game's shared scopes.** Where the game shares its scopes, Export as Storyletpack includes a read-only copy of the folder, and Open Storyletpack puts it inside the unpacked project, so the person you send it to gets the other tools' properties in their pickers and on their Board. Merge Returned Storyletpack never writes their copy back, but World properties they changed are written to your `game.scopes.json` too, in the same undoable step, and the confirmation says so; without that, your next save would have copied the old list back into the project. Landing a pack from a server works the same way for a new project, and a pull into a project you already have never writes the copy.
- **The Board plays cards that name another engine** where the game shares its scopes, standing that engine in from the defaults its file declares. The State tab lists those properties so you can set them, and Save state and Restore keep their values. Without the folder the Board still can't play such a project, and now says how to share scopes, or which file in the folder should declare the missing scope.

### Changed

- **Every save keeps `storylets.scopes.json` up to date** where the game shares its scopes, as Publish Bundle does, in the same undoable step as the save.
- **World properties are the game's** where the game shares its scopes: Project Settings reads them from `game-scopes/game.scopes.json` and writes them there first, keeping the file's other scopes, then copies them into the project, which keeps them so it still compiles packed or on its own.

## [0.10.1] - 2026-09-24

### Fixed

- **A card that reads Patter's properties is no longer called dead.** The problems list warned that `@patter.visits` "is read but nothing writes it, so every gate on it stays shut". Patter writes it, where the project cannot see, so it is now left alone, as `@world` always was.

## [0.10.0] - 2026-09-24

### Added

- **A card can name Patter's shared properties.** A condition can read `@patter.visits` and an outcome can change `@patter.gold`, with no project setting: every engine in the family knows the others' game-wide scopes. The editor draws such a property as an ordinary pill, with a tip saying another engine owns it and checks it, because Storyletter cannot know Patter's names. A published bundle records which other engines its content names.

### Changed

- **The Storylet Engine 0.8.0 runs the Board.** Its engine is the one games ship with this release: one property registry per game shared with Patter, the new save format (the Board still restores snapshots saved by earlier versions), and Live Link refreshes that work in a game where Patter and the Storylet Engine share one registry.
- **The Board says why it cannot play a project that names Patter's properties.** It runs the Storylet Engine on its own, so it cannot evaluate `@patter.visits`, and the engine now refuses such content rather than quietly reading false. The Board shows that refusal where the table would be, as it shows a build error, instead of failing without a word. Play it in a game that runs both engines.

## [0.9.1] - 2026-09-23

### Added

- **A key for the arrows, on the node canvas and in Links.** The green, red, amber and grey arrows between cards were explained only in the documentation. A quiet **Key** beside each canvas's status line now opens a panel of the arrows themselves, each drawn exactly as the canvas draws it, with the words the Links window uses: opens, shuts, changes what is true for, shares state with. After a coverage run it also shows what the run saw: seen, possible but never seen, and seen but not predicted. Both canvases draw the key from the same rule the arrows are painted by, so the two cannot disagree.

- **Hovering an arrow says why it is there.** "The Moneylender's Men opens Gareth's Gratitude", and under it the property that joins them and the outcome that writes it. The same words a selected link gets in the Links window, on both canvases. A card under the pointer still wins, and the tip goes as soon as you move, drag or zoom.

### Fixed

- **The Live link control no longer sits on top of the canvas strip or the problems bar.** It floats in the window's bottom-right corner, where **Arrange by links** ends and where a problem's message and its fix button end. Everything in that corner now leaves room for it, and the same fix reaches Patterpad, since the control and the bar are shared.

## [0.9.0] - 2026-09-16

### Changed

- **Every icon is drawn.** The editor, the Board, Links, Coverage, Find, and the settings dialog draw
  their icons from one set (Lucide, MIT licence) at one stroke weight, in place of the typed symbols
  that used to vary with the platform's font. Separators in tooltips and status lines are drawn too,
  and key hints say Ctrl on Windows and Linux and ⌘ on macOS.
- **Section captions are words.** Project, Places, Purpose, Story state, the welcome groups, and the
  rest read as sentence-case labels now. The card and deck tables' column heads keep their
  uppercase.
- **Buttons have edges.** Every button reads as a button at rest, with a border or a fill; segmented
  controls (Cards | Table | Node, List | Map, Find's tabs, a quality's ladder) are one bordered
  strip with the chosen option washed; one focus ring serves the whole window.
- **Dialogs share one frame.** Connect to a server, Push, the kit picker, confirmations, the update
  prompt, and About sit on the same panel with the same scrim and exit. About carries the
  wordmark, and its version line no longer clips under the frame.
- **The problems bar speaks plainly.** Every message the compiler can raise has its own sentence
  naming the card, deck, hand, or box it is about and where that lives, in place of the raw
  compiler string and `path [where]` fallback.
- **Copy tidied throughout.** Tooltips, notes, placeholders, confirmations, and toasts are plain
  sentences in UK English; placeholders say what to type in plain words; each confirmation that can
  be undone says so.
- **Small handling improvements.** After a drag, the moved cards, decks, boxes, or hands ease into
  place rather than snapping. In a deck, shift-click selects the run of cards from the last one you
  chose and ⌘/Ctrl-click toggles one. Pressing Escape in a title puts the old name back. A card's
  grip shows on keyboard focus as well as hover. The window appears once its first view is ready,
  rather than blank.

### Fixed

- **Merging a returned pack updates the navigation straight away.** After **File ▸ Merge Returned Storyletpack**, the navigation kept the names and structure the project had before the merge (a renamed deck showed its old name) until the window next lost and regained focus, while the project underneath was already the merged one. It now repaints as the merge lands, the way a window-focus refresh always did.

- **A card written without an `outcomes` key no longer breaks the project.** A deck shard whose card left the key out, rather than writing `outcomes: []`, made Find and the Story page's usage counts fail with `card.outcomes is not iterable`. A missing key now reads as an empty list when the project opens, which is what the format always meant by it.

## [0.8.0] - 2026-09-14

### Added

- **A card with no outcomes can be played.** On the Board, a card that declares no outcomes (a masthead, a notice, a codex entry) used to open to "This card has no outcomes." and nothing to press. It now has one **Done** button, which plays it straight away: it is counted as played, the clock moves and it leaves its hand, with nothing written. Its journal line reads `played "<card>"`, with no arrow and no outcome. A card whose outcomes are all locked still shows them locked.

### Fixed

- **Go to definition lands on the declaration, not only on its page.** Right-clicking a property pill and choosing **Go to definition** opened the page the property is declared on and stopped there: with a long list the declaration was off screen, and nothing marked which row was meant. The row now comes to the middle of the page, opens its details (an enum's values are behind the expander, and they are usually what you came for) and is lit for a moment. The page is still the same page, and the crumb bar's way back is unchanged.

## [0.7.0] - 2026-09-13

### Added

- **Outcomes carry fields of their own.** The box's **Card template** tab now has two lists: **Card fields**, as before, and **Outcome fields** below it, declaring what every outcome in the box may carry in the same shape. Fill them in the open outcome's new **Fields** block, between its purpose and its condition, with the same controls a card's Fields tab uses; a box that declares none shows no block. They are what an outcome hands your game once the press lands (the line to show after it, say) and cost no card. The tab's count is both lists together, a problem with an outcome field opens the outcome, and Find and Replace covers them.

### Fixed

- **A cleared field is no field.** Blanking a card field used to store an empty string, which for a boolean, enum or number field was a publish error nothing in the editor could clear: "(unset)" in the picker stored a string. A blanked field of either kind now drops its key, so the host falls back to the declared default, which is what a default is for.

- **The question on the way out is the app's own dialog now, and it answers correctly.** Closing the editor with edits the server had not seen asked in a system box attached to that window, whose close had already been held back: dismissing it let the close through whatever you had clicked, so **Cancel** closed the window and **Push to server** closed it without pushing. It is drawn where the Push dialog is drawn, in the same words, and Cancel now means cancel. A system box is still there for the case where the window cannot answer at all.

- **An author's key and a designer's key for the same server no longer overwrite each other.** Connecting a second project as a designer replaced the key the first project was using, so the author's project quietly became a designer's: its role flipped and the shape pages stopped being read-only. Keys are held per address AND role now, and a project uses the one its own role names. **Forget this server** forgets the key the open project uses and leaves the other job's alone; with no project open at that address it forgets the address.

- **The unpushed count is somewhere you can read it.** It was a suffix on the window title, which on macOS is never drawn: the title bar is the app's own topbar. "3 edits unpushed" sits beside the project name there instead, quietly, and says nothing at all while the project is level with the server.

- **The unpushed count is right, and it keeps up.** It was a running tally of edits, so it counted an undo and a redo as further edits (typing once and undoing it read as two, again as four) and it only caught up at whatever happened next. It is now the number of SHARDS that differ from the revision you last pulled, worked out afresh after every write: type and undo and it reads in sync again, edit one card ten times and it reads one, and the topbar, the Server menu and the window agree the moment the edit lands. Reformatting a shard is not a change, and a shard added or removed is.

- **The question on the way out names the project it is about.** It is asked at the one moment two projects are in play - opening one over another, which is how connecting to a server lands a pulled project - and it read as though it were about the one arriving. It now says "This Room: 1 edit unpushed" and "This Room has edits the server has not seen."

- **A push refused on the way out says so.** Pressing **Push to server** at that question on a project the far end will not take - a conflict, a project that does not build there, a key that may not change the shape - left you exactly where you were with only the problems bar as evidence, and the project you were opening never opened. The refusal is shown in the question itself, in the far end's own words, with one button: **Stay**.

- **A push from that question ends with a word of confirmation.** You are leaving, so the last thing you see is that the work is safe: the dialog turns into "Pushed as revision 12" for a moment before the window closes, the app quits, or the other project opens.

- **Connect asks where the project goes before it spends your code.** A code is single use, and it was exchanged for a key before the folder was chosen, so backing out of the folder picker cost you the code and left you with nothing. The folder is asked for first, a folder that already has something in it is refused before anything is spent, and only then is the code used.

- **A pull takes the venue's copy of the installation contract.** The pack carried the contract the server had just rewritten and the project kept the old one, so it went on validating against names no venue held, and the count in the toast was one short of the shards in the pack. The venue owns its own file: a pull now takes it whole, and says so - "16 merged, 0 added, 1 contract taken".

- **A pull no longer leaves a project reading "4 edits unpushed" with nothing edited.** Pulling re-sorted lists that are stored by name - a box's card fields, the project's own properties - and the unpushed count read the new order as an edit. Order is not a change: the count and the comparison behind it use the same normal form the merge does, so a pull into a project nobody has touched reads "In sync", and a shard the pull would only reorder is left exactly as it was.

- **"Nothing to push" is a passing remark, not a problem.** Pushing a project the far end already has said so in the problems bar, beside the things that are actually wrong with the project. It is a toast now. Problems that DO come from the server name their shard the way every other row does ("encounters/hands.storylethands") instead of carrying the whole path from the top of your disk, and a refusal is listed once rather than twice.

- **Opening another project clears the last one's server chrome.** The status beside the project name and the server's own problems belonged to the project you had just left, and stayed on screen until something else happened to redraw them.

- **Renaming a hand or a box a venue depends on updates its page as you type.** The line saying "Dealt at the-park", the dashed mark on the address and its tooltip all went on claiming the old name until you left the page and came back, while the problems bar next door had already caught up. And under a key that may not change the shape, the address chip no longer invites a click it will not answer.

- **Dragging a zone outline no longer rewrites what hands chose.** Moving a zone on a box map moved the outline as asked and also stripped the zone from the hands it had left behind, one of them losing its whole `chosen` block, with no warning and the project left invalid. Geometry is geometry: moving, reshaping, restacking or drawing a zone writes the tags shard and nothing else. A hand's zone changes when you drag that hand's pin, which is the gesture that means it.

### Changed

- **"Venue" says where it came from rather than naming a product**: the Play field reads "Venue (set by the server this project came from)". A hand a venue depends on says "Dealt at the-park" in its page header, in place of a sentence about what deals it.

- **The map is its own shard now, and the node canvas is the author's.** Where a box's hands stand has moved out of `view.storyletview` into `map.storyletmap` beside it (design/engine-server.md 9.1 point 5): a site ships in the bundle and is where a screen or a kiosk stands, so it is the shape, while a deck's canvas never leaves the project folder. Opening a project written before the split changes nothing on screen; the map moves itself the first time you touch it, in the same undo step as the edit that moved it, and never goes back. `storyletengine format` moves a whole project at once. The compiled bundle is unchanged.

  Under an author's key that settles which canvas is read-only: **the node canvas is yours to arrange**, and the map is the designer's, refused with the same sentence as the rest of the shape.

### Added

- **File ▸ Connect to a server…**, which asks for an address and a code. With both, the project is fetched and opened, and a **Server** menu appears for that project with Pull, Push… and a line saying where it stands. Pull takes the latest into the project by id, leaving `.storyletconflict` sidecars where the two disagree; Push sends it back and shows what came of it. Edits the far end has not seen are counted in that line and in the window title, and the app asks before quitting or closing over them. A project that did not come from a server has none of this.

- **Push asks first**: a note for the revision list, and, when the far end refuses because the change breaks something it depends on, one tick per refusal in its own words before it will send again. Under a key that may not change the shape, the shape pages open read-only with the reason on them, instead of letting an edit start and refusing it on save. A `.storyletpack` opened from the desktop makes the same offer File ▸ Open Storyletpack makes.

- **The Address field takes a whole link as well as an address.** Paste the link you were given and the code fills itself in; you can still edit it. A link that names the certificate at the other end pins it, and one quiet line under the field says so. Every call after that - pairing, Pull, Push - refuses an address answering with a different certificate before it sends anything, with a plain sentence rather than a warning to click through. An address with no certificate to pin works exactly as it did and says nothing about it.

## [0.6.0] - 2026-09-06

### Added

- **A venue's claim on an entity, said once and quietly** (design/engine-server.md 4.11). When a project carries an installation contract - the file a Storylet Server writes to record what a venue depends on - the hand or box it names says so in its page header: "Bound at the-park: a station deals this hand", "Ticked at the-park every 60s", one line per installation. The game id field beside it is marked and carries the same sentence as its hint; it is not refused, because the refusal is the server's on push, and a rename field that simply would not type would leave a designer with no way to see why. A project with no contract - which is every project, until a server exists to write one - shows nothing at all. Breaking a contract is an ERROR in the problems bar like any other, naming the venue.

- **Play, in Project Settings > General**: one setting that decides how much of the app a project shows (design/engine-server.md 4.10). Two rungs are offered. **Solo** is one player and one playthrough, and hides every sharing control; **Shared world** adds Shared on declarations and decks, and the Shared choice and In the world on cards. Hidden means ABSENT, not greyed out: a solo author has no Shared checkbox to read past, and the Play field's own note is where the ladder is explained. Moving DOWN a rung is refused while the project uses what the rung would hide, with the list of what is in the way ("3 declarations are shared"), counted by the same compiler check that raises the matching validate warning. New projects land on Solo.

  A THIRD RUNG EXISTS AND IS NOT OFFERED. A project seeded by a Storylet Server carries `play: "venue"`, and Storyletter honours it: the field shows it, reading "Venue (set by a Storylet Server)", the note says the server set it, and an author may move down from it under the same refusal. It cannot be chosen from Solo or Shared world, and nothing else in the app names it.

  A timed box and a hole filled from a property are NOT governed by any of this. They are engine features any game may want, so the box page's Turns section and the hole picker's "from a property" show in every project, Solo included.

- **Durable, beside Shared**: a declaration editor gains a Durable checkbox, the deck page gains one on its Dealing tab, and the card page gains the same three-state control Shared has (design/engine-server.md 4.2). On a card it is offered only when Redraw is **never**, since nothing else can survive a run. Shown only on a project a Storylet Server set to venue, since the run boundary that lifts and restores durable state is the server's; a durable flag in a project below that rung is a validation warning saying to remove it, and the control it is removed with is drawn wherever the flag already exists, whatever the rung.

- **Shared, on a declaration**: the checkbox the flag never had, on every declaration list except `@world`'s, where the flag is a compile error. Shared-world projects and above.

- **The Board's New run and Forget everyone**, replacing Restart on a project a Storylet Server set to venue. **New run** is the next day: everything run-scoped resets - state, boards, cooldowns, clocks and the journal - and everything durable stays, so a designer can play a party who have been here before. **Forget everyone** is the restart, under the name that says what it costs, and asks first. Neither touches `@world`, which is the game's.

- **A hand's hole filled from a property** (design/engine-server.md 4.6). On a hand's Bindings, beside a tag and "the instance chooses", a hole may be filled **from a property**: a picker of the string and enum declarations this hand or its template carries, and the `@story` and `@world` ones. The engine resolves it at ask time, so moving the Elder to the forest is one `setProperty("hand.the-elder.zone", "forest")` from a host or the Board and the next deal follows. The compiler checks the reference the way it checks `boundBy`, and a value naming no tag leaves the hole unbound with a diagnostic rather than an empty hand.

- **A box that counts in time** (design/engine-server.md 4.8). The box page's Turns section chooses between "a play" and "every N seconds of play". In a timed box the card editor labels `redraw` in the box's unit and converts as you type ("30 turns, half an hour"), and the Board shows the unit beside the counter with its advance buttons scaled to it. A play in a timed box advances nothing unless the call says otherwise; the host ticks the clock.

### Changed

- **The Board's state strip addresses every value by gameId** (design/engine-server.md 4.4), the way `listProperties()` prints it, and where a tag's name repeats across boxes the row carries the box: `harbour/docks.danger` beside `cellar/docks.danger`, so two rows reading "docks.danger" cannot be confused. A tag named only by its title no longer reads "undefined" in the strip.

### Fixed

- **A declaration edited in the app no longer loses its `shared` flag.** The flag was not on the editor's declaration DTO at all, and a property list saves whole, so opening any list that held a shared declaration and saving it deleted the flag from the shard.

- **The card editor's live time conversion was never visible.** It was drawn at opacity 0 and revealed by a section the card panel is not inside, so nobody saw "30 turns, half an hour" until a launch pass looked for it.

- **The box page's consequence sentence overlapped its panel** by four pixels.

## [0.5.0] - 2026-09-04

### Added

- **Read-only switch on the World list** (Project Settings > World, behind the row's expander), as Patterpad has it: ticked writes `writable: false` on the declaration, the story's promise that only the game moves the value; the compiler refuses a card that writes it and every runtime refuses one at run time. Unticked deletes the key.

### Fixed

- **Publish defaults beside the project, never inside it.** A new project's bundle path is `../storylet-dist/<name>.storyletsc`, and a project that pins none publishes there too; it was `dist/` inside the `.storylets` folder, which is the document. Patterpad's `../patter-dist/<name>.patterc`, name for name. The shipped examples now say the same.
- **The Read-only flag survives a save.** 0.4.0 did not know the key, so saving Project Settings on a project whose file declared `writable: false` silently dropped it; the flag now rides shard to dialog and back, pinned by a round-trip test.
- **The Purpose field behind a property's expander fills its line** instead of the browser's default twenty characters.

### Changed

- **The state strip names the box when two boxes name a tag the same way** (design/engine-server.md 4.4). A tag's name only has to be unique within its group, and a group's within its box, so a harbour box and a cellar box may each have a `docks`. The engine addresses such a tag by box - `value.harbour/docks.danger` - and refuses the short form, so the strip shows and pokes that address, and the row's label carries it too: two rows both reading "docks.danger" would leave a designer changing one and watching the other. A project whose tag names happen to be unique is untouched. The label is now the tag's effective name rather than its pinned one, so a tag named only by its title no longer reads "undefined.danger".

- **Project Settings: Export is now Publish, under Project**, where Patterpad has it (Project Settings > Project > Publish), so the two apps read the same. The project file's `export` block is unchanged.
- **The toast is the shell's** (`@wildwinter/app-shell` 0.37.0): one drawing for Patterpad and Storyletter, bottom-right, with an `ok` kind; `flash` and `flashError` are unchanged for callers.


## [0.4.0] - 2026-09-01

### Changed

- **A bare condition now passes on a non-empty string or flag list**, not only on a boolean or a
  number. `@story.mood` where mood is `"tense"` used to be false; it is true. The engine had
  admitted only booleans and numbers while Patterplay admitted all four, and the two share a
  property registry, so the same value read from the same place answered the same condition
  differently depending on which engine asked. A condition of yours that quietly never fired may
  start firing, which is the answer it should always have given.

- **A condition comparing flags no longer depends on the order they were added.**
  `@f == [red, blue]` matches a value built as `+blue` then `+red`. A flags value is a set; its
  stored order was an artefact of the order somebody happened to write the outcomes in, which
  Storyletter never showed you.

- **Numbers render as the language says everywhere.** Large and fractional values printed
  differently in the editor and in the four runtimes; they now follow one rule, pinned by a shared
  conformance corpus that all four are tested against.

- The expression engine is now `@wildwinter/expr`, one implementation shared with Patterplay
  rather than a copy per project, so a fix lands once instead of twice.


## [0.3.2] - 2026-08-31

### Fixed

- **The shipped examples tracked the story's act as plain text.** The Village
  declared `act` as a string and The Hamlet as an enum, when an act is an ordered
  ladder and both are unordered types. Neither project was broken by it, which is
  the problem: an example is a teaching surface, and these two taught the wrong
  shape for the most obvious quality a story has. Both now declare `act` as a
  **quality** with its acts as stages.
- **Every act gate had to name an exact act.** Because the old types could not
  express "at or past", thirteen conditions in The Village read
  `@story.act == "act-2"`, which would silently stop firing the day an act-3 was
  added, and The Hamlet said `@act != "arrival"` for "after you have arrived".
  They now read `>= "act-2"` and `>= "act-1"`, and outcomes advance the ladder with
  `advance(@story.act)` rather than naming where they land, so inserting an act
  routes existing play through it.
- **A condition that could never do anything.** The Village's ambients deck was
  gated on `(@story.act == "act-2") && (@story.act != "act-1")`, where the second
  clause cannot change the answer. It is a single `>=` now.
- **The Hamlet's elder could summon you before you arrived.** Answering Bryna's
  summons was gated only on having met the innkeeper and the blacksmith, and both
  of those cards are ungated, so the whole of act 1 could be skipped. It now also
  requires that you have come through the gate.

## [0.3.1] - 2026-08-31

### Fixed

- **About said Storyletter was part of PatterKit**, and linked to that project's
  website. Both lines were carried over from the sibling app when this one was
  started and never changed. It now says Storylet Studio and links to
  [storylet.studio](https://storylet.studio). Nothing else was affected: the Help
  menu's own documentation links were correct already.

## [0.3.0] - 2026-08-31

### Changed

- **Maps are findable.** The Maps tab used to appear only after you had made a map,
  so the word was nowhere in the editor until you already knew that maps live inside
  tag groups. The tab is always there now, and a box with no map yet shows what one
  is and offers to make it.
- **`+ New map`** sits beside `+ New tag group`, and makes the group and marks it a
  map in one step. A box that has maps names them in its Contents list.
- **The switch on a tag group reads "A map"**, where it read "A place". Two things
  were wrong with the old word: the group was called a place while its tags are
  zones, so the Village was "a place" and the forest a "zone"; and it said geography
  when a map does not have to be geographic.

### Added

- **A map does not have to be a map of anywhere.** Any two-dimensional layout of a
  tag group works: act structure with the beats available in each act, a cast and who
  is close to whom, a tech tree. The engine never knows the difference, because a
  zone is a tag whichever way you drew it, so an act map and a village map compile to
  exactly the same thing. Said now in the editor and on
  [the Maps page](https://storylet.studio/storyletter/maps/).

Nothing about the format changed. Existing projects open unaltered, and a map still
adds nothing a runtime reads.

## [0.2.0] - 2026-08-31

### Added

- **Check for Updates now works.** The Help menu item has been present and greyed
  since the shell's menu spine landed, on the rule that a disabled item says "not yet
  here" where an absence says "does not do that". It was waiting on a release feed,
  and 0.1.0 published one. Storyletter checks shortly after launch and every six
  hours, downloads on your say-so rather than behind your back, shows progress in a
  themed dialog rather than a system one, and asks before restarting if you have
  unsaved work.

  **If you are on 0.1.0 you will not be offered this one**, because 0.1.0 has no
  updater to offer it. Download 0.2.0 once by hand and it updates itself from then on.

### Fixed

- **Two false "this card can never be dealt" warnings.** The reachability check
  argues that one latch can only become true after another, which is only sound when
  becoming true requires something to have written it. It was making that argument
  about state that needs no writer at all: a property whose declared default already
  holds it, a property written somewhere in a shape the check cannot read, and a
  `@world` ref the game owns and can change in either direction whenever it likes.
  All three could report a perfectly playable card as impossible, which is the one
  mistake this check must never make.

## [0.1.0] - 2026-08-30

The first public release.

### Added

- The Storyletter editor: design storylets as cards in decks, set up the box they live in,
  declare the hands your game deals, and edit it all directly on the plain files on disk.
- Structure and logic: boxes, decks and cards, tag groups, hand templates and hands, a guided
  condition editor over the five scopes (`@world`, `@story`, `@box`, `@deck`, `@hand`), outcomes
  with effects, and qualities as ordered ladders of named stages.
- The Board: deal a real hand from the same runtime your game ships with, see the ranked result
  with a line-by-line trace answering "why this hand?", play outcomes, peek the stock, poke state
  and advance turns. Live Link streams a running game's state into the editor.
- Two canvases: a node canvas per deck showing how cards reach each other, and a map view where
  zones are drawn outlines, hands stand where they stand in the world, and background pictures sit
  behind them. Frames and stickies on both.
- Coverage testing: seeded playthroughs reporting what your content can actually reach, per hand,
  with never-dealt and never-played called out, an overlay that puts the last run on the canvases,
  and a quick-fix for content gated on state nothing writes.
- Review and documentation: threaded comments anchored anywhere, a Review Feedback walk over every
  thread in the project, and per-class documentation notes.
- Publishing: compile the `.storyletsc` bundle your game loads; publish a single-file playable HTML
  page that needs no server, install or programmer; export the project as a readable workbook; and
  send a whole project as one `.storyletpack`.
- Project plumbing: version-control awareness (git, Perforce, Plastic, SVN) with lock-aware saves,
  file associations, go-to-anything search, and undo across every edit.
- **Packaging.** electron-builder configuration, the macOS and Windows icon pipelines, hardened
  runtime entitlements, and a tag-driven release workflow, all following Patterpad's shape.
  macOS builds are signed and notarised; Windows is deliberately unsigned, because a signed
  Windows build writes its publisher into `app-update.yml` and every auto-update then fails
  verification.
- **File associations.** On macOS a `.storylets` project is a PACKAGE, so Finder opens it as one
  document rather than a folder to wander into; `.storyletsc` and `.storyletpack` get their own
  document icons. On Windows and Linux, where there is no package concept, the `.storyletproj`
  file inside the folder is associated instead, along with the shard types.
