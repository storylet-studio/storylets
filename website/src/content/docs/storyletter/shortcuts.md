---
title: Keyboard shortcuts
description: "Every key Storyletter binds, in one place: the menus, the canvases, the tool windows, and how Escape backs out."
sidebar:
  label: Keyboard shortcuts
---

Shortcuts are shown for macOS (`Cmd`). On Windows and Linux, use **Ctrl** wherever you see
`Cmd`. Every menu key is also shown in the menu itself.

## Menu commands

| Shortcut | Action |
|---|---|
| `Cmd+N` | New Project |
| `Cmd+O` | Open Project |
| `Shift+Cmd+N` | New Card, in the deck you're in |
| `Cmd+S` | Save. Storyletter saves as you go, so this flushes anything still pending |
| `Cmd+,` | Project Settings |
| `Cmd+Z` / `Shift+Cmd+Z` | Undo / Redo |
| `Cmd+D` | Duplicate the selection |
| `Cmd+F` | Find, across the project |
| `Cmd+Alt+F` (`Ctrl+H` on Windows and Linux) | Replace text across the project: the Find window's Replace tab |
| `Cmd+T` | The Board |
| `Shift+Cmd+R` | Review Feedback (toggle the [review walk](/storyletter/reviewing/)) |
| `F8` / `Shift+F8` | Next / Previous Feedback |
| `Shift+Cmd+C` | Coverage |
| `Shift+Cmd+B` | Publish Bundle |
| `Cmd+1` | Show or hide the navigator |
| `Ctrl+Cmd+←` / `Ctrl+Cmd+→` | Back / Forward through the documents you've visited (`Alt+←` / `Alt+→` on Windows and Linux) |
| `Cmd+[` | Up a Level: from a card to its deck, a deck to its box, a box to the project |

Undo and redo reverse any edit to any kind of item, through the same version-control path
a save takes, not just the text field you're in.

## In the editor

| Key | Action |
|---|---|
| `Esc` | In a field, leave the field. In a card, go back to its deck |
| `↑` / `↓` | In a card, step to the previous or next card in the deck |
| `Cmd+↑` / `Cmd+←` | Up a Level, the same as `Cmd+[` (when no field has the cursor) |

## On a canvas

These work on a deck's [node canvas](/storyletter/node-canvas/) and on a box's
[map](/storyletter/maps/). They're the keys other node and 3D tools use, so they're plain
letters, not chords.

| Key | Action |
|---|---|
| `F` | Fit the selection |
| `Home` | Fit everything |
| `L` | Arrange by links (node canvas only): the selection, or every card when nothing is selected |
| `Cmd+0` | Back to 100% |
| `Cmd+=` / `Cmd+-` | Zoom in and out |
| `Cmd+A` | Select everything that isn't locked |
| `Delete` / `Backspace` | Remove the selection |
| Hold `Space` | Pan, whatever tool you're holding |
| `Enter` | Finish the shape you're drawing |
| `Esc` | Back out (see below) |

`Cmd+F` is not bound on a canvas: it's Find, app-wide.

## Escape is layered

`Esc` does one thing at a time, and always undoes the most recent thing first. On a canvas
mid-draw it abandons the drawing; with a marquee up it drops the marquee; with a selection
it clears the selection. In a tool window it closes an open panel before it closes the
window - on the Board that runs all the way through the play: a chosen outcome, then the
open card, then the snapshot panel, and only then the window.

## In the Find window

| Key | Action |
|---|---|
| `↓` / `↑` | Move through the hits (Find and Property tabs) |
| `Enter` | Go to the selected hit |
| `Esc` | Close |

The Replace tab has no list keys: each row carries its own **Replace** button, and
**Replace all** asks you to confirm before it rewrites anything.
