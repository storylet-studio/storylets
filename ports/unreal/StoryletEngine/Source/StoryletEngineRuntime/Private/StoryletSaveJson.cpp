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
	// This wrapper self-backs @world in the engine, so the file carries the
	// engine's current world values and a load applies them back - "host saves
	// its container once" (design/flows.md).
	storylets::OrderedMap<std::string, storylets::StoryletValue> World;
	for (const storylets::PropertyRow& Row : Engine.listProperties())
	{
		if (Row.path.rfind("world.", 0) == 0) World.set(Row.name, Row.value);
	}
	return FString(UTF8_TO_TCHAR(storylets::serializeState(Engine, World).c_str()));
}

bool StoryletLoadStateFromJson(storylets::Engine& Engine, const FString& Json, FString& OutError)
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
		const storylets::OrderedMap<std::string, storylets::StoryletValue> World =
			storylets::loadState(Engine, Tree);
		// The file's @world values land over the reseeded container - the HOST
		// applies them; the envelope never carries them.
		for (const auto& Pair : World)
		{
			try { Engine.setProperty("world." + Pair.first, Pair.second); }
			catch (const std::exception&) { /* an orphaned key: dropped */ }
		}
		OutError.Reset();
		return true;
	}
	catch (const std::exception& Ex)
	{
		OutError = FString(UTF8_TO_TCHAR(Ex.what()));
		return false;
	}
}
