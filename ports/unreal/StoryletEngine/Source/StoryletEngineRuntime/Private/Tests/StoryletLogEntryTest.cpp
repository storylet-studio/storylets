// The Blueprint log entry carries the event (round 2 ruling I, design
// engine-review-2026-10.md 6). Runs via
//   -ExecCmds="Automation RunTests StoryletEngine.LogEntry"
//
// Until then FStoryletLogEntry was Kind / Seq / Turn / Summary alone, so a
// Blueprint host could read that a card was dealt but not which card, to
// which hand, or why. Every other runtime's entry carries the trace event; this
// checks the flattened one does too, on a flow's log and on the run's: a
// deal's hand and per-card verdicts (dealt, capped, condition, with priority
// and specificity where ranking got that far), a peek's box, criteria and
// verdicts, a play's card and outcome, and a write's target, path and values.

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "StoryletBundle.h"
#include "StoryletEngine.h"
#include "StoryletTypes.h"

namespace
{
	// One box, one one-slot hand, three cards: "high" (priority 5) wins the
	// slot, "low" (priority 1) ranks below the cap, and "shut" fails its
	// condition. Playing "high" writes @story.gold = 5.
	const TCHAR* LogEntryBundleJson = TEXT(R"JSON({
  "schema": "storylets/bundle@0",
  "content": { "project": "proj_logentry", "version": "1.0.0", "hash": "logentryhash" },
  "metadata": "full",
  "settings": { "playAdvancesTurns": 1 },
  "world": { "properties": [] },
  "story": { "properties": [
    { "name": "gold", "type": "number", "default": 0 }
  ] },
  "boxes": [
    {
      "id": "b_main", "gameId": "main", "title": "Main",
      "ranking": { "specificity": true },
      "properties": [],
      "tagGroups": [],
      "decks": [
        {
          "id": "k_main", "gameId": "deck", "title": "Deck",
          "cards": [
            {
              "id": "c_high", "gameId": "high", "title": "High", "priority": 5,
              "outcomes": [
                {
                  "id": "o_take", "gameId": "take", "title": "Take",
                  "changes": { "@story.gold": { "src": "5", "ast": ["n", 5] } }
                }
              ]
            },
            { "id": "c_low", "gameId": "low", "title": "Low", "priority": 1, "outcomes": [] },
            {
              "id": "c_shut", "gameId": "shut", "title": "Shut",
              "condition": { "src": "false", "ast": ["b", false] },
              "outcomes": []
            }
          ]
        }
      ],
      "handTemplates": [],
      "hands": [
        {
          "id": "h_board", "gameId": "board", "title": "Board",
          "rule": { "bindings": {}, "slots": 1 }
        }
      ]
    }
  ]
})JSON");

	const FStoryletTraceCard* FindTraceCard(const TArray<FStoryletTraceCard>& Cards, const TCHAR* GameId)
	{
		return Cards.FindByPredicate([GameId](const FStoryletTraceCard& C) { return C.GameId == GameId; });
	}

	const FStoryletLogEntry* FindEntry(const TArray<FStoryletLogEntry>& Entries, EStoryletLogKind Kind)
	{
		return Entries.FindByPredicate([Kind](const FStoryletLogEntry& E) { return E.Kind == Kind; });
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryletLogEntryTest,
	"StoryletEngine.LogEntry",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FStoryletLogEntryTest::RunTest(const FString& Parameters)
{
	FString Error;
	UStoryletBundle* Bundle = UStoryletBundle::LoadFromJsonString(LogEntryBundleJson, Error);
	if (!TestNotNull(TEXT("bundle compiles"), Bundle))
	{
		AddError(Error);
		return false;
	}
	UStoryletEngine* Engine = UStoryletEngine::Create(Bundle, 1, /*bRetainLog=*/true);
	if (!TestNotNull(TEXT("engine creates"), Engine)) return false;
	UStoryletFlow* Flow = Engine->OpenFlow(TEXT("main"));
	if (!TestNotNull(TEXT("flow opens"), Flow)) return false;

	// A peek first, so the deal after it answers as a fresh deal would.
	TMap<FString, FString> NoCriteria;
	Flow->Peek(TEXT("main"), NoCriteria, 3);
	const TArray<FStoryletDealtCard> Hand = Flow->Deal(TEXT("board"));
	if (!TestEqual(TEXT("the one slot is filled"), Hand.Num(), 1)) return false;
	TestEqual(TEXT("the higher priority wins it"), Hand[0].GameId, FString(TEXT("high")));
	FString PlayError;
	if (!TestTrue(TEXT("play succeeds"), Flow->Play(TEXT("high"), TEXT("take"), TEXT("board"), PlayError)))
	{
		AddError(PlayError);
		return false;
	}

	const TArray<FStoryletLogEntry> Entries = Flow->Log();

	// The deal: its hand, and every card it considered with its verdict.
	if (const FStoryletLogEntry* Deal = FindEntry(Entries, EStoryletLogKind::Deal);
		TestNotNull(TEXT("the log holds the deal"), Deal))
	{
		TestEqual(TEXT("deal names its hand by gameId"), Deal->Hand, FString(TEXT("board")));
		TestTrue(TEXT("deal fills no box field"), Deal->Box.IsEmpty());
		TestEqual(TEXT("deal considered all three cards"), Deal->Cards.Num(), 3);
		TestTrue(TEXT("deal summary is unchanged"), Deal->Summary.Contains(TEXT("deal board: high (3 considered)")));

		if (const FStoryletTraceCard* High = FindTraceCard(Deal->Cards, TEXT("high"));
			TestNotNull(TEXT("deal lists high"), High))
		{
			TestEqual(TEXT("high was dealt"), High->Verdict, FString(TEXT("dealt")));
			TestTrue(TEXT("high carries its priority"), High->bHasPriority);
			TestEqual(TEXT("high's priority"), High->Priority, 5.0);
			TestTrue(TEXT("high carries its specificity"), High->bHasSpecificity);
		}
		if (const FStoryletTraceCard* Low = FindTraceCard(Deal->Cards, TEXT("low"));
			TestNotNull(TEXT("deal lists low"), Low))
		{
			TestEqual(TEXT("low ranked below the cap"), Low->Verdict, FString(TEXT("capped")));
			TestTrue(TEXT("low carries its priority"), Low->bHasPriority);
			TestEqual(TEXT("low's priority"), Low->Priority, 1.0);
		}
		if (const FStoryletTraceCard* Shut = FindTraceCard(Deal->Cards, TEXT("shut"));
			TestNotNull(TEXT("deal lists shut"), Shut))
		{
			TestEqual(TEXT("shut failed its condition"), Shut->Verdict, FString(TEXT("condition")));
			TestFalse(TEXT("shut was never ranked, so has no priority"), Shut->bHasPriority);
		}
	}

	// The peek: its box and its verdicts (nothing is capped at a count of 3).
	if (const FStoryletLogEntry* Peek = FindEntry(Entries, EStoryletLogKind::Peek);
		TestNotNull(TEXT("the log holds the peek"), Peek))
	{
		TestEqual(TEXT("peek names its box by gameId"), Peek->Box, FString(TEXT("main")));
		TestTrue(TEXT("peek fills no hand field"), Peek->Hand.IsEmpty());
		TestEqual(TEXT("peek had no criteria"), Peek->Criteria.Num(), 0);
		TestEqual(TEXT("peek considered all three cards"), Peek->Cards.Num(), 3);
		if (const FStoryletTraceCard* Low = FindTraceCard(Peek->Cards, TEXT("low"));
			TestNotNull(TEXT("peek lists low"), Low))
		{
			TestEqual(TEXT("low makes a peek of three"), Low->Verdict, FString(TEXT("dealt")));
		}
	}

	// The play: card and outcome by gameId.
	if (const FStoryletLogEntry* Play = FindEntry(Entries, EStoryletLogKind::Play);
		TestNotNull(TEXT("the log holds the play"), Play))
	{
		TestEqual(TEXT("play names its card"), Play->Card, FString(TEXT("high")));
		TestEqual(TEXT("play names its outcome"), Play->Outcome, FString(TEXT("take")));
		TestTrue(TEXT("play carries the turn"), Play->bHasTurn);
		TestEqual(TEXT("play's turn is the box's new turn"), Play->Turn, 1.0);
	}

	// The write: target, resolved path, and both values as JSON text; the
	// Summary keeps its logger line.
	if (const FStoryletLogEntry* Write = FindEntry(Entries, EStoryletLogKind::Write);
		TestNotNull(TEXT("the log holds the write"), Write))
	{
		TestEqual(TEXT("write names its target"), Write->Target, FString(TEXT("@story.gold")));
		TestEqual(TEXT("write names its resolved path"), Write->Path, FString(TEXT("story.gold")));
		TestEqual(TEXT("write carries the landed value"), Write->ValueJson, FString(TEXT("5")));
		TestEqual(TEXT("write carries the value it replaced"), Write->PrevJson, FString(TEXT("0")));
		TestEqual(TEXT("write summary is unchanged"), Write->Summary, FString(TEXT("[1] write story.gold: 0 -> 5")));
	}

	// The run's log carries the same event, naming the flow.
	{
		const TArray<FStoryletLogEntry> Run = Engine->GetRunLog();
		if (const FStoryletLogEntry* Deal = FindEntry(Run, EStoryletLogKind::Deal);
			TestNotNull(TEXT("the run log holds the deal"), Deal))
		{
			TestEqual(TEXT("run deal names its flow"), Deal->Flow, FString(TEXT("main")));
			TestEqual(TEXT("run deal names its hand"), Deal->Hand, FString(TEXT("board")));
			TestEqual(TEXT("run deal carries its verdicts"), Deal->Cards.Num(), 3);
		}
	}

	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
