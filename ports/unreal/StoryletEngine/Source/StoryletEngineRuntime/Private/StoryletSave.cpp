#include "StoryletSave.h"
#include "StoryletLog.h"

#include "StoryletEngine.h"
#include "StoryletWorld.h"
#include "StoryletSaveJson.h"

#include "Storylets/Engine.h"
#include "Storylets/JsonValue.h"
#include "Storylets/Save.h"
#include "StoryletJsonBridge.h"
#include "StoryletValueConvert.h"

namespace
{
	FString ReportJson(const storylets::LoadReport& Report)
	{
		return FString(UTF8_TO_TCHAR(storylets::reportToJson(Report).c_str()));
	}

	/** The engine's core, or null having noted why (on the engine when there
	 *  is one, else only in the log). */
	storylets::Engine* CoreFor(UStoryletEngine* Engine, const TCHAR* Verb)
	{
		storylets::Engine* Core = Engine ? Engine->GetCoreEngine() : nullptr;
		if (!Core)
		{
			// No engine to keep the message on: a null engine is only logged.
			if (Engine) Engine->NoteRefusal(Verb, TEXT("the engine is invalid (Create failed)"));
			else UE_LOG(LogStoryletEngine, Error, TEXT("Storylet Engine: %s on a null engine"), Verb);
			return nullptr;
		}
		Engine->ClearLastError();
		return Core;
	}

	FString SaveState(UStoryletEngine* Engine, const TCHAR* Verb)
	{
		storylets::Engine* Core = CoreFor(Engine, Verb);
		if (!Core) return FString();
		// A bound @world's resolver may throw anything; Blueprint must never see it.
		try
		{
			return StoryletSaveStateToJson(*Core);
		}
		catch (const std::exception& Ex)
		{
			Engine->NoteRefusal(Verb, UTF8_TO_TCHAR(Ex.what()));
		}
		catch (...)
		{
			Engine->NoteRefusal(Verb, TEXT("an unknown exception"));
		}
		return FString();
	}

	/** Every load form: the load, and its report into OutReport when given
	 *  (left alone on a refusal). */
	bool LoadState(UStoryletEngine* Engine, const FString& Json, storylets::LoadReport* OutReport, const TCHAR* Verb)
	{
		storylets::Engine* Core = CoreFor(Engine, Verb);
		if (!Core) return false;
		// The file's @world values are the HOST's to restore, and they go in BEFORE
		// the engine loads: the load checks each held card against the world it
		// will play in, so restoring them after made it read the old one. A bound
		// container takes them directly (its read-only policy binds the story, not
		// a load); a self-backed engine takes them through setProperty (a
		// storylets/save@1 envelope never carried them). A name nothing answers
		// for, such as a @world the game's registry does not hold, is dropped. A
		// refused load puts back what was there, so the game is left as it was.
		UStoryletWorld* Bound = Engine->GetHostScope(TEXT("world"));
		storylets::OrderedMap<std::string, storylets::StoryletValue> Before;
		if (Bound)
		{
			for (const FString& Name : Bound->Names())
			{
				storylets::StoryletValue Value;
				const std::string Key = TCHAR_TO_UTF8(*Name);
				if (Bound->Get(Key, Value)) Before.set(Key, Value);
			}
		}
		else
		{
			for (const storylets::PropertyRow& Row : Core->listProperties())
			{
				if (Row.path.rfind("world.", 0) == 0) Before.set(Row.name, Row.value);
			}
		}
		auto Apply = [Bound, Core](const storylets::OrderedMap<std::string, storylets::StoryletValue>& Values)
		{
			for (const auto& Pair : Values)
			{
				if (Bound) { Bound->HostSet(Pair.first, Pair.second); continue; }
				try { Core->setProperty("world." + Pair.first, Pair.second); }
				catch (const std::exception&) { /* an orphaned key: dropped */ }
			}
		};
		FString Error;
		storylets::OrderedMap<std::string, storylets::StoryletValue> World;
		if (!StoryletLoadStateWorld(*Core, Json, World, Error, OutReport, Apply))
		{
			Apply(Before);
			Engine->NoteRefusal(Verb, Error);
			return false;
		}
		// loadGame rebuilt every flow; re-point the wrappers the game holds at the
		// flow of the same name, so a Blueprint variable keeps working.
		Engine->RebindFlowsAfterLoad();
		return true;
	}

	/** Both preview forms: the report into OutReport; false (and a log) on a
	 *  refusal. */
	bool Preview(UStoryletEngine* Engine, const FString& Json, storylets::LoadReport& OutReport, const TCHAR* Verb)
	{
		storylets::Engine* Core = CoreFor(Engine, Verb);
		if (!Core) return false;
		// Parsed the same way the load parses it, and refused on the same grounds:
		// a preview that accepts a blob the load would refuse is worse than none.
		storylets::JsonValue Tree;
		FString Error;
		if (!StoryletJsonToTree(Json, Tree, Error))
		{
			Engine->NoteRefusal(Verb, Error);
			return false;
		}
		const storylets::JsonValue* EngineTree = Tree.find("engine");
		const std::string EnvelopeSchema = EngineTree && EngineTree->isObject() ? EngineTree->strOr("schema") : std::string();
		if (Tree.strOr("schema") != storylets::SAVEFILE_SCHEMA
			|| !EngineTree || !EngineTree->isObject()
			|| !storylets::IsReadableSaveSchema(EnvelopeSchema))
		{
			Engine->NoteRefusal(Verb, TEXT("not a storylets save"));
			return false;
		}
		try
		{
			OutReport = Core->previewLoad(storylets::savedetail::EnvelopeFromTree(*EngineTree));
			return true;
		}
		catch (const std::exception& Ex)
		{
			Engine->NoteRefusal(Verb, UTF8_TO_TCHAR(Ex.what()));
		}
		catch (...)
		{
			Engine->NoteRefusal(Verb, TEXT("an unknown exception"));
		}
		return false;
	}
}

FString UStoryletSave::SerializeState(UStoryletEngine* Engine)
{
	return SaveState(Engine, TEXT("SerializeState"));
}

bool UStoryletSave::DeserializeState(UStoryletEngine* Engine, const FString& Json)
{
	return LoadState(Engine, Json, nullptr, TEXT("DeserializeState"));
}

bool UStoryletSave::DeserializeStateWithReport(UStoryletEngine* Engine, const FString& Json, FStoryletLoadReport& OutReport)
{
	OutReport = FStoryletLoadReport();
	storylets::LoadReport Report;
	if (!LoadState(Engine, Json, &Report, TEXT("DeserializeStateWithReport"))) return false;
	OutReport = StoryletLoadReportToUe(Report);
	return true;
}

bool UStoryletSave::PreviewLoad(UStoryletEngine* Engine, const FString& Json, FStoryletLoadReport& OutReport)
{
	OutReport = FStoryletLoadReport();
	storylets::LoadReport Report;
	if (!Preview(Engine, Json, Report, TEXT("PreviewLoad"))) return false;
	OutReport = StoryletLoadReportToUe(Report);
	return true;
}

// --- the names before Patterplay's (deprecated) ------------------------------------

FString UStoryletSave::SaveStateToJson(UStoryletEngine* Engine)
{
	return SaveState(Engine, TEXT("SaveStateToJson"));
}

bool UStoryletSave::LoadStateFromJson(UStoryletEngine* Engine, const FString& Json)
{
	return LoadState(Engine, Json, nullptr, TEXT("LoadStateFromJson"));
}

bool UStoryletSave::LoadStateFromJsonWithReport(UStoryletEngine* Engine, const FString& Json, FString& OutReportJson)
{
	OutReportJson.Reset();
	storylets::LoadReport Report;
	if (!LoadState(Engine, Json, &Report, TEXT("LoadStateFromJson"))) return false;
	OutReportJson = ReportJson(Report);
	return true;
}

FString UStoryletSave::PreviewLoadFromJson(UStoryletEngine* Engine, const FString& Json)
{
	storylets::LoadReport Report;
	return Preview(Engine, Json, Report, TEXT("PreviewLoadFromJson")) ? ReportJson(Report) : FString();
}
