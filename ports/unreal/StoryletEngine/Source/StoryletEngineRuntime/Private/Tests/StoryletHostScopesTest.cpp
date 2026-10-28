// Host scopes like Patterplay's at the UE boundary (the core's own behaviour is
// held by the conformance corpus, version 23): a bundle @2 declares @player
// beside @world in its scopeRegistry; Create binds the game's container by
// token; an unbound declared scope is self-backed; a token the bundle doesn't
// declare is reported (Setup), logged at once and delivered to OnError on the
// first OpenFlow, since OnError can only be bound once Create has returned.
// Runs via -ExecCmds="Automation RunTests StoryletEngine.HostScopes".

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "StoryletBundle.h"
#include "StoryletEngine.h"
#include "StoryletTypes.h"
#include "StoryletWorld.h"
#include "StoryletReplacedFlowListener.h"

namespace
{
	// @world.alarm (self-backed here) and @player.hp, @player.rank. Card
	// "strong" is gated on @player.hp > 5 and its outcome takes 6 off; card
	// "weak" is gated on @player.hp <= 5.
	const TCHAR* HostScopesBundleJson = TEXT(R"JSON({
  "schema": "storylets/bundle@2",
  "content": { "project": "proj_hosts", "version": "1.0.0", "hash": "hostshash" },
  "metadata": "full",
  "settings": { "playAdvancesTurns": 1 },
  "scopeRegistry": { "version": 1, "scopes": [
    { "token": "world", "declarations": [ { "name": "alarm", "type": "number", "default": 0 } ] },
    { "token": "player", "declarations": [
      { "name": "hp", "type": "number", "default": 10 },
      { "name": "rank", "type": "quality", "stages": ["novice", "adept"], "default": "novice" }
    ] }
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
              "id": "c_strong", "gameId": "strong", "title": "Strong",
              "condition": { "src": "@player.hp > 5", "ast": ["bin", ">", ["sv", "player", "hp"], ["n", 5]] },
              "outcomes": [
                { "id": "o_hurt", "gameId": "hurt", "title": "Hurt",
                  "changes": { "@player.hp": { "src": "@player.hp - 6", "ast": ["bin", "-", ["sv", "player", "hp"], ["n", 6]] } } }
              ]
            },
            {
              "id": "c_weak", "gameId": "weak", "title": "Weak",
              "condition": { "src": "@player.hp <= 5", "ast": ["bin", "<=", ["sv", "player", "hp"], ["n", 5]] },
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

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryletHostScopesTest,
	"StoryletEngine.HostScopes",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FStoryletHostScopesTest::RunTest(const FString& Parameters)
{
	FString Error;
	UStoryletBundle* Bundle = UStoryletBundle::LoadFromJsonString(HostScopesBundleJson, Error);
	if (!TestNotNull(TEXT("a bundle @2 compiles"), Bundle)) return false;

	// --- the bundle describes each host scope ------------------------------------
	{
		const FStoryletBundleDescription D = Bundle->DescribeBundle();
		bool bSawPlayer = false;
		for (const FStoryletPropertyScope& Scope : D.Properties)
		{
			if (Scope.Scope != EStoryletScopeKind::Host) continue;
			bSawPlayer = true;
			TestEqual(TEXT("the host scope's owner is its token"), Scope.Owner, FString(TEXT("player")));
			TestEqual(TEXT("its properties"), Scope.Properties.Num(), 2);
		}
		TestTrue(TEXT("describeBundle lists @player"), bSawPlayer);
	}

	// --- @player bound to the game's container; @world self-backed ---------------
	{
		UStoryletWorld* Player = NewObject<UStoryletWorld>(GetTransientPackage());
		Player->SetNumber(TEXT("hp"), 3);
		UStoryletEngine* Engine = UStoryletEngine::Create(Bundle, { { TEXT("player"), Player } });
		if (!TestNotNull(TEXT("engine"), Engine)) return false;
		TestEqual(TEXT("GetHostScope(\"player\")"), Engine->GetHostScope(TEXT("player")), Player);
		TestNull(TEXT("@world is self-backed, so nothing is bound under it"), Engine->GetHostScope(TEXT("world")));
		UStoryletReplacedFlowListener* Listener = NewObject<UStoryletReplacedFlowListener>();
		Engine->OnError.AddDynamic(Listener, &UStoryletReplacedFlowListener::OnPlayError);
		UStoryletFlow* Flow = Engine->OpenFlow(TEXT("main"));
		if (!TestNotNull(TEXT("flow"), Flow)) return false;
		TestEqual(TEXT("a declared token binds with nothing to report"), Listener->Errors.Num(), 0);

		TestEqual(TEXT("the store's 3, not the default 10"), Engine->GetPropertyNumber(TEXT("player.hp")), 3.0);
		TestEqual(TEXT("@world reads its declared default"), Engine->GetPropertyNumber(TEXT("world.alarm")), 0.0);
		TArray<FStoryletDealtCard> Hand = Flow->Deal(TEXT("board"));
		TestTrue(TEXT("weak dealt"), HandHas(Hand, TEXT("weak")));
		TestFalse(TEXT("strong gated"), HandHas(Hand, TEXT("strong")));

		// The game's own write, then an outcome through the container.
		TestEqual(TEXT("the host writes @player"), Flow->SetPropertyNumber(TEXT("player.hp"), 8), FString());
		TestEqual(TEXT("it landed in the container"), Player->GetNumber(TEXT("hp")), 8.0);
		Hand = Flow->Deal(TEXT("board"));
		TestTrue(TEXT("strong dealt"), HandHas(Hand, TEXT("strong")));
		TestTrue(TEXT("play hurt"), Flow->Play(TEXT("strong"), TEXT("hurt"), TEXT("board"), Error));
		TestEqual(TEXT("the outcome wrote the container"), Player->GetNumber(TEXT("hp")), 2.0);

		// A host write is checked against the declarations, as @world's is.
		AddExpectedError(TEXT("doesn't fit"), EAutomationExpectedErrorFlags::Contains, 1);
		TestFalse(TEXT("a string for a number is refused"), Flow->SetPropertyString(TEXT("player.hp"), TEXT("lots")).IsEmpty());
		AddExpectedError(TEXT("declares no @player.mana"), EAutomationExpectedErrorFlags::Contains, 1);
		TestFalse(TEXT("an undeclared name is refused"), Flow->SetPropertyNumber(TEXT("player.mana"), 1).IsEmpty());

		// The binding survives a live refresh.
		TestTrue(TEXT("live refresh"), Engine->ApplyLiveBundle(Bundle, Error));
		TestEqual(TEXT("still bound"), Engine->GetHostScope(TEXT("player")), Player);
		TestEqual(TEXT("still read through it"), Engine->GetPropertyNumber(TEXT("player.hp")), 2.0);
	}

	// --- a token the bundle doesn't declare: Setup, logged at once, OnError on the first OpenFlow
	{
		UStoryletWorld* Wrong = NewObject<UStoryletWorld>(GetTransientPackage());
		UStoryletWorld* Weather = NewObject<UStoryletWorld>(GetTransientPackage());
		AddExpectedMessage(TEXT("hostScopes binds \"Player\", which this bundle doesn't declare: it declares \"player\""),
			ELogVerbosity::Warning, EAutomationExpectedMessageFlags::Contains, 1);
		AddExpectedMessage(TEXT("hostScopes binds \"weather\", which this bundle doesn't declare"),
			ELogVerbosity::Warning, EAutomationExpectedMessageFlags::Contains, 1);
		UStoryletEngine* Engine = UStoryletEngine::Create(Bundle, { { TEXT("Player"), Wrong }, { TEXT("weather"), Weather } });
		if (!TestNotNull(TEXT("a set-up report doesn't stop the engine"), Engine)) return false;
		UStoryletReplacedFlowListener* Listener = NewObject<UStoryletReplacedFlowListener>();
		Engine->OnError.AddDynamic(Listener, &UStoryletReplacedFlowListener::OnPlayError);
		TestEqual(TEXT("held until a flow opens"), Listener->Errors.Num(), 0);
		UStoryletFlow* Flow = Engine->OpenFlow(TEXT("main"));
		if (!TestNotNull(TEXT("flow"), Flow)) return false;
		if (TestEqual(TEXT("both delivered on the first OpenFlow"), Listener->Errors.Num(), 2))
		{
			TArray<FString> Nodes;
			for (const FStoryletPlayError& Err : Listener->Errors)
			{
				TestEqual(TEXT("kind"), Err.Kind, FString(TEXT("setup")));
				TestEqual(TEXT("no flow"), Err.Flow, FString());
				Nodes.Add(Err.Node);
			}
			Nodes.Sort();
			TestEqual(TEXT("the nodes are the tokens"), FString::Join(Nodes, TEXT(",")), FString(TEXT("Player,weather")));
		}
		Engine->OpenFlow(TEXT("other"));
		TestEqual(TEXT("delivered once"), Listener->Errors.Num(), 2);
		// "Player" is not "player", which nothing bound, so it is self-backed.
		TestEqual(TEXT("@player self-backed from its default"), Engine->GetPropertyNumber(TEXT("player.hp")), 10.0);
	}
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
