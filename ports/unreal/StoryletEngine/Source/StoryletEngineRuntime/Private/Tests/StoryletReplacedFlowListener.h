// A test's listener for UStoryletEngine::OnReplacedFlow, OnError, OnTrace and OnRefit.
// A dynamic delegate binds only to a UFUNCTION on a UObject, so the automation
// tests that prove the core's onReplacedFlow, onError and trace reach
// Blueprint need one; it records each call and does nothing else.
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

	/** Every OnTrace, in order. */
	TArray<FStoryletLogEntry> Traces;

	UFUNCTION()
	void OnTraceEntry(const FStoryletLogEntry& Entry)
	{
		Traces.Add(Entry);
	}

	/** "<scope>.<name>=<saved value as text>", one per OnRefit, in order. */
	TArray<FString> Refits;

	UFUNCTION()
	void OnRefitValue(const FString& Scope, const FString& Name, const FStoryletValue& Saved)
	{
		Refits.Add(FString::Printf(TEXT("%s.%s=%s"), *Scope, *Name, *Saved.Display));
	}
};
