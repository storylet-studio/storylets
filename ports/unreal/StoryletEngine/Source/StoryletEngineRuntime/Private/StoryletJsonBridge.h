// UE Json -> storylets::JsonValue: the ONE place Unreal's JSON library meets
// the core. The core consumes its neutral JsonValue tree instead of a JSON
// library; this bridge feeds it from FJsonSerializer. Object key order is
// preserved (FJsonObject's TMap keeps insertion order for pure additions,
// which parsing is), because the runtime leans on JSON document order.
#pragma once

#include "CoreMinimal.h"

namespace storylets { struct JsonValue; }

/** Parse a JSON string into the core's neutral tree. False (with OutError)
 *  on invalid JSON or a non-object root. */
bool StoryletJsonToTree(const FString& Json, storylets::JsonValue& OutTree, FString& OutError);
