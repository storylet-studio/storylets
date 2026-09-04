#include "StoryletSave.h"

#include "StoryletEngine.h"
#include "StoryletWorld.h"
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
	storylets::OrderedMap<std::string, storylets::StoryletValue> World;
	if (!StoryletLoadStateWorld(*Core, Json, World, Error))
	{
		UE_LOG(LogTemp, Error, TEXT("Storylet Engine: LoadStateFromJson - %s"), *Error);
		return false;
	}
	// The file's @world values are the HOST's to restore. A bound container
	// takes them directly (its read-only policy binds the story, not a load);
	// a self-backed engine takes them through setProperty.
	if (UStoryletWorld* Bound = Engine->GetBoundWorld())
	{
		for (const auto& Pair : World) Bound->HostSet(Pair.first, Pair.second);
	}
	else
	{
		for (const auto& Pair : World)
		{
			try { Core->setProperty("world." + Pair.first, Pair.second); }
			catch (const std::exception&) { /* an orphaned key: dropped */ }
		}
	}
	// loadGame rebuilt every flow; re-point the wrappers the game holds at the
	// flow of the same name, so a Blueprint variable keeps working.
	Engine->RebindFlowsAfterLoad();
	return true;
}
