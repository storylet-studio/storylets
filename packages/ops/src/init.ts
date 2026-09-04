// ---------------------------------------------------------------------------
// The init op: scaffold a new `.storylets` project - the project shard, a
// starter box with a playable two-card loop, and the hygiene files the
// extension ruling promised (source doc section 2): editor associations
// registering the shard extensions as JSON5, `.editorconfig`, and git
// config (`.gitattributes` + `.gitignore`). Pure planned writes: nothing is
// written here; the caller commits them through the VC layer.
// ---------------------------------------------------------------------------

import { basename, join, resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { BUNDLE_EXTENSION, PROJECT_FOLDER_EXTENSION, SHARD_EXTENSIONS } from "@storylet-studio/model";
import type { BoxShard, DeckShard, HandsShard, ProjectShard, TagsShard } from "@storylet-studio/model";
import { canonicalStringify } from "@storylet-studio/compiler";
import { newId, slug } from "./ids.js";
import type { PlannedWrite } from "./write.js";

export interface InitOptions {
  /** Directory to scaffold into; `.storylets` is appended when absent. */
  dir: string;
  /** Project name; defaults to the directory's basename. */
  name?: string;
}

export interface InitResult {
  writes: PlannedWrite[];
  /** The project folder that will be created. */
  dir: string;
  /** Path of the project shard the scaffold creates. */
  projectFile: string;
  name: string;
}

/** Scaffold a new project as planned writes. Throws if `dir` already holds
 *  a project or the scaffold would overwrite anything. */
/** The folder name a project of this name lands in. One rule, beside the code
 *  that enforces it: the editor's New Project dialog TELLS the author what it
 *  is about to create, and a second derivation of it would be a promise that
 *  can drift from the act (the box-folder lesson, `box-folder.ts`). */
export const projectFolderName = (name: string): string =>
  (name.endsWith(PROJECT_FOLDER_EXTENSION) ? name : `${name}${PROJECT_FOLDER_EXTENSION}`);

export function runInit(opts: InitOptions): InitResult {
  const given = resolve(opts.dir);
  const dir = projectFolderName(given);
  const name = opts.name?.trim() || basename(dir, PROJECT_FOLDER_EXTENSION);
  const stem = slug(name);

  let existing: string[] = [];
  try {
    existing = readdirSync(dir).filter((f) => f.endsWith(SHARD_EXTENSIONS.project));
  } catch {
    // dir does not exist yet - fine, the write layer creates it.
  }
  if (existing.length > 0) throw new Error(`a project already exists here: ${existing[0]}`);

  const project: ProjectShard = {
    schema: "storylets/project@0",
    project: { id: newId("proj"), name, version: "0.1.0" },
    settings: { playAdvancesTurns: 1 },
    world: { properties: [], registry: {} },
    story: {
      properties: [{ name: "started", type: "boolean", default: false }],
    },
    templates: {},
    // Published BESIDE the project, never inside it: a `.storylets` folder is
    // the document (on macOS a package), and a build output has no place in
    // it. Patterpad's own default, `../patter-dist/<name>.patterc`, name for name.
    export: { bundle: `../storylet-dist/${stem}${BUNDLE_EXTENSION}`, metadata: "full" },
  };
  const box: BoxShard = {
    schema: "storylets/box@0",
    box: {
      id: newId("b"), gameId: "main",
      title: "Main", purpose: "Your first box of cards.",
      ranking: { specificity: true },
      fields: [],
      properties: [],
    },
  };
  const tags: TagsShard = { schema: "storylets/tags@0", groups: [] };
  const hands: HandsShard = {
    schema: "storylets/hands@0",
    templates: [],
    hands: [{
      id: newId("h"), gameId: "whats-next",
      title: "What's next?",
      purpose: "The starter hand: deal it to see what could happen now.",
      rule: { bindings: {}, slots: "unbounded" },
    }],
  };
  const deck: DeckShard = {
    schema: "storylets/deck@0",
    deck: {
      id: newId("k"), gameId: "starter",
      title: "Starter", purpose: "Two cards that show the loop: draw, play, draw again.",
      properties: [],
    },
    cards: [
      {
        id: newId("c"), gameId: "welcome",
        title: "Welcome",
        purpose: "Dealt first; playing it flips @story.started.",
        priority: 1, redraw: "never",
        outcomes: [{
          id: newId("o"), gameId: "onwards", title: "Onwards",
          changes: { "@story.started": "true" },
        }],
      },
      {
        id: newId("c"), gameId: "what-now",
        title: "What now?",
        purpose: "Only eligible once the story has started.",
        condition: "@story.started",
        priority: 0, redraw: "always",
        outcomes: [{ id: newId("o"), gameId: "carry-on", title: "Carry on", changes: {} }],
      },
    ],
  };

  const projectFile = join(dir, `${stem}${SHARD_EXTENSIONS.project}`);
  const writes: PlannedWrite[] = [
    { path: projectFile, content: canonicalStringify(project) },
    { path: join(dir, "main", `box${SHARD_EXTENSIONS.box}`), content: canonicalStringify(box) },
    { path: join(dir, "main", `tags${SHARD_EXTENSIONS.tags}`), content: canonicalStringify(tags) },
    { path: join(dir, "main", `hands${SHARD_EXTENSIONS.hands}`), content: canonicalStringify(hands) },
    { path: join(dir, "main", "decks", `starter${SHARD_EXTENSIONS.deck}`), content: canonicalStringify(deck) },
    { path: join(dir, ".editorconfig"), content: EDITORCONFIG },
    { path: join(dir, ".gitattributes"), content: GITATTRIBUTES },
    { path: join(dir, ".gitignore"), content: GITIGNORE },
    { path: join(dir, ".vscode", "settings.json"), content: VSCODE_SETTINGS },
    { path: join(dir, "vcs-setup.md"), content: VCS_SETUP },
  ];

  const collisions = writes.map((w) => w.path).filter((p) => existsSync(p));
  if (collisions.length > 0) {
    throw new Error(`refusing to overwrite existing file(s): ${collisions.join(", ")}`);
  }
  return { writes, dir, projectFile, name };
}

// --- emitted file bodies (the extension ruling + merge hygiene) --------------

const SHARD_GLOB = "storyletproj,storyletbox,storylettags,storylethands,storyletdeck,storyletview";

const EDITORCONFIG = `# Storylet Studio source is UTF-8 + LF, always (the validator enforces this).
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true

[*.{${SHARD_GLOB}}]
indent_style = space
indent_size = 2
`;

const GITATTRIBUTES = `# Storylet Studio source is UTF-8 + LF text (pinned; never let autocrlf touch it).
*.storyletproj    text eol=lf
*.storyletbox     text eol=lf
*.storylettags    text eol=lf
*.storylethands   text eol=lf
*.storyletdeck    text eol=lf
*.storyletview    text eol=lf

# Id-keyed structured merge for storylets source (the 'storyletengine merge'
# driver; see vcs-setup.md). Until it is registered, git falls back to a
# normal text merge for these - the format carries the everyday cases anyway
# (Tier 1 of the merge design).
*.storyletproj    merge=storylets
*.storyletbox     merge=storylets
*.storylettags    merge=storylets
*.storylethands   merge=storylets
*.storyletdeck    merge=storylets
# The arrangement layer is the shard that merges MOST: positions churn, and
# two designers tidying different corners of a canvas must not conflict.
*.storyletview    merge=storylets

# The compiled bundle is committed but REGENERATED, never hand-merged - keep
# ours on conflict and rebuild ('storyletengine validate' catches a stale
# one via the content hash). Needs a one-time
# 'git config merge.ours.driver true' (see vcs-setup.md).
*.storyletsc      text eol=lf merge=ours

# Background images (an orientation aid on a map): bytes, so nothing should ever
# try to diff, merge or normalise line endings in one. Plain git is fine for a
# few MB of floor plan; if yours grow, git-lfs is the escape hatch and nothing
# here depends on it.
assets/**         binary
`;

const GITIGNORE = `# Storylet Studio generated artifacts that are never source:
# Unresolved merge sidecar (a lingering one is a validate error):
*.storyletconflict
`;

const VSCODE_SETTINGS = `{
  // Storylet Studio shards are JSON5 (trailing commas, comments) under per-type
  // extensions - register them so highlighting and validation survive.
  "files.associations": {
    "*.storyletproj": "json5",
    "*.storyletbox": "json5",
    "*.storylettags": "json5",
    "*.storylethands": "json5",
    "*.storyletdeck": "json5",
    "*.storyletview": "json5"
  }
}
`;

const VCS_SETUP = `# VCS setup

\`.gitattributes\` (already emitted) pins storylets shards to UTF-8 + LF text
and marks the compiled \`.storyletsc\` bundle \`merge=ours\` (regenerated, never
hand-merged; \`storyletengine validate\` catches a stale one via the content
hash).

Register the merge drivers once per clone (git config is not repo-tracked):

    git config merge.storylets.name "Storylet Studio structured merge"
    git config merge.storylets.driver "storyletengine merge %O %A %B -o %A --path %P"
    git config merge.ours.driver true

(\`%P\` tells the driver the file's real path, so a conflicted merge can put
its \`.storyletconflict\` sidecar next to the actual shard rather than git's
temp file.)

Wherever the driver is not registered, git falls back to a normal text merge
for the shards - safe, because the format carries the everyday cases:
different decks, different cards in one deck, different fields of one card
all merge cleanly as text (Tier 1 of the merge design); concurrent adds to
one deck are the case the driver exists for.

Recommended pre-commit hook (\`.git/hooks/pre-commit\`, executable):

    #!/bin/sh
    storyletengine validate || exit 1
`;
