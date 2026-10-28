// Blueprint/C++ save helper: the whole run as a tagged .storyletsave JSON
// string, and back. A thin veneer over the std core's Storylets/Save.h so
// Blueprint-only games can save and load without touching C++ - the parity of
// Patterplay's UPatterSave, Unity's StoryletSave, Godot's StoryletSave and
// play-helpers' save.ts.
//
// The file is the HOST's (storylets/savefile@1): the engine's envelope
// (storylets/save@3; @1 and @2 still load) plus its @world values, because a bound
// @world is the game's own state and never rides the envelope (design/flows.md).
// Every live flow is in there, keyed by name. An engine on its own registry
// carries every property value in the envelope; an engine on the game's
// registry (UStoryletEngine::CreateWithRegistry) leaves them to the game,
// which saves that registry once, beside this file.
#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "StoryletTypes.h"
#include "StoryletSave.generated.h"

class UStoryletEngine;

UCLASS()
class STORYLETENGINERUNTIME_API UStoryletSave : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** Serialise the whole run (shared state, @world, every live flow) to a
	 *  tagged JSON string. Empty (and a log) on an invalid engine. Patterplay's
	 *  UPatterSave::SerializeState. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Save")
	static FString SerializeState(UStoryletEngine* Engine);

	/** Parse + restore a SerializeState string. False = refused and the
	 *  engine untouched (not valid JSON, a foreign schema tag, or a save for
	 *  another project). Every flow is rebuilt, and the wrappers the game
	 *  holds re-bind by name. Patterplay's UPatterSave::DeserializeState. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Save")
	static bool DeserializeState(UStoryletEngine* Engine, const FString& Json);

	/** DeserializeState, handing back what the load cost in OutReport (the
	 *  same report PreviewLoad gives for the same blob, and the other
	 *  runtimes' loadState onReport); a default report on a refusal. The
	 *  drift a load tolerates is what hides its cost, so the cost comes back
	 *  with the load whether or not anybody looked first. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Save")
	static bool DeserializeStateWithReport(UStoryletEngine* Engine, const FString& Json, FStoryletLoadReport& OutReport);

	/** What DeserializeState would change, without changing any of it
	 *  (design/engine-server.md 4.9): the cards a content update would knock
	 *  off the board, the properties it would drop, default or reset, and
	 *  whether the save's build is this one. False (a default report, and a
	 *  log) when the blob is refused, which is the same refusal the load
	 *  gives. Here rather than on UStoryletEngine because the report belongs
	 *  with the string boundary it prices. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Save")
	static bool PreviewLoad(UStoryletEngine* Engine, const FString& Json, FStoryletLoadReport& OutReport);

	// --- the names before Patterplay's (deprecated) ----------------------------

	/** The name before SerializeState. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Save", meta = (DeprecatedFunction, DeprecationMessage = "Use SerializeState, the name Patterplay uses."))
	static FString SaveStateToJson(UStoryletEngine* Engine);

	/** The name before DeserializeState. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Save", meta = (DeprecatedFunction, DeprecationMessage = "Use DeserializeState, the name Patterplay uses."))
	static bool LoadStateFromJson(UStoryletEngine* Engine, const FString& Json);

	/** DeserializeStateWithReport with the report as JSON text (empty on a
	 *  refusal). */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Save", meta = (DeprecatedFunction, DeprecationMessage = "Use DeserializeStateWithReport, which hands the report back as an FStoryletLoadReport."))
	static bool LoadStateFromJsonWithReport(UStoryletEngine* Engine, const FString& Json, FString& OutReportJson);

	/** PreviewLoad with the report as JSON text (empty on a refusal). */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Save", meta = (DeprecatedFunction, DeprecationMessage = "Use PreviewLoad, which hands the report back as an FStoryletLoadReport."))
	static FString PreviewLoadFromJson(UStoryletEngine* Engine, const FString& Json);
};
