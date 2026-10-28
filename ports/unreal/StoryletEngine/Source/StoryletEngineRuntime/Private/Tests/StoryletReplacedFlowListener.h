// A test's listener for UStoryletEngine::OnReplacedFlow and OnError. A
// dynamic delegate binds only to a UFUNCTION on a UObject, so the automation
// tests that prove the core's onReplacedFlow and onError reach Blueprint need
// one; it records each call and does nothing else.
#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "StoryletTypes.h"
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

	/** Every OnError, in order. */
	TArray<FStoryletPlayError> Errors;

	UFUNCTION()
	void OnPlayError(const FStoryletPlayError& Error)
	{
		Errors.Add(Error);
	}
};
