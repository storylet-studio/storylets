// Field and stage helpers at the Blueprint boundary (patterkit
// design/family-parity-2026-10.md item 7, patter-qualities.md section 3). The
// corpus's card-field case is the behaviour gate, replayed by the clang
// TestHost over the same core; this test exercises the crossing: a dealt
// card's raw fields filled in through the bundle asset, a quality field's
// ladder read off it, and the stage functions with their refusal. Runs via
// -ExecCmds="Automation RunTests StoryletEngine".

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "StoryletBundle.h"
#include "StoryletEngine.h"
#include "StoryletStages.h"
#include "StoryletTypes.h"

namespace
{
	// Box "box" declares a quality field `act` and a text field `cue` on its
	// card template, and an outcome field `after`. Its one card sets `act` only.
	const TCHAR* FieldsBundleJson = TEXT(R"JSON({
  "schema": "storylets/bundle@1",
  "content": { "project": "proj_fields", "version": "1.0.0", "hash": "" },
  "metadata": "full",
  "settings": { "playAdvancesTurns": 1 },
  "world": { "properties": [] },
  "story": { "properties": [] },
  "boxes": [
    { "id": "b_x", "gameId": "box", "ranking": { "specificity": true },
      "fields": [
        { "name": "act", "type": "quality", "default": "arrival", "stages": ["arrival", "act-1", "act-2"] },
        { "name": "cue", "type": "text", "default": "" }],
      "outcomeFields": [{ "name": "after", "type": "text", "default": "Done." }],
      "properties": [], "tagGroups": [],
      "decks": [{ "id": "k_x", "gameId": "main", "properties": [], "cards": [
        { "id": "c_one", "gameId": "one", "priority": 0, "redraw": "always", "fields": { "act": "act-1" }, "outcomes": [] }] }],
      "handTemplates": [],
      "hands": [{ "id": "h_x", "gameId": "here", "rule": { "slots": 1 } }] }
  ]
})JSON");

	const FStoryletFieldEntry* FieldNamed(const TArray<FStoryletFieldEntry>& Fields, const TCHAR* Name)
	{
		return Fields.FindByPredicate([Name](const FStoryletFieldEntry& E) { return E.Name == Name; });
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryletFieldsTest,
	"StoryletEngine.Fields",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FStoryletFieldsTest::RunTest(const FString& Parameters)
{
	FString Error;
	UStoryletBundle* Bundle = UStoryletBundle::LoadFromJsonString(FieldsBundleJson, Error);
	if (!TestNotNull(TEXT("the bundle compiles"), Bundle)) return false;
	UStoryletEngine* Engine = UStoryletEngine::Create(Bundle);
	if (!TestNotNull(TEXT("engine created"), Engine)) return false;
	UStoryletFlow* Flow = Engine->OpenFlow(TEXT("main"));
	if (!TestNotNull(TEXT("flow opened"), Flow)) return false;

	TArray<FStoryletDealtCard> Dealt = Flow->Deal(TEXT("here"));
	if (!TestEqual(TEXT("one card dealt"), Dealt.Num(), 1)) return false;

	// Raw: only what the card sets.
	TestEqual(TEXT("raw fields are the card's own"), Dealt[0].Fields.Num(), 1);

	// Effective: every declared field, the card's value where it sets one.
	{
		const TArray<FStoryletFieldEntry> Full = Bundle->GetEffectiveCardFields(TEXT("box"), Dealt[0].Fields);
		TestEqual(TEXT("both declared fields"), Full.Num(), 2);
		const FStoryletFieldEntry* Act = FieldNamed(Full, TEXT("act"));
		const FStoryletFieldEntry* Cue = FieldNamed(Full, TEXT("cue"));
		if (TestNotNull(TEXT("act present"), Act)) TestEqual(TEXT("act is the card's"), Act->Value.String, FString(TEXT("act-1")));
		if (TestNotNull(TEXT("cue present"), Cue)) TestEqual(TEXT("cue is the default"), Cue->Value.String, FString());
		TestEqual(TEXT("an unknown box declares nothing"), Bundle->GetEffectiveCardFields(TEXT("nowhere"), Dealt[0].Fields).Num(), 1);
	}
	{
		const TArray<FStoryletFieldEntry> Outcome = Bundle->GetEffectiveOutcomeFields(TEXT("box"), TArray<FStoryletFieldEntry>());
		const FStoryletFieldEntry* After = FieldNamed(Outcome, TEXT("after"));
		if (TestNotNull(TEXT("outcome default filled in"), After)) TestEqual(TEXT("after"), After->Value.String, FString(TEXT("Done.")));
	}

	// The ladder, read off the declaration, and the stage functions over it.
	const TArray<FString> Stages = Bundle->GetFieldStages(TEXT("box"), TEXT("act"), false);
	TestEqual(TEXT("the act ladder"), FString::Join(Stages, TEXT(",")), FString(TEXT("arrival,act-1,act-2")));
	TestEqual(TEXT("a text field has no ladder"), Bundle->GetFieldStages(TEXT("box"), TEXT("cue"), false).Num(), 0);

	TestEqual(TEXT("index"), UStoryletStages::StageIndex(Stages, TEXT("act-2")), 2);
	TestEqual(TEXT("index of no stage"), UStoryletStages::StageIndex(Stages, TEXT("finale")), -1);
	{
		int32 Result = 0;
		FString StageError;
		TestTrue(TEXT("compare succeeds"), UStoryletStages::CompareStages(Stages, TEXT("act-1"), TEXT("arrival"), Result, StageError));
		TestEqual(TEXT("act-1 is past arrival"), Result, 1);
		TestFalse(TEXT("compare refuses a name that is not a stage"), UStoryletStages::CompareStages(Stages, TEXT("finale"), TEXT("arrival"), Result, StageError));
		TestTrue(TEXT("and says which"), StageError.Contains(TEXT("\"finale\" is not a stage of this quality")));
	}
	{
		FString Next;
		FString StageError;
		TestTrue(TEXT("next succeeds"), UStoryletStages::NextStage(Stages, TEXT("act-1"), Next, StageError));
		TestEqual(TEXT("one rung up"), Next, FString(TEXT("act-2")));
		UStoryletStages::NextStage(Stages, TEXT("act-2"), Next, StageError);
		TestEqual(TEXT("stays on the top rung"), Next, FString(TEXT("act-2")));
		TestFalse(TEXT("next refuses a name that is not a stage"), UStoryletStages::NextStage(Stages, TEXT("finale"), Next, StageError));
	}
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
