// The Blueprint surface in Patterplay's names and shapes (ruling 3,
// 2026-10-28). Runs via
//   -ExecCmds="Automation RunTests StoryletEngine.PatterplayNames"
//
// Three things the Storylets plugin took from Patterplay before 1.0, each with
// the name it had before kept working as a deprecated alias:
//   - UStoryletSave::SerializeState and DeserializeState, UPatterSave's pair;
//   - UStoryletEngine::OnTrace, every flow's trace as a Blueprint event, as
//     UPatterEngine::OnTrace hands over each decision;
//   - FStoryletLoadReport, the LoadReport as a struct, where the JSON text
//     used to be the only form a Blueprint could hold.
// The struct is checked against the JSON for the same load field for field:
// the test writes the struct out in reportToJson's exact format and compares
// the text, on a load with real drift (an evicted card, a dropped property, a
// defaulted one, a new version and hash).

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "StoryletBundle.h"
#include "StoryletEngine.h"
#include "StoryletLiveLink.h"
#include "StoryletSave.h"
#include "StoryletTypes.h"
#include "StoryletReplacedFlowListener.h"

#include "Storylets/StoryletValue.h"

namespace
{
	// A shared @story.gold and a per-flow @story.steps, and one card whose
	// outcome bumps both.
	const TCHAR* NamesBundleJson = TEXT(R"JSON({
  "schema": "storylets/bundle@0",
  "content": { "project": "proj_names", "version": "1.0.0", "hash": "nameshash" },
  "metadata": "full",
  "settings": { "playAdvancesTurns": 1 },
  "world": { "properties": [] },
  "story": { "properties": [
    { "name": "gold", "type": "number", "default": 0 },
    { "name": "steps", "type": "number", "default": 0, "shared": false }
  ] },
  "boxes": [
    {
      "id": "b_x", "gameId": "box", "ranking": { "specificity": true },
      "fields": [], "properties": [], "tagGroups": [],
      "decks": [
        {
          "id": "k_main", "gameId": "main", "properties": [],
          "cards": [
            {
              "id": "c_heist", "gameId": "heist", "redraw": "always",
              "outcomes": [
                { "id": "o_go", "gameId": "go", "changes": {
                  "@story.gold": { "src": "@story.gold + 1", "ast": ["bin", "+", ["sv", "story", "gold"], ["n", 1]] },
                  "@story.steps": { "src": "@story.steps + 1", "ast": ["bin", "+", ["sv", "story", "steps"], ["n", 1]] }
                } }
              ]
            }
          ]
        }
      ],
      "handTemplates": [],
      "hands": [ { "id": "h_q", "gameId": "q", "rule": { "bindings": {}, "slots": 1 } } ]
    }
  ]
})JSON");

	/** The same project edited: a new version and hash, steps gone, a new
	 *  mood, and the heist card replaced by a caper, so a held heist is
	 *  evicted. */
	FString EditedBundleJson()
	{
		return FString(NamesBundleJson)
			.Replace(TEXT("\"version\": \"1.0.0\", \"hash\": \"nameshash\""), TEXT("\"version\": \"1.0.1\", \"hash\": \"nameshash2\""))
			.Replace(TEXT("{ \"name\": \"steps\", \"type\": \"number\", \"default\": 0, \"shared\": false }"),
				TEXT("{ \"name\": \"mood\", \"type\": \"number\", \"default\": 0, \"shared\": false }"))
			.Replace(TEXT("\"@story.steps\": { \"src\": \"@story.steps + 1\", \"ast\": [\"bin\", \"+\", [\"sv\", \"story\", \"steps\"], [\"n\", 1]] }"),
				TEXT("\"@story.mood\": { \"src\": \"@story.mood + 1\", \"ast\": [\"bin\", \"+\", [\"sv\", \"story\", \"mood\"], [\"n\", 1]] }"))
			.Replace(TEXT("\"id\": \"c_heist\", \"gameId\": \"heist\""), TEXT("\"id\": \"c_caper\", \"gameId\": \"caper\""));
	}

	FString Quote(const FString& S)
	{
		return FString(UTF8_TO_TCHAR(storylets::StoryletValue::JsonQuote(std::string(TCHAR_TO_UTF8(*S))).c_str()));
	}

	FString Strings(const TArray<FString>& List)
	{
		TArray<FString> Parts;
		for (const FString& S : List) Parts.Add(Quote(S));
		return TEXT("[") + FString::Join(Parts, TEXT(", ")) + TEXT("]");
	}

	FString Properties(const TArray<FStoryletLoadProperty>& List)
	{
		TArray<FString> Parts;
		for (const FStoryletLoadProperty& P : List)
		{
			Parts.Add(TEXT("{ ") + (P.Flow.IsEmpty() ? FString() : TEXT("\"flow\": ") + Quote(P.Flow) + TEXT(", "))
				+ TEXT("\"path\": ") + Quote(P.Path) + TEXT(" }"));
		}
		return TEXT("[") + FString::Join(Parts, TEXT(", ")) + TEXT("]");
	}

	/** The struct written out as the core's reportToJson writes a LoadReport,
	 *  byte for byte, so equal text means equal reports, every field. */
	FString AsReportJson(const FStoryletLoadReport& R)
	{
		TArray<FString> Evicted;
		for (const FStoryletLoadEviction& E : R.Evicted)
		{
			Evicted.Add(TEXT("{ \"flow\": ") + Quote(E.Flow) + TEXT(", \"hand\": ") + Quote(E.Hand)
				+ TEXT(", \"card\": ") + Quote(E.Card) + TEXT(", \"reason\": ") + Quote(E.Reason) + TEXT(" }"));
		}
		TArray<FString> Cooldowns;
		for (const FStoryletLoadCooldown& C : R.DroppedCooldowns)
		{
			Cooldowns.Add(TEXT("{ \"flow\": ") + Quote(C.Flow) + TEXT(", \"card\": ") + Quote(C.Card) + TEXT(" }"));
		}
		FString Out = TEXT("{\n");
		Out += TEXT("  \"exact\": ") + FString(R.bExact ? TEXT("true") : TEXT("false")) + TEXT(",\n");
		Out += TEXT("  \"project\": ") + Quote(R.Project) + TEXT(",\n");
		Out += TEXT("  \"version\": { \"saved\": ") + Quote(R.Version.Saved) + TEXT(", \"bundle\": ") + Quote(R.Version.Bundle) + TEXT(" },\n");
		Out += TEXT("  \"hash\": { \"saved\": ") + Quote(R.Hash.Saved) + TEXT(", \"bundle\": ") + Quote(R.Hash.Bundle) + TEXT(" },\n");
		Out += TEXT("  \"flows\": ") + Strings(R.Flows) + TEXT(",\n");
		Out += TEXT("  \"evicted\": [") + FString::Join(Evicted, TEXT(", ")) + TEXT("],\n");
		Out += TEXT("  \"droppedCooldowns\": [") + FString::Join(Cooldowns, TEXT(", ")) + TEXT("],\n");
		Out += TEXT("  \"droppedSpent\": ") + Strings(R.DroppedSpent) + TEXT(",\n");
		Out += TEXT("  \"droppedProperties\": ") + Properties(R.DroppedProperties) + TEXT(",\n");
		Out += TEXT("  \"defaultedProperties\": ") + Properties(R.DefaultedProperties) + TEXT(",\n");
		Out += TEXT("  \"retypedProperties\": ") + Properties(R.RetypedProperties) + TEXT("\n");
		Out += TEXT("}");
		return Out;
	}

	FString Kinds(const TArray<FStoryletLogEntry>& Entries)
	{
		TArray<FString> Parts;
		for (const FStoryletLogEntry& E : Entries)
		{
			Parts.Add(FString::Printf(TEXT("%s:%d:%s:%s:%s"), *E.Flow, static_cast<int32>(E.Kind), *E.Hand, *E.Card, *E.Path));
		}
		return FString::Join(Parts, TEXT(" | "));
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryletPatterplayNamesTest,
	"StoryletEngine.PatterplayNames",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FStoryletPatterplayNamesTest::RunTest(const FString& Parameters)
{
	FString Error;
	UStoryletBundle* Bundle = UStoryletBundle::LoadFromJsonString(NamesBundleJson, Error);
	if (!TestNotNull(TEXT("bundle compiles"), Bundle)) return false;
	UStoryletBundle* Edited = UStoryletBundle::LoadFromJsonString(EditedBundleJson(), Error);
	if (!TestNotNull(TEXT("the edited bundle compiles"), Edited)) return false;

	// A run worth saving: main has played once and holds the heist again; side
	// is open and has dealt nothing.
	auto Played = [&]() -> UStoryletEngine*
	{
		UStoryletEngine* Engine = UStoryletEngine::Create(Bundle, {});
		if (!Engine) return nullptr;
		UStoryletFlow* Main = Engine->OpenFlow(TEXT("main"));
		TArray<FStoryletDealtCard> Hand = Main->Deal(TEXT("q"));
		if (Hand.Num() == 1)
		{
			FString PlayError;
			Main->Play(Hand[0].GameId, TEXT("go"), TEXT("q"), PlayError);
		}
		Main->Deal(TEXT("q"));
		Engine->OpenFlow(TEXT("side"));
		return Engine;
	};

	// --- SerializeState / DeserializeState: a round trip -------------------------------
	UStoryletEngine* Engine = Played();
	if (!TestNotNull(TEXT("a played engine"), Engine)) return false;
	const FString Saved = UStoryletSave::SerializeState(Engine);
	TestTrue(TEXT("SerializeState writes a save"), Saved.Contains(TEXT("storylets/savefile@1")));
	{
		UStoryletEngine* Fresh = UStoryletEngine::Create(Bundle, {});
		if (!TestNotNull(TEXT("a fresh engine"), Fresh)) return false;
		TestTrue(TEXT("DeserializeState loads it"), UStoryletSave::DeserializeState(Fresh, Saved));
		UStoryletFlow* Main = Fresh->GetFlow(TEXT("main"));
		if (TestNotNull(TEXT("main came back"), Main))
		{
			TestEqual(TEXT("with its own steps"), Main->GetPropertyNumber(TEXT("story.steps")), 1.0);
			const TArray<FStoryletHandContents> Board = Main->Board();
			TestEqual(TEXT("and its hand"), Board.Num() ? Board[0].Cards.Num() : 0, 1);
		}
		TestEqual(TEXT("the shared gold came back"), Fresh->GetPropertyNumber(TEXT("story.gold")), 1.0);
		TestNotNull(TEXT("side came back"), Fresh->GetFlow(TEXT("side")));
		TestEqual(TEXT("and it saves as it loaded"), UStoryletSave::SerializeState(Fresh), Saved);

		FStoryletLoadReport Report;
		UStoryletEngine* Reported = UStoryletEngine::Create(Bundle, {});
		TestTrue(TEXT("DeserializeStateWithReport loads it"), UStoryletSave::DeserializeStateWithReport(Reported, Saved, Report));
		TestTrue(TEXT("with an exact report"), Report.bExact);
		TestEqual(TEXT("naming both flows"), FString::Join(Report.Flows, TEXT(",")), FString(TEXT("main,side")));

		AddExpectedError(TEXT("DeserializeState - not a storylets save"), EAutomationExpectedErrorFlags::Contains, 1);
		TestFalse(TEXT("DeserializeState refuses what is not a save"), UStoryletSave::DeserializeState(Fresh, TEXT("{}")));
		AddExpectedError(TEXT("PreviewLoad - not a storylets save"), EAutomationExpectedErrorFlags::Contains, 1);
		FStoryletLoadReport Refused;
		Refused.Project = TEXT("stale");
		TestFalse(TEXT("PreviewLoad refuses it too"), UStoryletSave::PreviewLoad(Fresh, TEXT("{}"), Refused));
		TestTrue(TEXT("with a default report"), Refused.Project.IsEmpty());
	}

	// --- the names before Patterplay's still work ---------------------------------------
	{
		TestEqual(TEXT("SaveStateToJson writes what SerializeState writes"), UStoryletSave::SaveStateToJson(Engine), Saved);
		UStoryletEngine* Fresh = UStoryletEngine::Create(Bundle, {});
		if (!TestNotNull(TEXT("a fresh engine"), Fresh)) return false;
		TestTrue(TEXT("LoadStateFromJson loads it"), UStoryletSave::LoadStateFromJson(Fresh, Saved));
		TestEqual(TEXT("to the same state"), UStoryletSave::SerializeState(Fresh), Saved);
		AddExpectedError(TEXT("LoadStateFromJson - not a storylets save"), EAutomationExpectedErrorFlags::Contains, 1);
		TestFalse(TEXT("and still refuses, under its own name"), UStoryletSave::LoadStateFromJson(Fresh, TEXT("{}")));

		FString Json;
		TestTrue(TEXT("LoadStateFromJsonWithReport loads it"), UStoryletSave::LoadStateFromJsonWithReport(Fresh, Saved, Json));
		TestTrue(TEXT("with a JSON report"), Json.Contains(TEXT("\"exact\": true")));
		TestTrue(TEXT("PreviewLoadFromJson answers"), UStoryletSave::PreviewLoadFromJson(Fresh, Saved).Contains(TEXT("\"exact\": true")));

		const FString Parked = Engine->SaveFlowToJson(TEXT("main"));
		TestTrue(TEXT("PreviewFlowRestoreJson answers"), Fresh->PreviewFlowRestoreJson(TEXT("visit"), Parked).Contains(TEXT("\"flows\": [\"visit\"]")));
		FString Restored;
		TestNotNull(TEXT("OpenFlowFromJson opens"), Fresh->OpenFlowFromJson(TEXT("visit"), Parked, Restored));
		TestTrue(TEXT("with a JSON report"), Restored.Contains(TEXT("\"flows\": [\"visit\"]")));

		FString Durable;
		TestTrue(TEXT("LoadDurableFromJson loads"), Fresh->LoadDurableFromJson(Engine->SaveDurableToJson(), Durable));
		TestTrue(TEXT("with a JSON report"), Durable.Contains(TEXT("\"exact\"")));
		const FString Pocket = Engine->GetFlow(TEXT("main"))->SaveDurableToJson();
		FString PocketJson;
		TestNotNull(TEXT("OpenFlowWithDurableJson opens"), Fresh->OpenFlowWithDurableJson(TEXT("pocket"), Pocket, PocketJson));
		TestTrue(TEXT("with a JSON report"), PocketJson.Contains(TEXT("\"flows\": [\"pocket\"]")));
		FString SeededJson;
		TestNotNull(TEXT("OpenFlowWithDurableJsonSeeded opens"), Fresh->OpenFlowWithDurableJsonSeeded(TEXT("seeded"), Pocket, 7, SeededJson));
		TestTrue(TEXT("with a JSON report"), SeededJson.Contains(TEXT("\"flows\": [\"seeded\"]")));

		FString SwapError, SwapJson;
		TestTrue(TEXT("ApplyLiveBundleWithReport swaps"), Fresh->ApplyLiveBundleWithReport(Bundle, SwapError, SwapJson));
		TestTrue(TEXT("with a JSON report"), SwapJson.Contains(TEXT("\"project\": \"proj_names\"")));
		FString LinkError, LinkJson;
		PRAGMA_DISABLE_DEPRECATION_WARNINGS
		const bool bLinked = FStoryletLiveLink::ApplyLiveBundle(Fresh, NamesBundleJson, LinkError, LinkJson);
		PRAGMA_ENABLE_DEPRECATION_WARNINGS
		TestTrue(TEXT("the Live Link's JSON-report ApplyLiveBundle swaps"), bLinked);
		TestTrue(TEXT("with a JSON report"), LinkJson.Contains(TEXT("\"project\": \"proj_names\"")));
	}

	// --- FStoryletLoadReport is the JSON report, field for field ---------------------------
	{
		// A drifted load: the edit evicts main's held heist, drops each flow's
		// steps and defaults their mood, under a new version and hash.
		UStoryletEngine* ByJson = UStoryletEngine::Create(Edited, {});
		UStoryletEngine* ByStruct = UStoryletEngine::Create(Edited, {});
		if (!TestNotNull(TEXT("edited engines"), ByJson) || !TestNotNull(TEXT("edited engine"), ByStruct)) return false;
		FString Json;
		FStoryletLoadReport Report;
		TestTrue(TEXT("the drifted save loads (JSON)"), UStoryletSave::LoadStateFromJsonWithReport(ByJson, Saved, Json));
		TestTrue(TEXT("the drifted save loads (struct)"), UStoryletSave::DeserializeStateWithReport(ByStruct, Saved, Report));
		TestFalse(TEXT("the report is not exact"), Report.bExact);
		TestEqual(TEXT("it evicts the held heist"), Report.Evicted.Num(), 1);
		if (Report.Evicted.Num() == 1)
		{
			TestEqual(TEXT("from main"), Report.Evicted[0].Flow, FString(TEXT("main")));
			TestEqual(TEXT("from q"), Report.Evicted[0].Hand, FString(TEXT("q")));
			TestEqual(TEXT("the heist"), Report.Evicted[0].Card, FString(TEXT("heist")));
			TestEqual(TEXT("because it vanished"), Report.Evicted[0].Reason, FString(TEXT("vanished")));
		}
		TestTrue(TEXT("it drops steps"), Report.DroppedProperties.Num() > 0);
		TestTrue(TEXT("it defaults mood"), Report.DefaultedProperties.Num() > 0);
		TestEqual(TEXT("the version drift"), Report.Version.Saved + TEXT(">") + Report.Version.Bundle, FString(TEXT("1.0.0>1.0.1")));
		TestEqual(TEXT("the hash drift"), Report.Hash.Saved + TEXT(">") + Report.Hash.Bundle, FString(TEXT("nameshash>nameshash2")));
		TestEqual(TEXT("the load's struct is its JSON, field for field"), AsReportJson(Report), Json);

		UStoryletEngine* Previewing = UStoryletEngine::Create(Edited, {});
		FStoryletLoadReport Preview;
		TestTrue(TEXT("PreviewLoad answers"), UStoryletSave::PreviewLoad(Previewing, Saved, Preview));
		TestEqual(TEXT("the preview's struct is its JSON"), AsReportJson(Preview), UStoryletSave::PreviewLoadFromJson(Previewing, Saved));
		TestEqual(TEXT("and the preview is the load's report"), AsReportJson(Preview), Json);

		// One flow restored into the edit.
		const FString Parked = Engine->SaveFlowToJson(TEXT("main"));
		FStoryletLoadReport FlowPreview;
		TestTrue(TEXT("PreviewFlowRestore answers"), Previewing->PreviewFlowRestore(TEXT("main"), Parked, FlowPreview));
		TestEqual(TEXT("its struct is its JSON"), AsReportJson(FlowPreview), Previewing->PreviewFlowRestoreJson(TEXT("main"), Parked));
		UStoryletEngine* RestoreJson = UStoryletEngine::Create(Edited, {});
		UStoryletEngine* RestoreStruct = UStoryletEngine::Create(Edited, {});
		FString FlowJson;
		FStoryletLoadReport FlowReport;
		TestNotNull(TEXT("OpenFlowFromJson restores"), RestoreJson->OpenFlowFromJson(TEXT("main"), Parked, FlowJson));
		TestNotNull(TEXT("OpenFlowRestoring restores"), RestoreStruct->OpenFlowRestoring(TEXT("main"), Parked, FlowReport));
		TestEqual(TEXT("the restore's struct is its JSON"), AsReportJson(FlowReport), FlowJson);
		TestEqual(TEXT("the restore evicts the heist"), FlowReport.Evicted.Num(), 1);

		// The durable halves.
		const FString Memory = Engine->SaveDurableToJson();
		const FString Pocket = Engine->GetFlow(TEXT("main"))->SaveDurableToJson();
		FString MemoryJson, PocketJson, SeededJson;
		FStoryletLoadReport MemoryReport, PocketReport, SeededReport;
		TestTrue(TEXT("LoadDurableFromJson"), RestoreJson->LoadDurableFromJson(Memory, MemoryJson));
		TestTrue(TEXT("LoadDurable"), RestoreStruct->LoadDurable(Memory, MemoryReport));
		TestEqual(TEXT("the durable load's struct is its JSON"), AsReportJson(MemoryReport), MemoryJson);
		RestoreJson->OpenFlowWithDurableJson(TEXT("p"), Pocket, PocketJson);
		RestoreStruct->OpenFlowWithDurable(TEXT("p"), Pocket, PocketReport);
		TestEqual(TEXT("the pocket's struct is its JSON"), AsReportJson(PocketReport), PocketJson);
		RestoreJson->OpenFlowWithDurableJsonSeeded(TEXT("s"), Pocket, 3, SeededJson);
		RestoreStruct->OpenFlowWithDurableSeeded(TEXT("s"), Pocket, 3, SeededReport);
		TestEqual(TEXT("the seeded pocket's struct is its JSON"), AsReportJson(SeededReport), SeededJson);

		// A live swap onto the edit.
		UStoryletEngine* SwapJsonEngine = Played();
		UStoryletEngine* SwapStructEngine = Played();
		FString SwapError, SwapJson;
		FStoryletLoadReport SwapReport;
		TestTrue(TEXT("ApplyLiveBundleWithReport"), SwapJsonEngine->ApplyLiveBundleWithReport(Edited, SwapError, SwapJson));
		TestTrue(TEXT("ApplyLiveBundleWithLoadReport"), SwapStructEngine->ApplyLiveBundleWithLoadReport(Edited, SwapError, SwapReport));
		TestEqual(TEXT("the swap's struct is its JSON"), AsReportJson(SwapReport), SwapJson);
		TestEqual(TEXT("the swap evicts the heist"), SwapReport.Evicted.Num(), 1);
		UStoryletEngine* LinkEngine = Played();
		FStoryletLoadReport LinkReport;
		TestTrue(TEXT("the Live Link's ApplyLiveBundle takes the struct"),
			FStoryletLiveLink::ApplyLiveBundle(LinkEngine, EditedBundleJson(), SwapError, LinkReport));
		TestEqual(TEXT("and fills it as the engine's does"), AsReportJson(LinkReport), SwapJson);
	}

	// --- OnTrace: every flow's trace as a Blueprint event -----------------------------------
	{
		UStoryletEngine* Logged = UStoryletEngine::CreateWithOptions(Bundle, FStoryletEngineOptions{ 0, true }, {});
		if (!TestNotNull(TEXT("an engine with the log on"), Logged)) return false;
		UStoryletReplacedFlowListener* Listener = NewObject<UStoryletReplacedFlowListener>();
		Logged->OnTrace.AddDynamic(Listener, &UStoryletReplacedFlowListener::OnTraceEntry);

		UStoryletFlow* Main = Logged->OpenFlow(TEXT("main"));
		UStoryletFlow* Side = Logged->OpenFlow(TEXT("side"));
		if (!TestNotNull(TEXT("main"), Main) || !TestNotNull(TEXT("side"), Side)) return false;
		const TArray<FStoryletDealtCard> Hand = Main->Deal(TEXT("q"));
		if (!TestEqual(TEXT("the heist is dealt"), Hand.Num(), 1)) return false;
		TestTrue(TEXT("and played"), Main->Play(Hand[0].GameId, TEXT("go"), TEXT("q"), Error));
		Side->Deal(TEXT("q"));

		const TArray<FStoryletLogEntry>& Traces = Listener->Traces;
		if (!TestTrue(TEXT("OnTrace fired"), Traces.Num() > 0)) return false;
		const FStoryletLogEntry& Deal = Traces[0];
		TestTrue(TEXT("first, main's deal"), Deal.Kind == EStoryletLogKind::Deal);
		TestEqual(TEXT("naming its flow"), Deal.Flow, FString(TEXT("main")));
		TestEqual(TEXT("and its hand"), Deal.Hand, FString(TEXT("q")));
		if (TestEqual(TEXT("with the card it considered"), Deal.Cards.Num(), 1))
		{
			TestEqual(TEXT("the heist"), Deal.Cards[0].GameId, FString(TEXT("heist")));
			TestEqual(TEXT("dealt"), Deal.Cards[0].Verdict, FString(TEXT("dealt")));
		}
		const FStoryletLogEntry* Play = Traces.FindByPredicate([](const FStoryletLogEntry& E) { return E.Kind == EStoryletLogKind::Play; });
		if (TestNotNull(TEXT("the play fired"), Play))
		{
			TestEqual(TEXT("in main"), Play->Flow, FString(TEXT("main")));
			TestEqual(TEXT("the heist"), Play->Card, FString(TEXT("heist")));
			TestEqual(TEXT("to go"), Play->Outcome, FString(TEXT("go")));
			TestTrue(TEXT("with the box's new turn"), Play->bHasTurn && Play->Turn == 1.0);
		}
		const FStoryletLogEntry* Write = Traces.FindByPredicate([](const FStoryletLogEntry& E)
			{ return E.Kind == EStoryletLogKind::Write && E.Path == TEXT("story.gold"); });
		if (TestNotNull(TEXT("the play's write fired"), Write))
		{
			TestEqual(TEXT("with the value it landed"), Write->ValueJson, FString(TEXT("1")));
			TestEqual(TEXT("and the one it replaced"), Write->PrevJson, FString(TEXT("0")));
		}
		TestEqual(TEXT("last, side's deal"), Traces.Last().Flow + TEXT(":") + FString::FromInt(static_cast<int32>(Traces.Last().Kind)),
			FString(TEXT("side:")) + FString::FromInt(static_cast<int32>(EStoryletLogKind::Deal)));
		TestEqual(TEXT("OnTrace carried every event the run's log kept, in order"), Kinds(Traces), Kinds(Logged->GetRunLog()));

		// Unbound, the next verb stops the trace: nothing more arrives.
		const int32 Before = Traces.Num();
		Logged->OnTrace.RemoveAll(Listener);
		Main->Deal(TEXT("q"));
		TestEqual(TEXT("an unbound OnTrace hears nothing"), Listener->Traces.Num(), Before);

		// With the log off, the event still fires.
		UStoryletEngine* Quiet = UStoryletEngine::Create(Bundle, {});
		UStoryletReplacedFlowListener* QuietListener = NewObject<UStoryletReplacedFlowListener>();
		Quiet->OnTrace.AddDynamic(QuietListener, &UStoryletReplacedFlowListener::OnTraceEntry);
		Quiet->OpenFlow(TEXT("main"))->Deal(TEXT("q"));
		TestEqual(TEXT("with the log off, OnTrace still hears the deal"), QuietListener->Traces.Num(), 1);
		TestEqual(TEXT("and nothing was retained"), Quiet->GetRunLog().Num(), 0);
	}
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
