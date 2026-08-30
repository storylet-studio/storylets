---
title: Setting up a project
description: "For whoever configures a Storylet Studio project so designers can work in it: the properties the story reads and writes, and how the team shares the files."
sidebar:
  label: Setting up a project
---

This track is for the person who **sets a project up so that designers can work in it**:
usually a developer or a technical lead. You decide the shape of the world once (the
properties the story can read and write, what your game needs back out of it, and how the
team shares the files), and after that authors live in
[Storyletter](/storyletter/overview/) and don't have to think about any of it.

> Designing, not configuring? You can skip this section; someone has done it for you. Head
> to [Storyletter](/storyletter/overview/).

## What you'll set up

- **[Version control](/setup/version-control/)**: how a project lives in git, Perforce,
  Plastic or SVN. The short version is that the format is built so everyday edits merge
  on their own, and the structured merge driver handles the rest.

Most of the remaining configuration happens inside the app, so it's documented where you
meet it:

- **Properties**, the state the story reads and writes, are declared per scope in Project
  Settings and on each box: see [Setting up a box](/storyletter/box-setup/) and
  [Concepts](/concepts/#the-five-scopes).
- **Tags and hand templates**, which decide what can be dealt where, are also box setup:
  [Setting up a box](/storyletter/box-setup/).
- **Publishing a bundle** for your game to load is covered in
  [The compiled bundle](/format/bundle/) and, for automation, [the CLI](/cli/).

## Naming things early

A `gameId` is an address your game calls: `deal("tavern-encounters")`. Renaming one is a
breaking change for the code that calls it, the same way renaming a public function is.
The editor lets you rename freely and the compiler tells you what broke, but it's worth
settling your naming early.
