---
title: Reviewing
description: Threaded comments on any item, dropped on a canvas as markers, and a walk that steps you through every open thread one at a time.
sidebar:
  label: Reviewing
---

Every item in a project can carry a **comment thread**: the project, a box, a deck, a
card, a hand, a tag group, an outcome. Comments are stored with the project and travel
through version control like everything else; they never go into the bundle your game
loads.

There's no separate review mode. Feedback lives on the thing it's about, and a walk
gathers it up when you want to work through it.

## Leaving a comment

Wherever an item shows its heading, there's a comment button beside it: a bubble carrying
the number of **open** threads. Click it and the thread opens anchored to what it's about.

Messages are signed with the name you gave on first run. Change it under **User
Information…** (in the Storyletter app menu on macOS, or the File menu on Windows and
Linux). It belongs to you, not the project, so it isn't stored in the project files.

## Resolving and deleting

Mark a thread **resolved** when it's dealt with. That hides it from the walk without losing
it; **Review ▸ Show Resolved Comments** brings resolved threads back into view.

You can delete a single message. Delete the only message in a thread and the thread goes.
Delete one message from a longer conversation and a marker is left saying something was
withdrawn, so the replies still make sense. Either way the deleted text is gone from the
file.

## Markers on a canvas

On a deck's [node canvas](/storyletter/node-canvas/) or a box's [map](/storyletter/maps/),
**Comment** in the strip drops a thread onto the drawing itself. Click where it goes; the
marker is a small pin you can hover to read and drag to move.

Drop a marker on a card (or, on a map, on a site) and it sticks to it: move the card and
the comment moves too. Drop it on empty canvas and it stays where the canvas is. Dragging
a marker onto or off a card switches between the two.

## The walk

**Review ▸ Review Feedback** (`Shift+Cmd+R`) turns on a bar along the bottom that steps
through every open thread in the project, one at a time:

- **F8** next, **Shift+F8** previous. The walk loops.
- The bar names what the comment is about and who wrote it. Click **Go to this comment**
  and the editor opens the item and its thread.
- If there's nothing open, the bar says "No open comments."

Stepping the walk takes you to each comment, but it won't take a document away from you
mid-edit: an unsaved change keeps its focus, and the bar moves without you.

There's no writing status in the editor yet (no per-card "draft / needs review / final"
state). If you need one today, a tag group is the way to model it.
