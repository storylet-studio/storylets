// A quality's ladder outside a condition, for Blueprint: where a field's stage
// stands against a property's, or the stage after it. The shared kernel's
// StageIndex, CompareStages and NextStage (the same three every Storylet
// Engine and Patterplay runtime carries), over a field's declaration, as the
// C#, GDScript and C++ ones take one: read it with UStoryletBundle::GetFieldDecl.
#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "StoryletTypes.h"
#include "StoryletStages.generated.h"

UCLASS()
class STORYLETENGINERUNTIME_API UStoryletStages : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** The position of Value on the ladder, or -1 when it is not a stage. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Stages")
	static int32 StageIndex(const FStoryletFieldDecl& Decl, const FString& Value);

	/** Compare two stages by their place on the ladder: Result is -1, 0 or 1 as
	 *  A is below, at or above B. False, with Error saying which, when either
	 *  is not a stage (a deleted one, a drifted save). */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Stages")
	static bool CompareStages(const FStoryletFieldDecl& Decl, const FString& A, const FString& B, int32& Result, FString& Error);

	/** The stage one rung above Value, staying on the top rung, as advance()
	 *  does. False, with Error, when Value is not a stage. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Stages")
	static bool NextStage(const FStoryletFieldDecl& Decl, const FString& Value, FString& Next, FString& Error);
};
