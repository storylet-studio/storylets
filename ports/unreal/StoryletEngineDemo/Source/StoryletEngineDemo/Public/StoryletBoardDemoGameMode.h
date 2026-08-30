// The game mode that runs the Board demo. It places nothing in the level: the
// HUD builds the demo widget, and the widget loads the bundle from disk, so any
// open level will do.
//
// The project's default game mode is still the minimal one-shot demo. To play
// the Board demo instead, set Project Settings > Maps & Modes > Default
// GameMode to StoryletBoardDemoGameMode, or add
// ?game=/Script/StoryletEngineDemo.StoryletBoardDemoGameMode to the map URL on
// a command line.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "StoryletBoardDemoGameMode.generated.h"

UCLASS()
class STORYLETENGINEDEMO_API AStoryletBoardDemoGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AStoryletBoardDemoGameMode();
};
