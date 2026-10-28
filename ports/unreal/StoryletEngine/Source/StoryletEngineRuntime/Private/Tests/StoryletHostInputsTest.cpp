// What the game hands in is checked, through the Blueprint wrapper (the
// hands-on review, 2026-10, foundation 5). Runs via
//   -ExecCmds="Automation RunTests StoryletEngine.HostInputs"
//
// The corpus pins the core's messages (the clang TestHost runs them); this is
// the UE-boundary half: a condition the engine could not evaluate reaches
// OnError, or a Warning in the log with nothing bound; a host write that does
// not fit its declaration is refused with the core's words and leaves the
// value alone; and a bundle or a save that is not one is refused by name.

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "StoryletBundle.h"
#include "StoryletEngine.h"
#include "StoryletSave.h"
#include "StoryletTypes.h"
#include "StoryletReplacedFlowListener.h"

namespace
{
	// @story.gold and @story.zero, and a card whose condition divides by zero:
	// the deal counts it false and reports it.
	const TCHAR* HostInputsBundleJson = TEXT(R"JSON({
  "schema": "storylets/bundle@0",
  "content": { "project": "proj_inputs", "version": "1.0.0", "hash": "inputshash" },
  "metadata": "full",
  "settings": { "playAdvancesTurns": 1 },
  "world": { "properties": [] },
  "story": { "properties": [
    { "name": "gold", "type": "number", "default": 2 },
    { "name": "zero", "type": "number", "default": 0 },
    { "name": "mood", "type": "enum", "values": ["calm", "tense"], "default": "calm" }
  ] },
  "boxes": [
    {
      "id": "b_x", "gameId": "box", "ranking": { "specificity": true },
      "fields": [], "properties": [], "tagGroups": [],
      "decks": [
        {
          "id": "k_main", "gameId": "main", "properties": [],
          "cards": [
            { "id": "c_fine", "gameId": "fine", "redraw": "always", "outcomes": [] },
            { "id": "c_broken", "gameId": "broken", "redraw": "always", "outcomes": [],
              "condition": { "src": "@story.gold / @story.zero > 1",
                "ast": ["bin", ">", ["bin", "/", ["sv", "story", "gold"], ["sv", "story", "zero"]], ["n", 1]] } }
          ]
        }
      ],
      "handTemplates": [],
      "hands": [ { "id": "h_q", "gameId": "q", "rule": { "bindings": {}, "slots": 2 } } ]
    }
  ]
})JSON");

	bool HandHas(const TArray<FStoryletDealtCard>& Hand, const FString& GameId)
	{
		for (const FStoryletDealtCard& Card : Hand)
		{
			if (Card.GameId == GameId) return true;
		}
		return false;
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryletHostInputsTest,
	"StoryletEngine.HostInputs",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FStoryletHostInputsTest::RunTest(const FString& Parameters)
{
	FString Error;
	UStoryletBundle* Bundle = UStoryletBundle::LoadFromJsonString(HostInputsBundleJson, Error);
	if (!TestNotNull(TEXT("bundle compiles"), Bundle)) return false;

	// --- OnError: the failed condition reaches Blueprint, tracing or not ---------------
	{
		UStoryletEngine* Engine = UStoryletEngine::Create(Bundle, {});
		if (!TestNotNull(TEXT("engine"), Engine)) return false;
		UStoryletReplacedFlowListener* Listener = NewObject<UStoryletReplacedFlowListener>();
		Engine->OnError.AddDynamic(Listener, &UStoryletReplacedFlowListener::OnPlayError);
		UStoryletFlow* Flow = Engine->OpenFlow(TEXT("main"));
		if (!TestNotNull(TEXT("flow"), Flow)) return false;
		const TArray<FStoryletDealtCard> Hand = Flow->Deal(TEXT("q"));
		TestTrue(TEXT("the fine card is dealt"), HandHas(Hand, TEXT("fine")));
		TestFalse(TEXT("the broken card counts as false"), HandHas(Hand, TEXT("broken")));
		if (TestEqual(TEXT("OnError fired once"), Listener->Errors.Num(), 1))
		{
			const FStoryletPlayError& Err = Listener->Errors[0];
			TestEqual(TEXT("its flow"), Err.Flow, FString(TEXT("main")));
			TestEqual(TEXT("its kind"), Err.Kind, FString(TEXT("condition")));
			TestEqual(TEXT("its node"), Err.Node, FString(TEXT("card broken")));
			TestEqual(TEXT("its source"), Err.Source, FString(TEXT("@story.gold / @story.zero > 1")));
			TestTrue(TEXT("its message"), Err.Message.Contains(TEXT("division by zero")));
		}
	}

	// --- nothing bound: a Warning in the log, so a content bug is never silent ----------
	{
		UStoryletEngine* Engine = UStoryletEngine::Create(Bundle, {});
		if (!TestNotNull(TEXT("engine"), Engine)) return false;
		AddExpectedMessage(TEXT("the condition on card broken in flow 'main' failed, counted as false"),
			ELogVerbosity::Warning, EAutomationExpectedMessageFlags::Contains, 1);
		UStoryletFlow* Flow = Engine->OpenFlow(TEXT("main"));
		if (!TestNotNull(TEXT("flow"), Flow)) return false;
		TestFalse(TEXT("still counted false"), HandHas(Flow->Deal(TEXT("q")), TEXT("broken")));
	}

	// --- a host write that does not fit its declaration is refused --------------------
	{
		UStoryletEngine* Engine = UStoryletEngine::Create(Bundle, {});
		if (!TestNotNull(TEXT("engine"), Engine)) return false;
		UStoryletFlow* Flow = Engine->OpenFlow(TEXT("main"));
		if (!TestNotNull(TEXT("flow"), Flow)) return false;
		AddExpectedError(TEXT("\"story.gold\" takes a number; \"5\" doesn't fit"), EAutomationExpectedErrorFlags::Contains, 2);
		AddExpectedError(TEXT("\"story.mood\" takes one of \"calm\", \"tense\"; \"angry\" doesn't fit"), EAutomationExpectedErrorFlags::Contains, 1);
		// This bundle's `world` block is empty, which declares no @world scope at
		// all (host scopes, corpus 23): the path names nothing, as in JS.
		AddExpectedError(TEXT("bad property path \"world.nope\""), EAutomationExpectedErrorFlags::Contains, 1);
		Flow->SetPropertyString(TEXT("story.gold"), TEXT("5"));
		Engine->SetPropertyString(TEXT("story.gold"), TEXT("5"));
		Flow->SetPropertyString(TEXT("story.mood"), TEXT("angry"));
		Flow->SetPropertyNumber(TEXT("world.nope"), 1);
		TestEqual(TEXT("gold untouched"), Flow->GetPropertyNumber(TEXT("story.gold")), 2.0);
		TestEqual(TEXT("mood untouched"), Flow->GetPropertyString(TEXT("story.mood")), FString(TEXT("calm")));
		Flow->SetPropertyNumber(TEXT("story.gold"), 7);
		Flow->SetPropertyString(TEXT("story.mood"), TEXT("tense"));
		TestEqual(TEXT("a fitting number lands"), Flow->GetPropertyNumber(TEXT("story.gold")), 7.0);
		TestEqual(TEXT("a listed value lands"), Flow->GetPropertyString(TEXT("story.mood")), FString(TEXT("tense")));
	}

	// --- refusals the game can see (a family ruling, 2026-10-28) ------------------------
	// A setter returns its refusal ("" when it lands); a call that returns
	// something else keeps it for GetLastError, cleared by the next good one.
	{
		UStoryletEngine* Engine = UStoryletEngine::Create(Bundle, {});
		if (!TestNotNull(TEXT("engine"), Engine)) return false;
		// The broken card's condition is reported here, not as a Warning.
		UStoryletReplacedFlowListener* Listener = NewObject<UStoryletReplacedFlowListener>();
		Engine->OnError.AddDynamic(Listener, &UStoryletReplacedFlowListener::OnPlayError);
		UStoryletFlow* Flow = Engine->OpenFlow(TEXT("main"));
		if (!TestNotNull(TEXT("flow"), Flow)) return false;
		const FString Fit = TEXT("\"story.gold\" takes a number; \"lots\" doesn't fit");
		AddExpectedError(Fit, EAutomationExpectedErrorFlags::Contains, 2);
		TestTrue(TEXT("a flow's refused setter returns the refusal"),
			Flow->SetPropertyString(TEXT("story.gold"), TEXT("lots")).Contains(Fit));
		TestTrue(TEXT("and keeps it for GetLastError"), Flow->GetLastError().Contains(Fit));
		TestEqual(TEXT("a setter that lands returns empty"), Flow->SetPropertyNumber(TEXT("story.gold"), 4), FString());
		TestEqual(TEXT("and clears it"), Flow->GetLastError(), FString());
		TestTrue(TEXT("the engine's refused setter returns the refusal"),
			Engine->SetPropertyString(TEXT("story.gold"), TEXT("lots")).Contains(Fit));
		TestEqual(TEXT("the engine's setter that lands returns empty"), Engine->SetPropertyNumber(TEXT("story.gold"), 5), FString());

		AddExpectedError(TEXT("Storylet Engine: Deal - "), EAutomationExpectedErrorFlags::Contains, 1);
		TestEqual(TEXT("a refused deal hands back nothing"), Flow->Deal(TEXT("no-such-hand")).Num(), 0);
		const FString DealRefusal = Flow->GetLastError();
		TestTrue(TEXT("a refused deal sets GetLastError, naming the hand"), DealRefusal.Contains(TEXT("no-such-hand")));
		Flow->Deal(TEXT("q"));
		TestEqual(TEXT("the next good deal clears it"), Flow->GetLastError(), FString());

		AddExpectedError(TEXT("Storylet Engine: AdvanceTurns - "), EAutomationExpectedErrorFlags::Contains, 1);
		TestFalse(TEXT("a refused AdvanceTurns returns the refusal"), Flow->AdvanceTurns(TEXT("no-such-box"), 1).IsEmpty());
		TestEqual(TEXT("one that lands returns empty"), Flow->AdvanceTurns(TEXT("box"), 1), FString());

		AddExpectedError(TEXT("Storylet Engine: OpenFlowRestoring - "), EAutomationExpectedErrorFlags::Contains, 1);
		FStoryletLoadReport Report;
		TestNull(TEXT("a refused open hands back null"), Engine->OpenFlowRestoring(TEXT("other"), TEXT("not json"), Report));
		TestFalse(TEXT("and sets the engine's GetLastError"), Engine->GetLastError().IsEmpty());
		TestNotNull(TEXT("a good open"), Engine->OpenFlow(TEXT("other")));
		TestEqual(TEXT("clears it"), Engine->GetLastError(), FString());

		AddExpectedError(TEXT("DeserializeState - not a storylets save"), EAutomationExpectedErrorFlags::Contains, 1);
		TestFalse(TEXT("a refused load"), UStoryletSave::DeserializeState(Engine, TEXT("{}")));
		TestFalse(TEXT("sets the engine's GetLastError"), Engine->GetLastError().IsEmpty());
		TestTrue(TEXT("a good load"), UStoryletSave::DeserializeState(Engine, UStoryletSave::SerializeState(Engine)));
		TestEqual(TEXT("clears it"), Engine->GetLastError(), FString());
	}

	// --- a bundle or a save that is not one, refused by name --------------------------
	{
		UStoryletBundle* Short = UStoryletBundle::LoadFromJsonString(
			TEXT("{ \"schema\": \"storylets/bundle@0\", \"content\": { \"project\": \"p\" }, \"settings\": {}, \"world\": { \"properties\": [] } }"), Error);
		if (!TestNotNull(TEXT("a cut-short bundle still loads as an asset"), Short)) return false;
		AddExpectedError(TEXT("not a complete Storylets bundle: no story properties; no boxes"), EAutomationExpectedErrorFlags::Contains, 1);
		TestNull(TEXT("but no engine is made on it"), UStoryletEngine::Create(Short, {}));

		UStoryletEngine* Engine = UStoryletEngine::Create(Bundle, {});
		if (!TestNotNull(TEXT("engine"), Engine)) return false;
		AddExpectedError(TEXT("not a complete Storylets save: no content"), EAutomationExpectedErrorFlags::Contains, 1);
		TestFalse(TEXT("a save with no content is refused"), UStoryletSave::DeserializeState(Engine,
			TEXT("{ \"schema\": \"storylets/savefile@1\", \"engine\": { \"schema\": \"storylets/save@2\" } }")));
	}
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
