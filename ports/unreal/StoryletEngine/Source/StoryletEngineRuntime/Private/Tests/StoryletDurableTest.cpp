// Durable state through the Blueprint wrapper (round 2 ruling H, design
// engine-review-2026-10.md 6). Runs via
//   -ExecCmds="Automation RunTests StoryletEngine.Durable"
//
// What outlives a run is a public feature: the engine's half (the
// installation's memory) and a flow's half (the player's pocket), each a JSON
// string as a parked flow is. The clang TestHost runs the corpus's durable
// cases through the core's string pair; this is the UE-boundary half it cannot
// reach: SaveDurableToJson on the engine and on a flow, LoadDurableFromJson and
// OpenFlowWithDurableJson with their reports, and every refusal logged and
// answered with an empty result, never an exception.

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "StoryletBundle.h"
#include "StoryletEngine.h"
#include "StoryletTypes.h"

namespace
{
	// A shared durable @story.souls, a per-flow durable @story.visits, a
	// per-flow durable @story.seal the story may not write, and a run-scoped
	// shared @story.gold. Two one-shots: c_once, whose spend is the player's,
	// and c_relic, in a shared durable deck, whose spend is the world's.
	const TCHAR* DurableBundleJson = TEXT(R"JSON({
  "schema": "storylets/bundle@0",
  "content": { "project": "proj_durable", "version": "1.0.0", "hash": "durablehash" },
  "metadata": "full",
  "settings": { "playAdvancesTurns": 1 },
  "world": { "properties": [] },
  "story": { "properties": [
    { "name": "souls", "type": "number", "default": 0, "durable": true },
    { "name": "visits", "type": "number", "default": 0, "shared": false, "durable": true },
    { "name": "seal", "type": "number", "default": 0, "shared": false, "durable": true, "writable": false },
    { "name": "gold", "type": "number", "default": 0 }
  ] },
  "boxes": [
    {
      "id": "b_x", "gameId": "box", "ranking": { "specificity": true },
      "fields": [], "properties": [], "tagGroups": [],
      "decks": [
        {
          "id": "k_main", "gameId": "main", "properties": [],
          "cards": [ { "id": "c_once", "gameId": "once", "priority": 2, "redraw": "never", "durable": true, "outcomes": [] } ]
        },
        {
          "id": "k_relics", "gameId": "relics", "shared": true, "durable": true, "properties": [],
          "cards": [ { "id": "c_relic", "gameId": "relic", "priority": 1, "redraw": "never", "outcomes": [] } ]
        }
      ],
      "handTemplates": [],
      "hands": [ { "id": "h_q", "gameId": "q", "rule": { "bindings": {}, "slots": "unbounded" } } ]
    }
  ]
})JSON");
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryletDurableTest,
	"StoryletEngine.Durable",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FStoryletDurableTest::RunTest(const FString& Parameters)
{
	FString Error;
	UStoryletBundle* Bundle = UStoryletBundle::LoadFromJsonString(DurableBundleJson, Error);
	if (!TestNotNull(TEXT("bundle compiles"), Bundle))
	{
		AddError(Error);
		return false;
	}

	// --- the first run: every durable value moved, both one-shots spent ---------------
	UStoryletEngine* First = UStoryletEngine::Create(Bundle);
	if (!TestNotNull(TEXT("first engine"), First)) return false;
	UStoryletFlow* Alice = First->OpenFlow(TEXT("alice"));
	if (!TestNotNull(TEXT("alice opens"), Alice)) return false;
	First->SetPropertyNumber(TEXT("story.souls"), 3);
	First->SetPropertyNumber(TEXT("story.gold"), 5);
	Alice->SetPropertyNumber(TEXT("story.visits"), 2);
	Alice->SetPropertyNumber(TEXT("story.seal"), 9);
	const TArray<FStoryletDealtCard> Dealt = Alice->Deal(TEXT("q"));
	if (!TestEqual(TEXT("both one-shots are dealt"), Dealt.Num(), 2)) return false;
	for (const FStoryletDealtCard& Card : Dealt)
	{
		FString PlayError;
		if (!TestTrue(TEXT("a one-shot plays"), Alice->Play(Card.GameId, FString(), TEXT("q"), PlayError))) AddError(PlayError);
	}

	const FString Memory = First->SaveDurableToJson();
	const FString Pocket = Alice->SaveDurableToJson();
	TestTrue(TEXT("the memory carries the schema tag"), Memory.Contains(TEXT("\"storylets/durable@1\"")));
	TestTrue(TEXT("the memory carries souls by address"), Memory.Contains(TEXT("\"story.souls\": 3")));
	TestTrue(TEXT("the memory carries the relic by gameId"), Memory.Contains(TEXT("\"spent\": [\"relic\"]")));
	TestFalse(TEXT("the memory leaves run-scoped gold behind"), Memory.Contains(TEXT("story.gold")));
	TestFalse(TEXT("the memory leaves the pocket's values to the pocket"), Memory.Contains(TEXT("story.visits")));
	TestTrue(TEXT("the pocket carries visits"), Pocket.Contains(TEXT("\"story.visits\": 2")));
	TestTrue(TEXT("the pocket carries seal"), Pocket.Contains(TEXT("\"story.seal\": 9")));
	TestTrue(TEXT("the pocket carries its own spend"), Pocket.Contains(TEXT("\"spent\": [\"once\"]")));

	// --- a new run: the memory in, then alice's pocket ---------------------------------
	UStoryletEngine* Next = UStoryletEngine::Create(Bundle);
	if (!TestNotNull(TEXT("next engine"), Next)) return false;
	FString MemoryReport;
	TestTrue(TEXT("the memory loads"), Next->LoadDurableFromJson(Memory, MemoryReport));
	TestTrue(TEXT("its report is exact"), MemoryReport.Contains(TEXT("\"exact\": true")));
	TestTrue(TEXT("and restores no flow"), MemoryReport.Contains(TEXT("\"flows\": []")));
	TestEqual(TEXT("souls came across"), Next->GetPropertyNumber(TEXT("story.souls")), 3.0);
	TestEqual(TEXT("gold did not"), Next->GetPropertyNumber(TEXT("story.gold")), 0.0);
	TestEqual(TEXT("a new run has no flows"), Next->Flows().Num(), 0);

	FString PocketReport;
	UStoryletFlow* Back = Next->OpenFlowWithDurableJson(TEXT("alice"), Pocket, PocketReport);
	if (!TestNotNull(TEXT("alice opens with her pocket"), Back)) return false;
	TestTrue(TEXT("the pocket's report is exact"), PocketReport.Contains(TEXT("\"exact\": true")));
	TestTrue(TEXT("and names her flow"), PocketReport.Contains(TEXT("\"flows\": [\"alice\"]")));
	TestEqual(TEXT("visits came across"), Back->GetPropertyNumber(TEXT("story.visits")), 2.0);
	TestEqual(TEXT("a value the story may not write still goes back"), Back->GetPropertyNumber(TEXT("story.seal")), 9.0);
	TestEqual(TEXT("her spend is still spent, and the relic for everyone"), Back->Deal(TEXT("q")).Num(), 0);
	UStoryletFlow* Bob = Next->OpenFlow(TEXT("bob"));
	if (!TestNotNull(TEXT("bob opens"), Bob)) return false;
	const TArray<FStoryletDealtCard> BobDealt = Bob->Deal(TEXT("q"));
	TestEqual(TEXT("a newcomer finds c_once and nothing else"), BobDealt.Num(), 1);
	TestEqual(TEXT("which is c_once"), BobDealt.Num() == 1 ? BobDealt[0].GameId : FString(), FString(TEXT("once")));
	TestEqual(TEXT("the memory saves as it loaded"), Next->SaveDurableToJson(), Memory);
	TestEqual(TEXT("the pocket saves as it opened"), Back->SaveDurableToJson(), Pocket);

	// --- the seeded durable open: the flow's own seed in place of the engine's ----------
	{
		UStoryletEngine* Seeded = UStoryletEngine::Create(Bundle);
		UStoryletEngine* ByEngine = UStoryletEngine::Create(Bundle, 7);
		if (!TestNotNull(TEXT("engines"), Seeded) || !TestNotNull(TEXT("seeded engine"), ByEngine)) return false;
		FString SeededReport;
		UStoryletFlow* SeededFlow = Seeded->OpenFlowWithDurableJsonSeeded(TEXT("alice"), Pocket, 7, SeededReport);
		FString ByEngineReport;
		ByEngine->OpenFlowWithDurableJson(TEXT("alice"), Pocket, ByEngineReport);
		if (!TestNotNull(TEXT("the seeded durable open opens"), SeededFlow)) return false;
		TestTrue(TEXT("with the pocket's report"), SeededReport.Contains(TEXT("\"exact\": true")));
		TestEqual(TEXT("the pocket is in"), SeededFlow->GetPropertyNumber(TEXT("story.visits")), 2.0);
		TestEqual(TEXT("a pocket opened on seed 7 starts where an engine seeded 7 starts"),
			Seeded->SaveFlowToJson(TEXT("alice")), ByEngine->SaveFlowToJson(TEXT("alice")));
		TestNotEqual(TEXT("and not where the engine's own seed starts"),
			Seeded->SaveFlowToJson(TEXT("alice")), Next->SaveFlowToJson(TEXT("alice")));
	}

	// --- a value no property can hold is reported, not refused ---------------------------
	{
		UStoryletEngine* Fresh = UStoryletEngine::Create(Bundle);
		if (!TestNotNull(TEXT("fresh engine"), Fresh)) return false;
		FString NullReport;
		TestTrue(TEXT("a memory holding a null loads"),
			Fresh->LoadDurableFromJson(Memory.Replace(TEXT("\"story.souls\": 3"), TEXT("\"story.souls\": null")), NullReport));
		TestTrue(TEXT("and reports the null as retyped"),
			NullReport.Contains(TEXT("\"retypedProperties\": [{ \"path\": \"story.souls\" }]")));
		TestEqual(TEXT("souls keeps its default"), Fresh->GetPropertyNumber(TEXT("story.souls")), 0.0);
	}

	// --- refusals: logged, an empty answer, and nothing moved ----------------------------
	const FString Foreign = Memory.Replace(TEXT("\"proj_durable\""), TEXT("\"other\""));
	AddExpectedError(TEXT("LoadDurableFromJson - durable state is for project \"other\", bundle is \"proj_durable\""),
		EAutomationExpectedErrorFlags::Contains, 1);
	FString ForeignReport = TEXT("stale");
	TestFalse(TEXT("another project's memory is refused"), Next->LoadDurableFromJson(Foreign, ForeignReport));
	TestTrue(TEXT("with an empty report"), ForeignReport.IsEmpty());

	const FString Unknown = Memory.Replace(TEXT("storylets/durable@1"), TEXT("storylets/durable@9"));
	AddExpectedError(TEXT("LoadDurableFromJson - unsupported durable schema: storylets/durable@9"),
		EAutomationExpectedErrorFlags::Contains, 1);
	TestFalse(TEXT("an unknown schema is refused"), Next->LoadDurableFromJson(Unknown, ForeignReport));

	AddExpectedError(TEXT("LoadDurableFromJson - JSON parse error"), EAutomationExpectedErrorFlags::Contains, 1);
	TestFalse(TEXT("malformed JSON is refused"), Next->LoadDurableFromJson(TEXT("{ not json"), ForeignReport));
	TestEqual(TEXT("and the refusals moved nothing"), Next->SaveDurableToJson(), Memory);

	AddExpectedError(TEXT("OpenFlowWithDurableJson - durable state is for project \"other\""),
		EAutomationExpectedErrorFlags::Contains, 1);
	const FString ForeignPocket = Pocket.Replace(TEXT("\"proj_durable\""), TEXT("\"other\""));
	FString RefusedReport = TEXT("stale");
	TestNull(TEXT("another project's pocket is refused"), Next->OpenFlowWithDurableJson(TEXT("alice"), ForeignPocket, RefusedReport));
	TestTrue(TEXT("with an empty report"), RefusedReport.IsEmpty());
	TestFalse(TEXT("and the flow open under that name stays open"), Back->IsClosed());
	TestEqual(TEXT("as it was"), Back->GetPropertyNumber(TEXT("story.visits")), 2.0);

	Next->CloseFlow(TEXT("alice"));
	AddExpectedError(TEXT("SaveDurableToJson - flow \"alice\" is closed"), EAutomationExpectedErrorFlags::Contains, 1);
	TestTrue(TEXT("a closed flow has no pocket to give"), Back->SaveDurableToJson().IsEmpty());
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
