// One registry per game at the UE boundary (the core's own behaviour is held
// by the clang TestHost's port of the JS one-registry tests): an engine made
// with CreateWithRegistry registers its bags in the game's registry, a save
// leaves their values to the game, a token clash refuses the second engine and
// leaves the registry as it was, and ApplyLiveBundle hands every value over to
// the new core. Runs via -ExecCmds="Automation RunTests StoryletEngine.Registry".

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "StoryletBundle.h"
#include "StoryletEngine.h"
#include "StoryletSave.h"
#include "StoryletTypes.h"

#include "Storylets/Kernel.h"   // the shared kernel (Expr/), its names in `storylets`, and kernelCall

namespace
{
	// @world.alarm, a shared @story.gold and a per-flow @story.steps, and one
	// card whose outcome bumps all three: the JS one-registry test's bundle,
	// less its deck property and tag.
	const TCHAR* RegistryBundleJson = TEXT(R"JSON({
  "schema": "storylets/bundle@0",
  "content": { "project": "proj_registry", "version": "1.0.0", "hash": "registryhash" },
  "metadata": "full",
  "settings": { "playAdvancesTurns": 1 },
  "world": { "properties": [ { "name": "alarm", "type": "number", "default": 0 } ] },
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
                  "@story.steps": { "src": "@story.steps + 1", "ast": ["bin", "+", ["sv", "story", "steps"], ["n", 1]] },
                  "@world.alarm": { "src": "@world.alarm + 1", "ast": ["bin", "+", ["sv", "world", "alarm"], ["n", 1]] }
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

	/** The game's registry, with @world registered by the game as a property
	 *  the registry stores. */
	std::shared_ptr<storylets::ScopeRegistry> GameRegistry()
	{
		auto Registry = std::make_shared<storylets::ScopeRegistry>();
		storylets::ScopeDeclaration Alarm;
		Alarm.name = "alarm";
		Alarm.type = storylets::PropertyTypes::Number;
		Alarm.defaultValue = storylets::StoryletValue::Num(0);
		storylets::OwnedScopeOptions Options;
		Options.owner = std::string("Game");
		Registry->defineOwned("world", std::vector<storylets::ScopeDeclaration>{Alarm}, Options);
		return Registry;
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryletRegistryTest,
	"StoryletEngine.Registry",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FStoryletRegistryTest::RunTest(const FString& Parameters)
{
	// The clash below is refused with a log naming the holder.
	AddExpectedError(TEXT("scope '@story' is already registered by Storylet Engine"), EAutomationExpectedErrorFlags::Contains, 1);

	FString Error;
	UStoryletBundle* Bundle = UStoryletBundle::LoadFromJsonString(RegistryBundleJson, Error);
	if (!TestNotNull(TEXT("bundle compiles"), Bundle)) return false;

	const std::shared_ptr<storylets::ScopeRegistry> Registry = GameRegistry();
	UStoryletEngine* Engine = UStoryletEngine::CreateWithRegistry(Bundle, Registry);
	if (!TestNotNull(TEXT("engine on the game's registry"), Engine)) return false;
	TestTrue(TEXT("GetRegistry is the game's"), Engine->GetRegistry() == Registry);
	TestTrue(TEXT("@story is registered"), Registry->has("story"));
	TestFalse(TEXT("no flow bag before a flow opens"), Registry->has("storylets/flow/main/story"));

	UStoryletFlow* Flow = Engine->OpenFlow(TEXT("main"));
	if (!TestNotNull(TEXT("flow opens"), Flow)) return false;
	TestTrue(TEXT("the flow's bag is registered"), Registry->has("storylets/flow/main/story"));
	TArray<FStoryletDealtCard> Hand = Flow->Deal(TEXT("q"));
	if (!TestEqual(TEXT("heist dealt"), Hand.Num(), 1)) return false;
	TestTrue(TEXT("play"), Flow->Play(Hand[0].GameId, TEXT("go"), TEXT("q"), Error));
	TestEqual(TEXT("the registry holds gold"), Registry->get("story", "gold")->asNumber(), 1.0);
	TestEqual(TEXT("and the game's @world"), Registry->get("world", "alarm")->asNumber(), 1.0);

	// A save leaves the values to the game, which saves the registry once.
	const FString Saved = UStoryletSave::SaveStateToJson(Engine);
	TestTrue(TEXT("the envelope is version 2"), Saved.Contains(TEXT("storylets/save@2")));
	TestFalse(TEXT("and carries no registry"), Saved.Contains(TEXT("\"registry\"")));

	// A second engine wanting the same token is refused, naming the first.
	UStoryletEngine* Second = UStoryletEngine::CreateWithRegistry(Bundle, Registry);
	TestNull(TEXT("a second engine on the same registry is refused"), Second);
	TestEqual(TEXT("steps is still the first engine's"), Flow->GetPropertyNumber(TEXT("story.steps")), 1.0);

	// The live swap hands every value over to the new core.
	TestTrue(TEXT("live refresh"), Engine->ApplyLiveBundle(Bundle, Error));
	Flow = Engine->GetFlow(TEXT("main"));
	if (!TestNotNull(TEXT("flow survives refresh"), Flow)) return false;
	TestEqual(TEXT("gold survives"), Engine->GetPropertyNumber(TEXT("story.gold")), 1.0);
	TestEqual(TEXT("steps survives"), Flow->GetPropertyNumber(TEXT("story.steps")), 1.0);
	TestTrue(TEXT("still registered"), Registry->has("storylets/flow/main/story"));

	// Standalone, the envelope carries the values itself.
	UStoryletEngine* Plain = UStoryletEngine::Create(Bundle);
	if (!TestNotNull(TEXT("standalone engine"), Plain)) return false;
	TestTrue(TEXT("its own registry"), Plain->GetRegistry() && Plain->GetRegistry() != Registry);
	Plain->OpenFlow(TEXT("main"));
	TestTrue(TEXT("a standalone save carries its registry"), UStoryletSave::SaveStateToJson(Plain).Contains(TEXT("\"registry\"")));
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
