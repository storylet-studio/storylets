// GetFlow after a load, through the Blueprint wrapper. Runs via
//   -ExecCmds="Automation RunTests StoryletEngine.Flows"
//
// The UE-boundary half the clang TestHost cannot reach: the core's getFlow
// answers with every restored flow, and the fault was in the wrapper's own
// list of the UStoryletFlow objects it handed out. GetFlow looked only in that
// list, so a flow a load restored into an engine that never opened it had no
// wrapper and came back null, which is the pattern the site's Unreal page
// shows (a load into a freshly made registry and engine, then
// GetFlow("main")). The JS engine.getFlow answers with every restored flow.
// Beside it, the rule the same list broke from the other side: a wrapper
// whose flow was replaced or closed stays closed, and the load's re-bind must
// not point it at the restored flow of the same name.

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "StoryletBundle.h"
#include "StoryletEngine.h"
#include "StoryletSave.h"
#include "StoryletTypes.h"

#include "Storylets/Kernel.h"   // the shared kernel (Expr/), its names in `storylets`
#include "Storylets/Save.h"     // saveRegistry / loadRegistry, as the site's example uses them

namespace
{
	// A shared @story.gold and a per-flow @story.steps, and one card whose
	// outcome bumps both: enough for a flow to carry state through a save.
	const TCHAR* FlowsBundleJson = TEXT(R"JSON({
  "schema": "storylets/bundle@0",
  "content": { "project": "proj_flows", "version": "1.0.0", "hash": "flowshash" },
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
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryletFlowsTest,
	"StoryletEngine.Flows",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FStoryletFlowsTest::RunTest(const FString& Parameters)
{
	FString Error;
	UStoryletBundle* Bundle = UStoryletBundle::LoadFromJsonString(FlowsBundleJson, Error);
	if (!TestNotNull(TEXT("bundle compiles"), Bundle)) return false;

	// --- the game's registry: the site's example, as written ---------------------
	{
		auto Registry = std::make_shared<storylets::ScopeRegistry>();
		UStoryletEngine* Engine = UStoryletEngine::CreateWithRegistry(Bundle, Registry);
		if (!TestNotNull(TEXT("engine on the game's registry"), Engine)) return false;
		UStoryletFlow* Flow = Engine->OpenFlow(TEXT("main"));
		if (!TestNotNull(TEXT("flow opens"), Flow)) return false;
		TArray<FStoryletDealtCard> Hand = Flow->Deal(TEXT("q"));
		if (!TestEqual(TEXT("heist dealt"), Hand.Num(), 1)) return false;
		TestTrue(TEXT("play"), Flow->Play(Hand[0].GameId, TEXT("go"), TEXT("q"), Error));

		const std::string RegistryText = storylets::saveRegistry(*Registry);
		const FString StoryletsText = UStoryletSave::SaveStateToJson(Engine);

		// Loading, into a freshly made registry and engine.
		auto Registry2 = std::make_shared<storylets::ScopeRegistry>();
		UStoryletEngine* Engine2 = UStoryletEngine::CreateWithRegistry(Bundle, Registry2);
		if (!TestNotNull(TEXT("a fresh engine on a fresh registry"), Engine2)) return false;
		storylets::loadRegistry(*Registry2, RegistryText);
		TestTrue(TEXT("the save loads into the fresh engine"), UStoryletSave::LoadStateFromJson(Engine2, StoryletsText));
		UStoryletFlow* Restored = Engine2->GetFlow(TEXT("main"));
		if (TestNotNull(TEXT("GetFlow hands back the flow the load restored"), Restored))
		{
			TestFalse(TEXT("and it is live"), Restored->IsClosed());
			TestEqual(TEXT("and it carries the flow's own value"), Restored->GetPropertyNumber(TEXT("story.steps")), 1.0);
			TestEqual(TEXT("asking again gives the same wrapper"), Engine2->GetFlow(TEXT("main")), Restored);
		}
		TestEqual(TEXT("Flows lists the restored flow"), Engine2->Flows().Num(), 1);
		TestNull(TEXT("GetFlow still answers null for a name the save did not carry"), Engine2->GetFlow(TEXT("nope")));
	}

	// --- standalone: the envelope carries everything ----------------------------------
	{
		UStoryletEngine* Engine = UStoryletEngine::Create(Bundle);
		if (!TestNotNull(TEXT("standalone engine"), Engine)) return false;
		Engine->OpenFlow(TEXT("main"));
		Engine->OpenFlow(TEXT("side"));
		const FString Saved = UStoryletSave::SaveStateToJson(Engine);

		UStoryletEngine* Fresh = UStoryletEngine::Create(Bundle);
		if (!TestNotNull(TEXT("a fresh standalone engine"), Fresh)) return false;
		TestTrue(TEXT("the save loads into an engine that never opened a flow"), UStoryletSave::LoadStateFromJson(Fresh, Saved));
		TestNotNull(TEXT("GetFlow hands back main"), Fresh->GetFlow(TEXT("main")));
		TestNotNull(TEXT("GetFlow hands back side"), Fresh->GetFlow(TEXT("side")));
		TestEqual(TEXT("Flows lists both"), Fresh->Flows().Num(), 2);
	}

	// --- a replaced or closed wrapper stays closed through the load's re-bind ----------
	{
		UStoryletEngine* Engine = UStoryletEngine::Create(Bundle);
		if (!TestNotNull(TEXT("engine"), Engine)) return false;
		UStoryletFlow* First = Engine->OpenFlow(TEXT("main"));
		UStoryletFlow* Second = Engine->OpenFlow(TEXT("main"));
		UStoryletFlow* Gone = Engine->OpenFlow(TEXT("gone"));
		if (!TestNotNull(TEXT("first"), First) || !TestNotNull(TEXT("second"), Second) || !TestNotNull(TEXT("gone"), Gone)) return false;
		Engine->CloseFlow(TEXT("gone"));
		TestTrue(TEXT("the replaced wrapper is closed"), First->IsClosed());
		TestTrue(TEXT("the closed wrapper is closed"), Gone->IsClosed());
		TestEqual(TEXT("GetFlow after a reopen hands back the live wrapper"), Engine->GetFlow(TEXT("main")), Second);

		// A save that carries both names, loaded back over the same engine.
		UStoryletEngine* Donor = UStoryletEngine::Create(Bundle);
		Donor->OpenFlow(TEXT("main"));
		Donor->OpenFlow(TEXT("gone"));
		TestTrue(TEXT("the donor's save loads"), UStoryletSave::LoadStateFromJson(Engine, UStoryletSave::SaveStateToJson(Donor)));
		TestTrue(TEXT("a replaced wrapper is still closed after a load"), First->IsClosed());
		TestTrue(TEXT("a closed wrapper is still closed after a load"), Gone->IsClosed());
		TestFalse(TEXT("the held live wrapper answers for the restored flow"), Second->IsClosed());
		TestEqual(TEXT("GetFlow after the load hands back the held wrapper"), Engine->GetFlow(TEXT("main")), Second);
		UStoryletFlow* RestoredGone = Engine->GetFlow(TEXT("gone"));
		TestTrue(TEXT("GetFlow hands back a fresh wrapper for the restored 'gone'"), RestoredGone && RestoredGone != Gone && !RestoredGone->IsClosed());
	}
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
