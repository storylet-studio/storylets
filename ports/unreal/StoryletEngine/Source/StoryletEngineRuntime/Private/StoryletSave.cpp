#include "StoryletSave.h"
#include "StoryletLog.h"

#include "StoryletEngine.h"
#include "StoryletWorld.h"
#include "StoryletSaveJson.h"

#include "Storylets/Engine.h"
#include "Storylets/JsonValue.h"
#include "Storylets/Save.h"
#include "StoryletJsonBridge.h"

FString UStoryletSave::SaveStateToJson(UStoryletEngine* Engine)
{
	storylets::Engine* Core = Engine ? Engine->GetCoreEngine() : nullptr;
	if (!Core)
	{
		// No engine to keep the message on: a null engine is only logged.
		if (Engine) Engine->NoteRefusal(TEXT("SaveStateToJson"), TEXT("the engine is invalid (Create failed)"));
		else UE_LOG(LogStoryletEngine, Error, TEXT("Storylet Engine: SaveStateToJson on a null engine"));
		return FString();
	}
	Engine->ClearLastError();
	// A bound @world's resolver may throw anything; Blueprint must never see it.
	try
	{
		return StoryletSaveStateToJson(*Core);
	}
	catch (const std::exception& Ex)
	{
		Engine->NoteRefusal(TEXT("SaveStateToJson"), UTF8_TO_TCHAR(Ex.what()));
	}
	catch (...)
	{
		Engine->NoteRefusal(TEXT("SaveStateToJson"), TEXT("an unknown exception"));
	}
	return FString();
}

bool UStoryletSave::LoadStateFromJson(UStoryletEngine* Engine, const FString& Json)
{
	FString Report;
	return LoadStateFromJsonWithReport(Engine, Json, Report);
}

bool UStoryletSave::LoadStateFromJsonWithReport(UStoryletEngine* Engine, const FString& Json, FString& OutReportJson)
{
	OutReportJson.Reset();
	storylets::Engine* Core = Engine ? Engine->GetCoreEngine() : nullptr;
	if (!Core)
	{
		if (Engine) Engine->NoteRefusal(TEXT("LoadStateFromJson"), TEXT("the engine is invalid (Create failed)"));
		else UE_LOG(LogStoryletEngine, Error, TEXT("Storylet Engine: LoadStateFromJson on a null engine"));
		return false;
	}
	Engine->ClearLastError();
	FString Error;
	storylets::OrderedMap<std::string, storylets::StoryletValue> World;
	if (!StoryletLoadStateWorld(*Core, Json, World, Error, &OutReportJson))
	{
		Engine->NoteRefusal(TEXT("LoadStateFromJson"), Error);
		return false;
	}
	// The file's @world values are the HOST's to restore. A bound container
	// takes them directly (its read-only policy binds the story, not a load);
	// a self-backed engine takes them through setProperty (a storylets/save@2
	// or @3 envelope already restored them from its registry; a storylets/save@1
	// envelope never carried them, so this is where they come back). A name
	// nothing answers for, such as a @world the game's registry does not hold,
	// is dropped.
	if (UStoryletWorld* Bound = Engine->GetHostScope(TEXT("world")))
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

FString UStoryletSave::PreviewLoadFromJson(UStoryletEngine* Engine, const FString& Json)
{
	storylets::Engine* Core = Engine ? Engine->GetCoreEngine() : nullptr;
	if (!Core)
	{
		if (Engine) Engine->NoteRefusal(TEXT("PreviewLoadFromJson"), TEXT("the engine is invalid (Create failed)"));
		else UE_LOG(LogStoryletEngine, Error, TEXT("Storylet Engine: PreviewLoadFromJson on a null engine"));
		return FString();
	}
	Engine->ClearLastError();
	// Parsed the same way the load parses it, and refused on the same grounds:
	// a preview that accepts a blob the load would refuse is worse than none.
	storylets::JsonValue Tree;
	FString Error;
	if (!StoryletJsonToTree(Json, Tree, Error))
	{
		Engine->NoteRefusal(TEXT("PreviewLoadFromJson"), Error);
		return FString();
	}
	const storylets::JsonValue* EngineTree = Tree.find("engine");
	const std::string EnvelopeSchema = EngineTree && EngineTree->isObject() ? EngineTree->strOr("schema") : std::string();
	if (Tree.strOr("schema") != storylets::SAVEFILE_SCHEMA
		|| !EngineTree || !EngineTree->isObject()
		|| !storylets::IsReadableSaveSchema(EnvelopeSchema))
	{
		Engine->NoteRefusal(TEXT("PreviewLoadFromJson"), TEXT("not a storylets save"));
		return FString();
	}
	try
	{
		const storylets::LoadReport Report =
			Core->previewLoad(storylets::savedetail::EnvelopeFromTree(*EngineTree));
		return FString(UTF8_TO_TCHAR(storylets::reportToJson(Report).c_str()));
	}
	catch (const std::exception& Ex)
	{
		Engine->NoteRefusal(TEXT("PreviewLoadFromJson"), UTF8_TO_TCHAR(Ex.what()));
		return FString();
	}
	catch (...)
	{
		Engine->NoteRefusal(TEXT("PreviewLoadFromJson"), TEXT("an unknown exception"));
		return FString();
	}
}
