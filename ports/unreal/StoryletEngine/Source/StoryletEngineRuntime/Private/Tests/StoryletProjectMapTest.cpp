// The project map at the UObject boundary (design/project-map-contract.md).
// The corpus's PM cases are the behaviour gate, replayed by the clang TestHost
// over the same headers; this test exercises the seams the corpus cannot
// reach: a "storylets/bundle@1" asset compiling, the inspector's project map
// summary crossing into Blueprint structs, a zone dealt and written through
// UStoryletFlow, the box-qualified zone address refused by name, and a bundle
// that breaks the map's rules refused at Create rather than half-played. Runs
// via -ExecCmds="Automation RunTests StoryletEngine".

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "StoryletBundle.h"
#include "StoryletEngine.h"
#include "StoryletTypes.h"

namespace
{
	// Box "box" is on the map: its hand binds the zone "quay", and of its two
	// cards only the quay one may deal there. Box "other" is not on the map
	// and names no zone. The zones each declare `danger`, per flow.
	const TCHAR* ProjectMapBundleJson = TEXT(R"JSON({
  "schema": "storylets/bundle@1",
  "content": { "project": "proj_map", "version": "1.0.0", "hash": "maphash" },
  "metadata": "full",
  "settings": { "playAdvancesTurns": 1 },
  "world": { "properties": [] },
  "story": { "properties": [] },
  "boxes": [
    { "id": "b_x", "gameId": "box", "usesMap": true, "ranking": { "specificity": true },
      "fields": [], "properties": [], "tagGroups": [],
      "decks": [{ "id": "k_x", "gameId": "main", "properties": [], "cards": [
        { "id": "c_quay", "gameId": "quay_card", "priority": 1, "redraw": "always", "tags": { "d_district": ["v_quay"] }, "outcomes": [] },
        { "id": "c_hill", "gameId": "hill_card", "priority": 0, "redraw": "always", "tags": { "d_district": ["v_hill"] }, "outcomes": [] }] }],
      "handTemplates": [],
      "hands": [{ "id": "h_xq", "gameId": "xq", "rule": { "bindings": { "d_district": "v_quay" }, "slots": 2 } }] },
    { "id": "b_y", "gameId": "other", "ranking": { "specificity": true },
      "fields": [], "properties": [], "tagGroups": [],
      "decks": [{ "id": "k_y", "gameId": "main_y", "properties": [], "cards": [
        { "id": "c_plain", "gameId": "plain", "priority": 0, "redraw": "always", "outcomes": [] }] }],
      "handTemplates": [], "hands": [] }
  ],
  "map": {
    "group": { "id": "d_district", "gameId": "district", "tags": [
      { "id": "v_quay", "gameId": "quay", "properties": [{ "name": "danger", "type": "number", "default": 0 }] },
      { "id": "v_hill", "gameId": "hill", "properties": [{ "name": "danger", "type": "number", "default": 0 }] }] },
    "geometry": {
      "zones": [{ "tag": "quay", "polygon": [{ "x": 0, "y": 0 }, { "x": 4, "y": 0 }, { "x": 4, "y": 3 }] }],
      "sites": { "box": [{ "hand": "xq", "x": 1, "y": 2 }] }
    }
  }
})JSON");

	// A box on the map in a bundle with no map: it compiles as an asset (the
	// schema is one this runtime reads) and is refused when an engine is made.
	const TCHAR* NoMapBundleJson = TEXT(R"JSON({
  "schema": "storylets/bundle@1",
  "content": { "project": "proj_map", "version": "1.0.0", "hash": "" },
  "metadata": "full",
  "settings": { "playAdvancesTurns": 1 },
  "world": { "properties": [] },
  "story": { "properties": [] },
  "boxes": [
    { "id": "b_x", "gameId": "box", "usesMap": true, "ranking": { "specificity": true },
      "fields": [], "properties": [], "tagGroups": [], "decks": [], "handTemplates": [], "hands": [] }
  ]
})JSON");
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryletProjectMapTest,
	"StoryletEngine.ProjectMap",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FStoryletProjectMapTest::RunTest(const FString& Parameters)
{
	// The refusals below log one Error each by design; declare them so the
	// framework counts the intended refusals as the test passing.
	AddExpectedError(TEXT("is a zone of the project map, which belongs to no box"), EAutomationExpectedErrorFlags::Contains, 1);
	AddExpectedError(TEXT("bundle refused: box \"box\" uses the project map, but the bundle has no map"), EAutomationExpectedErrorFlags::Contains, 1);
	AddExpectedError(TEXT("not a storylets bundle this runtime reads: schema \"storylets/bundle@9\""), EAutomationExpectedErrorFlags::Contains, 1);

	FString Error;
	UStoryletBundle* Bundle = UStoryletBundle::LoadFromJsonString(ProjectMapBundleJson, Error);
	if (!TestNotNull(TEXT("a bundle@1 asset compiles"), Bundle)) return false;

	// The inspector: one map, which boxes are on it, the geometry counted.
	{
		const FStoryletBundleDescription D = Bundle->DescribeBundle();
		TestEqual(TEXT("describe schema"), D.Identity.Schema, FString(TEXT("storylets/bundle@1")));
		if (TestTrue(TEXT("describe reports the map"), D.bHasMap))
		{
			TestEqual(TEXT("map group"), D.Map.Group, FString(TEXT("district")));
			TestEqual(TEXT("map zones"), FString::Join(D.Map.Tags, TEXT(",")), FString(TEXT("quay,hill")));
			TestEqual(TEXT("boxes on the map"), FString::Join(D.Map.Boxes, TEXT(",")), FString(TEXT("box")));
			TestEqual(TEXT("drawn zones"), D.Map.Zones, 1);
			TestEqual(TEXT("pictures"), D.Map.Backgrounds, 0);
			if (TestEqual(TEXT("one box has sites"), D.Map.Sites.Num(), 1))
			{
				TestEqual(TEXT("sites box"), D.Map.Sites[0].Box, FString(TEXT("box")));
				TestEqual(TEXT("sites count"), D.Map.Sites[0].Sites, 1);
			}
		}
		if (TestEqual(TEXT("two boxes"), D.Boxes.Num(), 2))
		{
			TestTrue(TEXT("box is on the map"), D.Boxes[0].bUsesMap);
			TestFalse(TEXT("other is not"), D.Boxes[1].bUsesMap);
			TestEqual(TEXT("the map's group is no box's own"), D.Boxes[0].TagGroups.Num(), 0);
		}
		TestEqual(TEXT("the project group counted once"), D.Totals.TagGroups, 1);
		// world, story, then each zone as a tag scope with a group and no box.
		if (TestEqual(TEXT("property scopes"), D.Properties.Num(), 4))
		{
			TestEqual(TEXT("zone scope label"), D.Properties[2].Label, FString(TEXT("tag quay (district)")));
			TestTrue(TEXT("a zone belongs to no box"), D.Properties[2].Box.IsEmpty());
		}
	}

	UStoryletEngine* Engine = UStoryletEngine::Create(Bundle);
	if (!TestNotNull(TEXT("engine created"), Engine)) return false;
	UStoryletFlow* Flow = Engine->OpenFlow(TEXT("main"));
	if (!TestNotNull(TEXT("flow opened"), Flow)) return false;

	// A hand bound to a zone deals only that zone's card.
	{
		TArray<FStoryletDealtCard> Dealt = Flow->Deal(TEXT("xq"));
		if (TestEqual(TEXT("one card at the quay"), Dealt.Num(), 1))
		{
			TestEqual(TEXT("the quay card"), Dealt[0].GameId, FString(TEXT("quay_card")));
		}
		TMap<FString, FString> Criteria;
		Criteria.Add(TEXT("district"), TEXT("hill"));
		TArray<FStoryletDealtCard> Peeked = Flow->Peek(TEXT("box"), Criteria);
		if (TestEqual(TEXT("peek names the map's group in an opted-in box"), Peeked.Num(), 1))
		{
			TestEqual(TEXT("the hill card"), Peeked[0].GameId, FString(TEXT("hill_card")));
		}
	}

	// A zone's address is the short form; the box-qualified one is refused,
	// naming the form that works, and lands nothing.
	Flow->SetPropertyNumber(TEXT("value.quay.danger"), 3);
	TestEqual(TEXT("the zone's value lands"), Flow->GetPropertyNumber(TEXT("value.quay.danger")), 3.0);
	Flow->SetPropertyNumber(TEXT("value.box/quay.danger"), 9);
	TestEqual(TEXT("the box-qualified form lands nothing"), Flow->GetPropertyNumber(TEXT("value.quay.danger")), 3.0);

	// A box on the map with no map: the asset compiles, the engine refuses it.
	{
		FString NoMapError;
		UStoryletBundle* NoMap = UStoryletBundle::LoadFromJsonString(NoMapBundleJson, NoMapError);
		if (TestNotNull(TEXT("the no-map asset compiles"), NoMap))
		{
			TestNull(TEXT("Create refuses a box on a map that is not there"), UStoryletEngine::Create(NoMap));
		}
	}

	// A schema this runtime does not read is refused as an asset, by name.
	{
		FString SchemaError;
		UStoryletBundle* Future = UStoryletBundle::LoadFromJsonString(
			TEXT("{ \"schema\": \"storylets/bundle@9\", \"boxes\": [] }"), SchemaError);
		TestNull(TEXT("bundle@9 refused"), Future);
		TestTrue(TEXT("the refusal names the schema"), SchemaError.Contains(TEXT("storylets/bundle@9")));
	}
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
