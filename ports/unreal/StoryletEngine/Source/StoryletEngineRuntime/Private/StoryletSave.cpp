#include "StoryletSave.h"

#include "StoryletEngine.h"
#include "StoryletSaveJson.h"

#include "Storylets/Engine.h"

FString UStoryletSave::SaveStateToJson(UStoryletEngine* Engine)
{
	storylets::Engine* Core = Engine ? Engine->GetCoreEngine() : nullptr;
	if (!Core)
	{
		UE_LOG(LogTemp, Error, TEXT("Storylet Engine: SaveStateToJson on a null/invalid engine"));
		return FString();
	}
	return StoryletSaveStateToJson(*Core);
}

bool UStoryletSave::LoadStateFromJson(UStoryletEngine* Engine, const FString& Json)
{
	storylets::Engine* Core = Engine ? Engine->GetCoreEngine() : nullptr;
	if (!Core)
	{
		UE_LOG(LogTemp, Error, TEXT("Storylet Engine: LoadStateFromJson on a null/invalid engine"));
		return false;
	}
	FString Error;
	if (!StoryletLoadStateFromJson(*Core, Json, Error))
	{
		UE_LOG(LogTemp, Error, TEXT("Storylet Engine: LoadStateFromJson - %s"), *Error);
		return false;
	}
	// loadGame rebuilt every flow; re-point the wrappers the game holds at the
	// flow of the same name, so a Blueprint variable keeps working.
	Engine->RebindFlowsAfterLoad();
	return true;
}
