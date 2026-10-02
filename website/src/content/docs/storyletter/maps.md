---
title: The project map
description: Draw one map for the project, put a box on it, lay out its hands in the zones, and read what can come up at each hand.
sidebar:
  label: The project map
---

A project has one map. You draw its zones once, above the boxes, and every box that uses
the map lays out its own hands on it. Pick a hand on the map and you see the cards that can
come up there. Pick a zone and you see its properties and everything every box has in it.

<figure class="doc-shot">
  <img src="/doc-images/Map.png" alt="The Village example's project map in Storyletter, the Map row selected in the navigator: illustrated zones laid out on the canvas, each an overhead picture with its outline traced over it, and the box's hands standing as named pins inside them in the box's colour. The Inn is selected, and the side panel on the right lists the cards that can come up there." />
  <figcaption>The Village example's map: zones with a picture behind each outline, and the box's hands pinned inside them. The Inn is selected, so the side panel shows what can come up there.</figcaption>
</figure>

The map is made of three things.

- **Zones** are the regions you draw: the village, the forest, the docks. They belong to the
  project, so every box on the map sees the same ones.
- **Hands** stand on the map as pins. Each box lays out its own, so a box of conversations
  can stand its hands in one part of town while a box of news screens stands its hands in
  another.
- **Pictures and frames** sit behind the zones, for you to trace over and to label parts of
  the map.

A box that has no use for a map never sees it. Tags still sort its cards by character, by
act, or by anything else you like, with or without a map (see
[Group by](/storyletter/cards/#group-by)).

## Making the map

The map is a row of its own in the navigator, **Map**, between **Story** and the boxes, with
a count of its zones. It appears once the project has a map. Its page says which boxes use
it, then shows the map with the side panel beside it.

To make one, open a box and click **Make a map**, the quiet line under the box's purpose.
**+ New map** on the box's **Tags** tab does the same. Either makes the map's zone group,
puts the box on the map, and opens the zone group's page, where you name the group and
declare its zones. A box tag group you already have becomes the map when you switch on
**A map** under Map on its page; its tags become the zones.

A project has one map, so these are offered only while it has none.

## Putting a box on the map

A box joins the map from its own page. Click **Use the project map**, the line under the
box's purpose. The box gains a **Map** tab, first among its tabs, and opens on it unless you last chose
another tab on a box's page. The tab lists where
this box's hands stand, and **Open map** takes you to the map itself.

A box on the map wears a small map mark in its colour in the navigator, so you can see which
boxes are on it without opening anything.

To take a box off, use **Leave the project map** in the box's heading menu. Storyletter
won't do it while anything in the box still uses a zone: a hand standing in one, a hand
template that binds or chooses one, a card filed to one, or a condition or change that reads
a zone's property or play history. It says what is in the way and offers to open it. Once
nothing is, it asks before taking the box's pins off the map.

## Reading the map

The map opens for reading. Nothing can be dragged until you choose **Edit layout**, so
looking at the map never moves a hand by accident.

**Click a hand** and the side panel shows what can come up there: the same lists as the
hand's own [Cards tab](/storyletter/box-setup/#what-can-come-up-at-a-hand), with **+ New
card here** at the foot and **Open** to go to the hand's page. Under the hand's title is the
kind of hand it is, in your own words: its template's title, such as "Places in the
village".

**Click a zone** and the side panel shows:

- **Used by**, the boxes that have something in the zone.
- **Properties**, what every zone on the map carries, with this zone's starting value and
  who shares the value (see [Zone properties](#zone-properties)). **Edit** opens the zone
  group's page.
- **Hands in** the zone, box by box, each with how many cards come up only there.
- **Filed to** the zone, the cards that can come up anywhere in it, box by box, and **+ New
  card here**, which asks which deck and files the new card to the zone.

**Double-click** a hand to open its page, or a zone to open the zone group's page.
Right-click either for what it can do.

Zoom and fit are in the canvas controls: fit everything, fit the selection, zoom out, back
to 100%, zoom in. `Home` fits and `F` fits the selection. The full key list is on
[Keyboard shortcuts](/storyletter/shortcuts/#on-a-canvas).

## Layers

<figure class="doc-shot">
  <img src="/doc-images/MapLayers.png" alt="Port Meridian's project map in Storyletter: three zones, docks, strip and oldgrid, with hands from four boxes standing in them as pins in four colours. Above the canvas, Used by names Contracts, Encounters, Items and News. The Layers panel on the right has Show all and Hide all at the top, a row for each of the four boxes with an eye, a colour swatch and its hand count, Contracts highlighted as the active layer, then Zones and Pictures." />
  <figcaption>Port Meridian's map: four boxes share three zones, each box a layer of its own hands. The highlighted box is the active layer, where <strong>+ Hand</strong> adds.</figcaption>
</figure>

With nothing selected, the side panel is the **Layers** list. Each box on the map is a
layer of its own hands, and **Zones** and **Pictures** are layers too.

- **The eye** shows or hides a layer. Hiding a box's layer hides its hands on the map and
  its share of a zone's panel too, which then ends with one line, such as "and 5 from hidden
  layers (News)". Click that line to show them again.
- **Show all** and **Hide all** head the list. Hide all hides the boxes' hands and leaves the
  zones showing.
- **Option-click an eye** (Alt-click on Windows and Linux) to show only that layer.
  Option-click it again to put the others back as they were.
- **The active layer** is highlighted. **+ Hand** adds to it, so a new hand always knows its
  box. Click a layer to make it active. Selecting a hand on the map makes its box active
  too.
- **Drag a layer** up or down to change the order. The top layer's pins draw over the rest.
- **The swatch** is the box's colour, which its pins wear on the map, on the Board and in
  the navigator. A box takes the first colour no other box on the map is using when it
  joins. Click the swatch to choose another.

What you show, hide and reorder is yours, remembered per project, and never written to the
project, so two people on one project can each look at the map their own way. The box
colours are stored in the project, so everyone sees the same ones.

## Editing the layout

**Edit layout** in the strip under the canvas opens the drawing tools, and **Done** goes back
to reading. In Edit layout the strip carries:

- **Zone** traces a new zone. Click to place each corner, then click the first corner again
  or press `Enter` to close it, and name it. `Esc` abandons the shape. Drag a corner to
  reshape a zone, drag the handle in the middle of an edge to add a corner, and press
  `Delete` to remove a picked corner.
- **Hand** adds a hand to the active layer, named on the button. Where the box has hand
  templates, the button first asks which kind of hand, listing the templates by title, then
  **Standalone**. Then click where the hand stands.
- **Picture** puts a picture behind the map to trace over. Drag it to move it and its
  handles to scale it. Right-click it to fade it, restack it, lock it in place so clicks pass
  through, hide it, or remove it.
- **Frame** draws a titled rectangle behind part of the map. It labels the map for whoever
  reads it and means nothing to the engine.
- **Comment** drops a comment thread on the map or on a hand. See
  [Reviewing](/storyletter/reviewing/#markers-on-a-canvas).

In Edit layout each layer row opens out to its contents. The active box lists its hands,
with any hand that isn't on the map yet marked **place**: click it, then click where it
stands. Zones lists every zone, with any zone not drawn yet marked **trace**. Pictures
lists every picture, which is the way to reach one you've locked.

## Hands and zones

Which zone a hand is in is the hand's own setting, on its **Dealing** tab: the zone it
chooses, or the zone its template fixes for every hand it makes. Its pin shows where you
put it.

**Drag a hand's pin into another zone and the hand moves there.** That's a real change to
the hand, and one undo step. In **Edit layout**, select a pin and the strip says what dragging it will do. A
hand whose template fixes its zone can't be moved this way, and a hand that doesn't use the
map's zones only marks a spot.

Zones can overlap. A market square inside a district is a normal thing to draw, so "which
zone is this hand in?" needs an answer, and the rule is that **a pin belongs to the
frontmost zone containing it, and to no other.** Frontmost is the one drawn on top. Drawing
one outline inside another doesn't make it a sub-zone, so a hand standing inside both
`village` and `the-inn` is in whichever is in front, and only that one.

The map marks what you can't see on a drawing:

- **A dashed ring** round a pin means it stands inside more than one outline. Hover it, or
  select it in **Edit layout**, to see which zones don't count. It's a note, not an error.
- **A solid warning ring** means the hand is in one zone and its pin stands in another, or in
  none. The game deals the hand in the zone it's in, not where the pin is. Drag the pin back,
  or into another zone to move the hand.
- **A hollow pin** is a hand nothing is binding to a zone. It marks a spot and no more.

With **View ▸ Coverage Overlay** on, after a coverage run, each pin is ringed by how much play
reached its hand. See [Coverage testing](/production/coverage-testing/#on-the-canvases).

## Zone properties

The map's zones are a tag group, and its properties are declared once, on the zone group's
page, for every zone. Each zone has a **Starts at** row for its own starting value. A
property like `haunting` or `danger` is then read on a card as `@hand.haunting`, the value
of whichever zone the hand is in, and an outcome that changes `@hand.haunting` changes that
zone's value and no other.

**A zone property is one value for every box that uses the zone.** A contract played at the
docks in one box and a news screen at the docks in another read and write the same
`danger`.

Whether that one value is also shared between players is the property's own **Shared**
tick-box, and each property row says which:

| Shared | Each row reads |
|---|---|
| off (the default) | One value for every box. Each guest has their own. |
| on | One value for every box and every guest. |

On a Solo project there's one player, so the row reads "One value for every box", and the
zone's panel points to **Project settings ▸ General**, where **Play** set to **Shared world**
brings the Shared tick-box in. See
[Play: how much of the app you see](/storyletter/workspace/#play-how-much-of-the-app-you-see).

**Play history stays with each box.** `count_played_in("zone", "docks")` in one box counts
only that box's own cards played in the docks, so a newspaper read at the docks in another
box doesn't count as something happening there. See
[Play history](/play/dealing/#play-history).

## Where the map is stored

| What | Where |
|---|---|
| The zone group: its zones, their outlines, the zone properties, the pictures and frames | `map.storyletmap`, at the root of the project folder |
| The pictures themselves | the project's `assets/` folder |
| That a box is on the map | `usesMap` in the box's `box.storyletbox` |
| Where a box's hands stand | the box's own `map.storyletmap`, which holds positions and nothing else |
| A box's colour on the map | the box's `view.storyletview` |
| Comments on the map or a zone | the project's `notes.storyletnotes` |
| Comments on a hand | the hand's box's notes |

Which zone a hand is in isn't in either map file. That's the hand's own setting, in
`hands.storylethands`, so two people rearranging pins can only produce a position conflict,
never a content one. [The shards](/format/shards/#the-project-map) has the details.

The engine never reads the drawing. The zones ship in the bundle because cards and hands
use them; the outlines, pictures and pin positions ship only when you export with the map.
See [The bundle](/format/bundle/#the-project-map).

## Projects made before the project map

Before October 2026 a map belonged to one box, and boxes that shared a map each kept a copy.
When you open a project like that, Storyletter offers to upgrade it.

<figure class="doc-shot">
  <img src="/doc-images/UpgradeProject.png" alt="The Upgrade this project? dialog in Storyletter, over the Village example: the map of village becomes the project map with five zones, box village is put on the project map, and five pictures are copied to the project's assets folder. It ends You can undo this, with Not now and Upgrade buttons." />
  <figcaption>The upgrade prompt lists exactly what will change before anything is written.</figcaption>
</figure>

The prompt lists what the upgrade will do: which map becomes the project map, which boxes'
copies are folded into it, and the boxes put on the map. Frames and comments move to the project;
pictures are copied to the project's `assets/` folder, and each box's old copies are tidied away
when you close the project. **Upgrade** makes the change as one step you can undo. **Not now** leaves the project
as it is, and **Upgrade the project…** on the problems bar brings the prompt back. Until you
upgrade, the map isn't drawn and the project won't publish or play.

The first box's map, in folder order, becomes the project map. Every other box's copy has to
agree with it. If a copy has a zone the first doesn't, draws a zone differently, declares
the zone properties differently, or starts a zone at a different value, the prompt says so,
one sentence per difference, and offers nothing but OK until you make them agree. A project
with two different maps is refused the same way, because a project has one map. So is a
group or tag in another box that has the map's or a zone's name, since those names now mean
one thing across the project.

`storyletengine format` does the same upgrade from the command line, and refuses in the same
sentences. See [format](/cli/#format).
