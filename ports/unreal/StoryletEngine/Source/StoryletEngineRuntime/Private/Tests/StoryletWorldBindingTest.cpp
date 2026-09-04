// The bound-@world seam at the UE boundary (the core's own behaviour is held
// by the conformance corpus): a UStoryletWorld given to Create is read by the
// engine, written by outcomes, refuses the game's read-only names, rides in a
// save and is restored by a load, and survives ApplyLiveBundle. Runs via
// -ExecCmds="Automation RunTests StoryletEngine.World".

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "StoryletBundle.h"
#include "StoryletEngine.h"
#include "StoryletSave.h"
#include "StoryletTypes.h"
#include "StoryletWorld.h"

namespace
{
	// Three @world properties: knows_road (the story learns it), weather (the
	// story may write it; this GAME says no), time_of_day (writable: false,
	// the STORY's promise). Card "road" is gated on knows_road; card "inn"
	// has outcomes that write knows_road and weather.
	const TCHAR* WorldBundleJson = TEXT(R"JSON({
  "schema": "storylets/bundle@0",
  "content": { "project": "proj_world", "version": "1.0.0", "hash": "worldhash" },
  "metadata": "full",
  "settings": { "playAdvancesTurns": 1 },
  "world": { "properties": [
    { "name": "knows_road", "type": "boolean", "default": false },
    { "name": "weather", "type": "string", "default": "clear" },
    { "name": "time_of_day", "type": "enum", "values": ["day", "night"], "default": "day", "writable": false }
  ] },
  "story": { "properties": [] },
  "boxes": [
    {
      "id": "b_main", "gameId": "main", "title": "Main",
      "ranking": { "specificity": true },
      "fields": [], "properties": [], "tagGroups": [],
      "decks": [
        {
          "id": "k_main", "gameId": "deck", "title": "Deck",
          "cards": [
            {
              "id": "c_inn", "gameId": "inn", "title": "Inn",
              "outcomes": [
                { "id": "o_learn", "gameId": "learn", "title": "Learn",
                  "changes": { "@world.knows_road": { "src": "true", "ast": ["b", true] } } },
                { "id": "o_rain", "gameId": "rain", "title": "Rain",
                  "changes": { "@world.weather": { "src": "\"storm\"", "ast": ["s", "storm"] } } }
              ]
            },
            {
              "id": "c_road", "gameId": "road", "title": "Road",
              "condition": { "src": "@world.knows_road", "ast": ["sv", "world", "knows_road"] },
              "outcomes": []
            }
          ]
        }
      ],
      "handTemplates": [],
      "hands": [
        { "id": "h_board", "gameId": "board", "title": "Board", "rule": { "bindings": {}, "slots": 2 } }
      ]
    }
  ]
})JSON");

	bool HandHas(const TArray<FStoryletDealtCard>& Hand, const TCHAR* GameId)
	{
		for (const FStoryletDealtCard& C : Hand) if (C.GameId == GameId) return true;
		return false;
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryletWorldBindingTest,
	"StoryletEngine.World",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FStoryletWorldBindingTest::RunTest(const FString& Parameters)
{
	FString Error;
	UStoryletBundle* Bundle = UStoryletBundle::LoadFromJsonString(WorldBundleJson, Error);
	if (!TestNotNull(TEXT("bundle compiles"), Bundle)) return false;

	// --- the game's container, bound at Create ---------------------------------
	UStoryletWorld* World = NewObject<UStoryletWorld>(GetTransientPackage());
	World->SetString(TEXT("time_of_day"), TEXT("night"));
	World->SetReadOnly(TEXT("weather"), true);
	TestTrue(TEXT("weather is the game's"), World->IsReadOnly(TEXT("weather")));
	TestFalse(TEXT("knows_road is not"), World->IsReadOnly(TEXT("knows_road")));

	UStoryletEngine* Engine = UStoryletEngine::Create(Bundle, 0, false, World);
	if (!TestNotNull(TEXT("engine with world"), Engine)) return false;
	TestEqual(TEXT("GetBoundWorld"), Engine->GetBoundWorld(), World);

	UStoryletFlow* Flow = Engine->OpenFlow(TEXT("main"));
	if (!TestNotNull(TEXT("flow opens"), Flow)) return false;

	// --- reads go through the container. A name the host has not set is "no
	// property" to a path read (the JS reference's deliberate guard: a default
	// silently standing in for a missing host value was Patter's old bug),
	// while a deal treats it as its declared default, as the gating below shows.
	TestEqual(TEXT("time_of_day read from the host"), Flow->GetPropertyString(TEXT("world.time_of_day")), FString(TEXT("night")));
	AddExpectedMessage(TEXT("no property at \"world.weather\""), ELogVerbosity::Warning, EAutomationExpectedMessageFlags::Contains, 1);
	TestEqual(TEXT("weather unset is no property"), Flow->GetPropertyString(TEXT("world.weather")), FString());

	TArray<FStoryletDealtCard> Hand = Flow->Deal(TEXT("board"));
	TestTrue(TEXT("inn dealt"), HandHas(Hand, TEXT("inn")));
	TestFalse(TEXT("road gated on knows_road"), HandHas(Hand, TEXT("road")));

	// --- an outcome writes through to the container ----------------------------
	TestTrue(TEXT("play learn"), Flow->Play(TEXT("inn"), TEXT("learn"), TEXT("board"), Error));
	TestTrue(TEXT("knows_road landed in the container"), World->GetBool(TEXT("knows_road")));
	Hand = Flow->Deal(TEXT("board"));
	TestTrue(TEXT("road dealt once known"), HandHas(Hand, TEXT("road")));

	// --- the game's read-only policy refuses the story, not the host ------------
	TestFalse(TEXT("rain refused"), Flow->Play(TEXT("inn"), TEXT("rain"), TEXT("board"), Error));
	TestTrue(TEXT("refusal names the policy"), Error.Contains(TEXT("game's alone")));
	TestFalse(TEXT("weather untouched"), World->Has(TEXT("weather")));
	World->SetString(TEXT("weather"), TEXT("fog"));
	TestEqual(TEXT("the host still writes it"), Flow->GetPropertyString(TEXT("world.weather")), FString(TEXT("fog")));

	// --- save carries the container's values; load restores them, policy or not
	const FString Saved = UStoryletSave::SaveStateToJson(Engine);
	TestTrue(TEXT("save mentions knows_road"), Saved.Contains(TEXT("knows_road")));
	World->SetBool(TEXT("knows_road"), false);
	World->SetString(TEXT("weather"), TEXT("storm"));
	TestTrue(TEXT("load"), UStoryletSave::LoadStateFromJson(Engine, Saved));
	TestTrue(TEXT("knows_road restored"), World->GetBool(TEXT("knows_road")));
	TestEqual(TEXT("read-only weather restored by the host's load"), World->GetString(TEXT("weather")), FString(TEXT("fog")));
	TestEqual(TEXT("time_of_day restored"), World->GetString(TEXT("time_of_day")), FString(TEXT("night")));

	// --- the binding survives a live refresh -------------------------------------
	TestTrue(TEXT("live refresh"), Engine->ApplyLiveBundle(Bundle, Error));
	TestEqual(TEXT("still bound"), Engine->GetBoundWorld(), World);
	World->SetBool(TEXT("knows_road"), false);
	Flow = Engine->GetFlow(TEXT("main"));
	if (!TestNotNull(TEXT("flow survives refresh"), Flow)) return false;
	Hand = Flow->Deal(TEXT("board"));
	TestFalse(TEXT("road gated again through the same container"), HandHas(Hand, TEXT("road")));

	// --- and the self-backed path is unchanged -------------------------------------
	UStoryletEngine* Plain = UStoryletEngine::Create(Bundle);
	if (!TestNotNull(TEXT("self-backed engine"), Plain)) return false;
	TestNull(TEXT("no world bound"), Plain->GetBoundWorld());
	UStoryletFlow* PlainFlow = Plain->OpenFlow(TEXT("main"));
	TestEqual(TEXT("self-backed reads the default"), PlainFlow->GetPropertyString(TEXT("world.time_of_day")), FString(TEXT("day")));
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
