// The UE side of the .storyletsave string boundary: an FString shim over the
// core's Storylets/Save.h, which does the actual writing and reading in pure
// std (the parity members serializeState / deserializeState / loadState, the same names
// every runtime carries). Nothing about the format lives here - that would put
// a code path in front of Unreal the clang TestHost can never exercise, which
// is exactly how two faults in this file reached a UE build.

#include "StoryletSaveJson.h"
#include "StoryletJsonBridge.h"

#include "Storylets/Engine.h"
#include "Storylets/JsonValue.h"
#include "Storylets/Save.h"
#include "Storylets/StoryletValue.h"

#include <string>

FString StoryletSaveStateToJson(const storylets::Engine& Engine)
{
	// The file carries the engine's current @world values (read through the
	// bound container when there is one, else the self-backed bag) and a load
	// applies them back - "host saves its container once" (design/flows.md).
	storylets::OrderedMap<std::string, storylets::StoryletValue> World;
	for (const storylets::PropertyRow& Row : Engine.listProperties())
	{
		if (Row.path.rfind("world.", 0) == 0) World.set(Row.name, Row.value);
	}
	return FString(UTF8_TO_TCHAR(storylets::serializeState(Engine, World).c_str()));
}

bool StoryletLoadStateWorld(storylets::Engine& Engine, const FString& Json,
	storylets::OrderedMap<std::string, storylets::StoryletValue>& OutWorld, FString& OutError)
{
	// Parsed with Unreal's own JSON reader (the plugin already carries it) and
	// handed to the core as a neutral tree; the core owns every rule about
	// what a valid save is.
	storylets::JsonValue Tree;
	if (!StoryletJsonToTree(Json, Tree, OutError))
	{
		return false;   // "not valid JSON"
	}
	try
	{
		OutWorld = storylets::loadState(Engine, Tree);
		OutError.Reset();
		return true;
	}
	catch (const std::exception& Ex)
	{
		OutError = FString(UTF8_TO_TCHAR(Ex.what()));
		return false;
	}
}

bool StoryletLoadStateFromJson(storylets::Engine& Engine, const FString& Json, FString& OutError)
{
	storylets::OrderedMap<std::string, storylets::StoryletValue> World;
	if (!StoryletLoadStateWorld(Engine, Json, World, OutError)) return false;
	// The file's @world values land over the reseeded container - the HOST
	// applies them; the envelope never carries them. On a bound engine this
	// goes through the resolver's set (the story's path); UStoryletSave
	// restores a bound container directly instead, so use that from a wrapper.
	for (const auto& Pair : World)
	{
		try { Engine.setProperty("world." + Pair.first, Pair.second); }
		catch (const std::exception&) { /* an orphaned key: dropped */ }
	}
	return true;
}
