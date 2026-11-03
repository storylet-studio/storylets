// The Storylet Engine version, and the check against it, for Blueprint. The
// core's storylets::StoryletEngineVersion and storylets::versionInRange (the
// same pair every Storylet Engine and Patterplay runtime carries), for a game,
// a tool or an extension that ships apart from the engine and checks at
// start-up that the Storylet Engine it finds is one it was built for.
#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "StoryletVersion.generated.h"

UCLASS()
class STORYLETENGINERUNTIME_API UStoryletVersion : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** This runtime's version, as in its .uplugin's VersionName ("0.15.0").
	 *  The core's storylets::StoryletEngineVersion. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Version")
	static FString GetStoryletEngineVersion();

	/** Whether Version is at least Min and below MaxExclusive, by
	 *  semantic-version precedence (build metadata after + is ignored, and a
	 *  prerelease comes before its release). False when any of the three is
	 *  not a version. Something built for the Storylet Engine 0.15 checks
	 *  GetStoryletEngineVersion against "0.15.0" and "0.16.0". The core's
	 *  storylets::versionInRange. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Version")
	static bool StoryletEngineVersionInRange(const FString& Version, const FString& Min, const FString& MaxExclusive);
};
