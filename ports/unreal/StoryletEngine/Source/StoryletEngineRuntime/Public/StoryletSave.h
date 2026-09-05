// Blueprint/C++ save helper: the whole run as a tagged .storyletsave JSON
// string, and back. A thin veneer over the std core's Storylets/Save.h so
// Blueprint-only games can save and load without touching C++ - the parity of
// Patterplay's UPatterSave, Unity's StoryletSave, Godot's StoryletSave and
// play-helpers' save.ts.
//
// The file is the HOST's (storylets/savefile@1): the engine's envelope plus
// its @world values, because @world is the game's own state and never rides
// the envelope (design/flows.md). Every live flow is in there, keyed by name.
#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "StoryletSave.generated.h"

class UStoryletEngine;

UCLASS()
class STORYLETENGINERUNTIME_API UStoryletSave : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** Serialise the whole run (shared state, @world, every live flow) to a
	 *  tagged JSON string. Empty (and a log) on an invalid engine. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Save")
	static FString SaveStateToJson(UStoryletEngine* Engine);

	/** Parse + restore a SaveStateToJson string. False = refused and the
	 *  engine untouched (not valid JSON, a foreign schema tag, or a save for
	 *  another project). Every flow is rebuilt, and the wrappers the game
	 *  holds re-bind by name. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Save")
	static bool LoadStateFromJson(UStoryletEngine* Engine, const FString& Json);

	/** What LoadStateFromJson would change, as a LoadReport JSON string,
	 *  without changing any of it (design/engine-server.md 4.9): the cards a
	 *  content update would knock off the board, the properties it would drop,
	 *  default or reset, and whether the save's build is this one. Empty (and a
	 *  log) when the blob is refused, which is the same refusal the load gives.
	 *  Here rather than on UStoryletEngine because the report belongs with the
	 *  string boundary it prices, as SaveStateToJson does. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Save")
	static FString PreviewLoadFromJson(UStoryletEngine* Engine, const FString& Json);
};
