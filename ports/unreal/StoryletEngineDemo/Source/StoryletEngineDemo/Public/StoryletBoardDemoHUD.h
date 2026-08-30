// Puts the Board demo on screen: builds UStoryletBoardDemoWidget, adds it to
// the viewport, and hands the mouse to the UI (the demo is click-driven and has
// no keyboard controls at all).
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "StoryletBoardDemoHUD.generated.h"

class UStoryletBoardDemoWidget;

UCLASS()
class STORYLETENGINEDEMO_API AStoryletBoardDemoHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void BeginPlay() override;

private:
	/** Rooted while the HUD lives, so the session it holds stays visible to
	 *  the Runtime State examiner for the whole run. */
	UPROPERTY()
	TObjectPtr<UStoryletBoardDemoWidget> BoardWidget = nullptr;
};
