// Storylet extension values at the Blueprint boundary (patterkit
// design/proposals/patter-storylet-extensions.md, "At runtime"). The corpus's
// two extension cases are the behaviour gate, replayed by the clang TestHost
// over the same core; this test exercises the crossing: values riding a dealt
// card, an outcome and a box view as JSON text, the defaults filled in through
// the bundle asset, the nodes no view carries read by address, the
// extension's settings, a scalar read
// back as a Storylet value, and a quality field's ladder handed to the stage
// functions. Runs via -ExecCmds="Automation RunTests StoryletEngine".

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "StoryletBundle.h"
#include "StoryletEngine.h"
#include "StoryletStages.h"
#include "StoryletTypes.h"

namespace
{
	// Extension "probe" declares for cards a quality `act`, a record `cue` and a
	// number `weight`; for boxes `theme`; for hands `seat`; for tags `colour`;
	// for outcomes `line`. The one card sets `act` and `cue`, its first outcome
	// `line`; the box, the hand and the tag `docks` set theirs.
	const TCHAR* ExtensionsBundleJson = TEXT(R"JSON({
  "schema": "storylets/bundle@1",
  "content": { "project": "proj_ext", "version": "1.0.0", "hash": "" },
  "metadata": "full",
  "settings": { "playAdvancesTurns": 1 },
  "world": { "properties": [] },
  "story": { "properties": [] },
  "boxes": [
    { "id": "b_x", "gameId": "box", "ranking": { "specificity": true },
      "fields": [], "properties": [],
      "extensions": { "probe": { "theme": "harbour" } },
      "tagGroups": [{ "id": "d_zone", "gameId": "zone", "tags": [
        { "id": "v_docks", "gameId": "docks", "extensions": { "probe": { "colour": "tar" } } },
        { "id": "v_market", "gameId": "market" }] }],
      "decks": [{ "id": "k_x", "gameId": "main", "properties": [], "cards": [
        { "id": "c_one", "gameId": "one", "priority": 0, "redraw": "always",
          "extensions": { "probe": { "act": "turn", "cue": { "sound": "bell", "gain": 0.5 } } },
          "outcomes": [
            { "id": "o_take", "gameId": "take", "changes": {}, "extensions": { "probe": { "line": "Taken." } } },
            { "id": "o_leave", "gameId": "leave", "changes": {} }] }] }],
      "handTemplates": [],
      "hands": [{ "id": "h_x", "gameId": "here", "rule": { "slots": 1 }, "extensions": { "probe": { "seat": "north" } } }] }
  ],
  "extensions": {
    "probe": {
      "version": "1.0.0",
      "fields": {
        "box": [{ "name": "theme", "type": "text", "default": "" }],
        "card": [
          { "name": "act", "type": "quality", "stages": ["setup", "turn", "close"], "default": "setup" },
          { "name": "cue", "type": "record", "default": { "sound": "", "gain": 0 },
            "fields": [{ "name": "sound", "type": "text", "default": "" }, { "name": "gain", "type": "number", "default": 0 }] },
          { "name": "weight", "type": "number", "min": 0, "max": 10, "default": 1 }],
        "hand": [{ "name": "seat", "type": "enum", "values": ["north", "south"], "default": "south" }],
        "outcome": [{ "name": "line", "type": "text", "default": "" }],
        "tag": [{ "name": "colour", "type": "text", "default": "grey" }]
      },
      "project": { "studio": "Wildwinter" },
      "settings": { "moodField": "temper", "soundField": "sound" }
    }
  }
})JSON");

	FString JsonOf(const TArray<FStoryletExtensionValues>& Extensions, const TCHAR* Extension, const TCHAR* Field)
	{
		FString Json;
		UStoryletBundle::FindExtensionValue(Extensions, Extension, Field, Json);
		return Json;
	}

	FString EntryJson(const TArray<FStoryletExtensionEntry>& Entries, const TCHAR* Name)
	{
		const FStoryletExtensionEntry* E = Entries.FindByPredicate([Name](const FStoryletExtensionEntry& X) { return X.Name == Name; });
		return E ? E->Json : FString(TEXT("<absent>"));
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryletExtensionsTest,
	"StoryletEngine.Extensions",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FStoryletExtensionsTest::RunTest(const FString& Parameters)
{
	FString Error;
	UStoryletBundle* Bundle = UStoryletBundle::LoadFromJsonString(ExtensionsBundleJson, Error);
	if (!TestNotNull(TEXT("the bundle compiles"), Bundle)) return false;
	UStoryletEngine* Engine = UStoryletEngine::Create(Bundle);
	if (!TestNotNull(TEXT("engine created"), Engine)) return false;
	UStoryletFlow* Flow = Engine->OpenFlow(TEXT("main"));
	if (!TestNotNull(TEXT("flow opened"), Flow)) return false;

	TArray<FStoryletDealtCard> Dealt = Flow->Deal(TEXT("here"));
	if (!TestEqual(TEXT("one card dealt"), Dealt.Num(), 1)) return false;

	// Raw on the card: only what it sets, a record as JSON text in bundle order.
	const TArray<FStoryletExtensionValues>& Raw = Dealt[0].Extensions;
	if (!TestEqual(TEXT("one extension on the card"), Raw.Num(), 1)) return false;
	TestEqual(TEXT("it is probe"), Raw[0].Extension, FString(TEXT("probe")));
	TestEqual(TEXT("raw values are the card's own"), Raw[0].Values.Num(), 2);
	TestEqual(TEXT("act"), JsonOf(Raw, TEXT("probe"), TEXT("act")), FString(TEXT("\"turn\"")));
	TestEqual(TEXT("cue, a record"), JsonOf(Raw, TEXT("probe"), TEXT("cue")), FString(TEXT("{\"sound\":\"bell\",\"gain\":0.5}")));
	{
		FString None;
		TestFalse(TEXT("a value the card does not set is not found"), UStoryletBundle::FindExtensionValue(Raw, TEXT("probe"), TEXT("weight"), None));
	}

	// Effective: every declared field, the card's value where it sets one.
	{
		const TArray<FStoryletExtensionEntry> Full = Bundle->GetEffectiveExtensionValues(TEXT("card"), TEXT("probe"), Raw);
		TestEqual(TEXT("all three declared fields"), Full.Num(), 3);
		TestEqual(TEXT("act is the card's"), EntryJson(Full, TEXT("act")), FString(TEXT("\"turn\"")));
		TestEqual(TEXT("weight is the default"), EntryJson(Full, TEXT("weight")), FString(TEXT("1")));
		const TArray<FStoryletExtensionEntry> Bare = Bundle->GetEffectiveExtensionValues(TEXT("card"), TEXT("probe"), TArray<FStoryletExtensionValues>());
		TestEqual(TEXT("a structured default arrives whole"), EntryJson(Bare, TEXT("cue")), FString(TEXT("{\"sound\":\"\",\"gain\":0}")));
		TestEqual(TEXT("an extension the bundle lacks declares nothing"),
			Bundle->GetEffectiveExtensionValues(TEXT("card"), TEXT("other"), Raw).Num(), 0);
	}

	// Outcomes and the box view carry theirs.
	{
		const TArray<FStoryletOutcomeView> Outcomes = Flow->Outcomes(TEXT("one"), TEXT("here"));
		if (TestEqual(TEXT("two outcomes"), Outcomes.Num(), 2))
		{
			TestEqual(TEXT("take's line"), JsonOf(Outcomes[0].Extensions, TEXT("probe"), TEXT("line")), FString(TEXT("\"Taken.\"")));
			TestEqual(TEXT("leave carries none"), Outcomes[1].Extensions.Num(), 0);
		}
		const TArray<FStoryletBoxView> Boxes = Flow->ListBoxes();
		if (TestEqual(TEXT("one box"), Boxes.Num(), 1))
		{
			TestEqual(TEXT("the box's theme"), JsonOf(Boxes[0].Extensions, TEXT("probe"), TEXT("theme")), FString(TEXT("\"harbour\"")));
		}
	}

	// The nodes no view carries, by address.
	TestEqual(TEXT("project"), JsonOf(Bundle->ExtensionsOf(TEXT("project"), FString()), TEXT("probe"), TEXT("studio")), FString(TEXT("\"Wildwinter\"")));
	TestEqual(TEXT("hand"), JsonOf(Bundle->ExtensionsOf(TEXT("hand"), TEXT("here")), TEXT("probe"), TEXT("seat")), FString(TEXT("\"north\"")));
	TestEqual(TEXT("tag"), JsonOf(Bundle->ExtensionsOf(TEXT("tag"), TEXT("box/docks")), TEXT("probe"), TEXT("colour")), FString(TEXT("\"tar\"")));
	TestEqual(TEXT("outcome"), JsonOf(Bundle->ExtensionsOf(TEXT("outcome"), TEXT("one/take")), TEXT("probe"), TEXT("line")), FString(TEXT("\"Taken.\"")));
	TestEqual(TEXT("a tag that sets none"), Bundle->ExtensionsOf(TEXT("tag"), TEXT("box/market")).Num(), 0);
	TestEqual(TEXT("an address that names nothing"), Bundle->ExtensionsOf(TEXT("deck"), TEXT("nowhere")).Num(), 0);
	TestEqual(TEXT("an unknown kind"), Bundle->ExtensionsOf(TEXT("shelf"), TEXT("main")).Num(), 0);
	TestEqual(TEXT("the market tag's default colour"),
		EntryJson(Bundle->GetEffectiveExtensionValues(TEXT("tag"), TEXT("probe"), Bundle->ExtensionsOf(TEXT("tag"), TEXT("box/market"))), TEXT("colour")),
		FString(TEXT("\"grey\"")));

	// The extension's settings, as the project resolved them.
	{
		const TMap<FString, FString> Settings = Bundle->ExtensionSettings(TEXT("probe"));
		TestEqual(TEXT("both settings"), Settings.Num(), 2);
		const FString* Mood = Settings.Find(TEXT("moodField"));
		TestEqual(TEXT("moodField"), Mood ? *Mood : FString(TEXT("<absent>")), FString(TEXT("temper")));
		const FString* Sound = Settings.Find(TEXT("soundField"));
		TestEqual(TEXT("soundField"), Sound ? *Sound : FString(TEXT("<absent>")), FString(TEXT("sound")));
		TestEqual(TEXT("an extension the bundle lacks has no settings"), Bundle->ExtensionSettings(TEXT("other")).Num(), 0);
	}

	// A scalar read back as a Storylet value; a record is not one.
	{
		FStoryletValue Value;
		TestTrue(TEXT("a string is a scalar"), UStoryletBundle::ExtensionValueToScalar(TEXT("\"turn\""), Value));
		TestEqual(TEXT("its kind"), Value.Kind, EStoryletValueKind::String);
		TestEqual(TEXT("its string"), Value.String, FString(TEXT("turn")));
		TestTrue(TEXT("a number is a scalar"), UStoryletBundle::ExtensionValueToScalar(TEXT("0.5"), Value));
		TestEqual(TEXT("its number"), Value.Number, 0.5);
		TestTrue(TEXT("a list of strings reads as flags"), UStoryletBundle::ExtensionValueToScalar(TEXT("[\"night\",\"rain\"]"), Value));
		TestEqual(TEXT("its flags"), Value.Flags.Num(), 2);
		TestFalse(TEXT("a record is not a scalar"), UStoryletBundle::ExtensionValueToScalar(TEXT("{\"sound\":\"bell\"}"), Value));
		TestFalse(TEXT("text that is not JSON is not a scalar"), UStoryletBundle::ExtensionValueToScalar(TEXT("bell"), Value));
	}

	// The declaration, with its ladder, and the stage functions over it.
	FStoryletFieldDecl Act;
	TestTrue(TEXT("act is declared"), Bundle->GetExtensionFieldDecl(TEXT("probe"), TEXT("card"), TEXT("act"), Act));
	TestEqual(TEXT("act is a quality"), Act.Type, FString(TEXT("quality")));
	TestEqual(TEXT("the act ladder"), FString::Join(Act.Stages, TEXT(",")), FString(TEXT("setup,turn,close")));
	TestEqual(TEXT("its scalar default"), Act.Default.String, FString(TEXT("setup")));
	TestEqual(TEXT("index"), UStoryletStages::StageIndex(Act, TEXT("close")), 2);
	{
		FString Next;
		FString StageError;
		TestTrue(TEXT("next succeeds"), UStoryletStages::NextStage(Act, TEXT("turn"), Next, StageError));
		TestEqual(TEXT("one rung up"), Next, FString(TEXT("close")));
	}
	{
		FStoryletFieldDecl Cue;
		TestTrue(TEXT("cue is declared"), Bundle->GetExtensionFieldDecl(TEXT("probe"), TEXT("card"), TEXT("cue"), Cue));
		TestEqual(TEXT("a record's default is JSON text only"), Cue.DefaultJson, FString(TEXT("{\"sound\":\"\",\"gain\":0}")));
		FStoryletFieldDecl None;
		TestFalse(TEXT("a field for another kind is not found"), Bundle->GetExtensionFieldDecl(TEXT("probe"), TEXT("deck"), TEXT("act"), None));
	}
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
