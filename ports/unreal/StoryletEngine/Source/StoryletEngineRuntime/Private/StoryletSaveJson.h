// Save-file plumbing over the .storyletsave file (storylets/savefile@1: the
// HOST's wrapper - engine envelope + @world). Mirrors the Unity port's StoryletSave and the
// play-helpers save.ts: these helpers are the string boundary - a foreign or
// malformed blob fails with a clean error rather than corrupting a run. The
// envelope itself lives in the pure core (parity rule: never editor-only);
// this file only strings it. Module-private; UStoryletSave's SaveStateToJson /
// LoadStateFromJson are the public face.
#pragma once

#include "CoreMinimal.h"

namespace storylets { class Engine; }

/** The engine's current state (envelope + its @world values) as
 *  pretty-printed .storyletsave JSON. */
FString StoryletSaveStateToJson(const storylets::Engine& Engine);

/** Restore an engine from .storyletsave JSON (every flow rebuilt; re-take
 *  handles). False (with OutError) on a foreign or malformed blob: not
 *  valid JSON, a missing/foreign schema tag, or a save for another
 *  project. The engine is untouched on failure. */
bool StoryletLoadStateFromJson(storylets::Engine& Engine, const FString& Json, FString& OutError);
