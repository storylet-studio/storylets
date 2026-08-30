---
title: Running the project
description: "For whoever has to answer \"is this content reachable, and is it ready to ship?\": coverage testing, and the reports that turn the answer into evidence."
sidebar:
  label: Running the project
---

This track is for the person who has to answer **"is this content reachable, and is it
ready to ship?"**: a producer, a lead, or the author wearing that hat on a Friday
afternoon. Designing a card isn't the same as knowing a player can ever see it, and a
storylet system is good at hiding the difference: content is gated on state, so a
condition nobody satisfies makes a card that exists, validates, compiles and never
appears.

> Designing, not checking? Head to [Storyletter](/storyletter/overview/). The
> [Board](/storyletter/board/) is the everyday version of this page: play the project and
> watch what it deals.

## What you can find out

- **[Coverage testing](/production/coverage-testing/)**: seeded playthroughs that report
  what your content can reach, per hand, in the app or from the command line. A card
  that's unreachable because nothing sets the state it needs is reported as a gap, not
  counted as covered.
- **[A spreadsheet of the whole project](/storyletter/overview/#a-spreadsheet-of-the-whole-project)**:
  **Publish ▸ Publish Spreadsheet…** in Storyletter, or
  [`storyletengine export-xlsx`](/cli/#export-xlsx) in a script, writes every deck as a sheet
  of cards (When, priority, tags, purpose, outcomes), plus Outcomes, Hands and Tag groups
  sheets. Sort it, filter it, or read it in a meeting.

## Where the rest lives

Two things a producer usually wants are documented on the surface they happen on:

- **Comments and the review walk**, leaving feedback on any item and stepping through it,
  are part of the editor: [Reviewing](/storyletter/reviewing/).
- **Gating a build on coverage** in CI is the last section of
  [Coverage testing](/production/coverage-testing/#gating-a-build-on-it).
