// One registry per game at the UE boundary (the core's own behaviour is held
// by the clang TestHost's port of the JS one-registry tests): an engine made
// with CreateWithRegistry registers its bags in the game's registry, a save
// leaves their values to the game, a token clash refuses the second engine and
// leaves the registry as it was, and ApplyLiveBundle (the core's hotSwap) carries
// every value over to the new core, drops what an edit dropped, and touches
// nothing another engine keeps there. Beside it, a card naming another engine's
// scope (`@patter.gold`): the bundle's `externalScopes` read through the asset
// path, the write landing in the game's registry, and a flow (or a save) that
// names it where nobody registered it refused before anything changes, the
// refusal reaching the output log the way every refused open or load does. Runs via
// -ExecCmds="Automation RunTests StoryletEngine.Registry".

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "StoryletBundle.h"
#include "StoryletEngine.h"
#include "StoryletSave.h"
#include "StoryletTypes.h"

#include "StoryletCompiledBundle.h"   // the parsed core bundle behind the asset
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

	/** The compiler test's card naming another engine's scope, as the compiler
	 *  writes it (the TS compiler test's "other engines' scopes"): gated on
	 *  `@patter.visits >= 1`, changing `@patter.gold` to `@patter.gold - 1`. */
	const TCHAR* PatronBundleJson = TEXT(R"JSON({"schema":"storylets/bundle@0","content":{"project":"p","version":"0.0.1","hash":"16f2jt4"},"metadata":"full","settings":{"playAdvancesTurns":1},"world":{"properties":[]},"story":{"properties":[]},"boxes":[{"id":"b_1","gameId":"b1","ranking":{"specificity":true},"fields":[],"properties":[],"tagGroups":[{"id":"d_1","gameId":"d1","tags":[{"id":"v_1","gameId":"v1"}]}],"decks":[{"id":"k_1","gameId":"main","properties":[],"cards":[{"id":"c_1","gameId":"c1","condition":{"src":"@patter.visits >= 1","ast":["bin",">=",["sv","patter","visits"],["n",1]]},"priority":0,"redraw":"always","outcomes":[{"id":"o_1","gameId":"go","changes":{"@patter.gold":{"src":"@patter.gold - 1","ast":["bin","-",["sv","patter","gold"],["n",1]]}}}]}]}],"handTemplates":[],"hands":[{"id":"h_1","gameId":"h1","rule":{"slots":1}}]}],"externalScopes":["patter"]})JSON");

	/** Another engine's game-wide scope, registered as that engine would. */
	void RegisterPatter(storylets::ScopeRegistry& Registry, double Gold, double Visits)
	{
		storylets::ScopeDeclaration G;
		G.name = "gold";
		G.type = storylets::PropertyTypes::Number;
		G.defaultValue = storylets::StoryletValue::Num(Gold);
		storylets::ScopeDeclaration V;
		V.name = "visits";
		V.type = storylets::PropertyTypes::Number;
		V.defaultValue = storylets::StoryletValue::Num(Visits);
		storylets::OwnedScopeOptions Options;
		Options.owner = std::string("Patter");
		Registry.defineOwned("patter", std::vector<storylets::ScopeDeclaration>{G, V}, Options);
	}

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

	// An edited build: the per-flow @story.steps is gone and @story gains
	// rumours. The swap carries the run across, and the dropped property is
	// dropped from the game's registry rather than left there as a stray; a
	// value another engine keeps there, and one waiting for another engine, are
	// never touched.
	{
		FString EditedJson = RegistryBundleJson;
		const int32 Replaced = EditedJson.ReplaceInline(
			TEXT(R"({ "name": "steps", "type": "number", "default": 0, "shared": false })"),
			TEXT(R"({ "name": "rumours", "type": "number", "default": 0 })"));
		TestEqual(TEXT("the edit applies"), Replaced, 1);
		EditedJson.ReplaceInline(
			TEXT(R"("@story.steps": { "src": "@story.steps + 1", "ast": ["bin", "+", ["sv", "story", "steps"], ["n", 1]] },)"),
			TEXT(""));
		UStoryletBundle* Edited = UStoryletBundle::LoadFromJsonString(EditedJson, Error);
		if (!TestNotNull(TEXT("the edited bundle compiles"), Edited)) return false;
		RegisterPatter(*Registry, 3, 4);
		storylets::ScopeRegistry::SaveBlob Waiting;
		storylets::OrderedMap<std::string, storylets::StoryletValue> Drawn;
		Drawn.set("drawn", storylets::StoryletValue::Num(2));
		Waiting.set("other/deck/inn", Drawn);
		Registry->load(Waiting, /*keepParked=*/true);
		TestTrue(TEXT("live refresh to the edit"), Engine->ApplyLiveBundle(Edited, Error));
		TestEqual(TEXT("gold carries"), Engine->GetPropertyNumber(TEXT("story.gold")), 1.0);
		TestEqual(TEXT("rumours takes its default"), Engine->GetPropertyNumber(TEXT("story.rumours")), 0.0);
		TestFalse(TEXT("the dropped property left the registry"), Registry->save().contains("storylets/flow/main/story"));
		TestEqual(TEXT("Patter's value is untouched"), Registry->get("patter", "visits")->asNumber(), 4.0);
		TestTrue(TEXT("a value waiting for another engine waits on"), Registry->save().contains("other/deck/inn"));
		Flow = Engine->GetFlow(TEXT("main"));
		if (!TestNotNull(TEXT("flow survives the edit"), Flow)) return false;
		Hand = Flow->Deal(TEXT("q"));
		if (!TestEqual(TEXT("heist dealt after the edit"), Hand.Num(), 1)) return false;
		TestTrue(TEXT("play after the edit"), Flow->Play(Hand[0].GameId, TEXT("go"), TEXT("q"), Error));
		TestEqual(TEXT("the registry's gold after the edit"), Registry->get("story", "gold")->asNumber(), 2.0);
	}

	// Standalone, the envelope carries the values itself.
	UStoryletEngine* Plain = UStoryletEngine::Create(Bundle);
	if (!TestNotNull(TEXT("standalone engine"), Plain)) return false;
	TestTrue(TEXT("its own registry"), Plain->GetRegistry() && Plain->GetRegistry() != Registry);
	Plain->OpenFlow(TEXT("main"));
	TestTrue(TEXT("a standalone save carries its registry"), UStoryletSave::SaveStateToJson(Plain).Contains(TEXT("\"registry\"")));

	// A card naming another engine's scope. The asset path reads the bundle's
	// externalScopes; on the game's registry the card reads and writes it there.
	UStoryletBundle* Patron = UStoryletBundle::LoadFromJsonString(PatronBundleJson, Error);
	if (!TestNotNull(TEXT("the patron bundle compiles"), Patron)) return false;
	TestTrue(TEXT("its externalScopes are read"),
		Patron->GetCompiled()->Bundle->externalScopes == std::vector<std::string>{"patter"});
	{
		const std::shared_ptr<storylets::ScopeRegistry> Game = GameRegistry();
		RegisterPatter(*Game, 3, 1);
		UStoryletEngine* Card = UStoryletEngine::CreateWithRegistry(Patron, Game);
		if (!TestNotNull(TEXT("engine beside Patter"), Card)) return false;
		UStoryletFlow* Main = Card->OpenFlow(TEXT("main"));
		if (!TestNotNull(TEXT("its flow"), Main)) return false;
		TArray<FStoryletDealtCard> Dealt = Main->Deal(TEXT("h1"));
		if (!TestEqual(TEXT("the card gated on @patter.visits is dealt"), Dealt.Num(), 1)) return false;
		TestTrue(TEXT("play it"), Main->Play(Dealt[0].GameId, TEXT("go"), TEXT("h1"), Error));
		TestEqual(TEXT("it wrote Patter's value"), Game->get("patter", "gold")->asNumber(), 2.0);
	}
	// Nobody registered @patter: the open is refused, and so is a save made
	// where Patter was present, loaded where it is not, before anything changes.
	// Each refusal is the core's StoryletError, logged as an error, the way the
	// wrapper reports every refused open or load.
	{
		AddExpectedErrorPlain(
			TEXT("this content names @patter, which no engine on this registry registered: give every engine the game's one registry"),
			EAutomationExpectedErrorFlags::Contains, 2);
		UStoryletEngine* Alone = UStoryletEngine::Create(Patron);
		if (!TestNotNull(TEXT("a standalone engine"), Alone)) return false;
		TestNull(TEXT("the open is refused"), Alone->OpenFlow(TEXT("main")));
		TestNull(TEXT("and leaves no flow behind"), Alone->GetFlow(TEXT("main")));

		const std::shared_ptr<storylets::ScopeRegistry> Game = GameRegistry();
		RegisterPatter(*Game, 3, 1);
		UStoryletEngine* Played = UStoryletEngine::CreateWithRegistry(Patron, Game);
		if (!TestNotNull(TEXT("engine beside Patter"), Played)) return false;
		UStoryletFlow* Main = Played->OpenFlow(TEXT("main"));
		if (!TestNotNull(TEXT("its flow"), Main)) return false;
		Main->Deal(TEXT("h1"));
		const FString Save = UStoryletSave::SaveStateToJson(Played);

		const std::shared_ptr<storylets::ScopeRegistry> Elsewhere = GameRegistry();
		RegisterPatter(*Elsewhere, 3, 1);
		UStoryletEngine* Other = UStoryletEngine::CreateWithRegistry(Patron, Elsewhere);
		if (!TestNotNull(TEXT("a second engine"), Other)) return false;
		UStoryletFlow* Keep = Other->OpenFlow(TEXT("keep"));
		if (!TestNotNull(TEXT("its flow"), Keep)) return false;
		Elsewhere->remove("patter");
		TestFalse(TEXT("the load is refused"), UStoryletSave::LoadStateFromJson(Other, Save));
		TestFalse(TEXT("the load changed nothing"), Keep->IsClosed());
		TestEqual(TEXT("the flows are still only keep"), Other->Flows().Num(), 1);
		TestNull(TEXT("and none was restored"), Other->GetFlow(TEXT("main")));
	}
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
