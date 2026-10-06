// A test's listener for UStoryletEngine::OnReplacedFlow. A dynamic delegate
// binds only to a UFUNCTION on a UObject, so the automation test that proves
// the core's onReplacedFlow reaches Blueprint needs one; it records each call
// and does nothing else.
#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "StoryletReplacedFlowListener.generated.h"

UCLASS(Transient)
class UStoryletReplacedFlowListener : public UObject
{
	GENERATED_BODY()

public:
	/** "<flow id>:<dealt cards>", one per call, in order. */
	TArray<FString> Calls;

	UFUNCTION()
	void OnReplaced(const FString& FlowId, int32 DealtCards)
	{
		Calls.Add(FString::Printf(TEXT("%s:%d"), *FlowId, DealtCards));
	}
};
