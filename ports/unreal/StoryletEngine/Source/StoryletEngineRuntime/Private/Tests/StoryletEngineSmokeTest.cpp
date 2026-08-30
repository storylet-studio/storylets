// A UE-boundary smoke test (the conformance corpus is the real behaviour
// gate, replayed by the clang TestHost over the same headers; this test
// exercises the UObject wrapper seams instead): JSON string -> bundle ->
// engine -> flow -> deal -> outcomes -> play -> typed property access ->
// a second flow -> save/load round trip -> foreign-blob rejection. Runs via
// -ExecCmds="Automation RunTests StoryletEngine".

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "StoryletBundle.h"
#include "StoryletCompiledBundle.h"
#include "StoryletLiveLink.h"
#include "StoryletEngine.h"
#include "StoryletSave.h"
#include "StoryletTypes.h"

#include "Storylets/LiveLink.h"
#include "Storylets/Engine.h"
#include "Storylets/StateLogger.h"

namespace
{
	// A tiny hand-written compiled bundle: one box ("main"), one deck, two
	// cards, one hand of two slots; card "one" has an outcome writing
	// @story.gold = 5. Expressions arrive pre-compiled ({src, ast}).
	const TCHAR* SmokeBundleJson = TEXT(R"JSON({
  "schema": "storylets/bundle@0",
  "content": { "project": "proj_smoke", "version": "1.0.0", "hash": "smokehash" },
  "metadata": "full",
  "settings": { "playAdvancesTurns": 1 },
  "world": { "properties": [] },
  "story": { "properties": [
    { "name": "gold", "type": "number", "default": 0 },
    { "name": "mood", "type": "enum", "values": ["calm", "tense"], "default": "calm" }
  ] },
  "boxes": [
    {
      "id": "b_main", "gameId": "main", "title": "Main",
      "ranking": { "specificity": true },
      "fields": [ { "name": "note", "type": "string", "default": "" } ],
      "properties": [],
      "tagGroups": [],
      "decks": [
        {
          "id": "k_main", "gameId": "deck", "title": "Deck",
          "cards": [
            {
              "id": "c_one", "gameId": "one", "title": "One",
              "fields": { "note": "hello" },
              "outcomes": [
                {
                  "id": "o_go", "gameId": "go", "title": "Go",
                  "changes": { "@story.gold": { "src": "5", "ast": ["n", 5] } }
                }
              ]
            },
            { "id": "c_two", "gameId": "two", "title": "Two", "outcomes": [] }
          ]
        }
      ],
      "handTemplates": [],
      "hands": [
        {
          "id": "h_board", "gameId": "board", "title": "Board",
          "rule": { "bindings": {}, "slots": 2 }
        }
      ]
    }
  ]
})JSON");
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryletEngineSmokeTest,
	"StoryletEngine.Smoke",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FStoryletEngineSmokeTest::RunTest(const FString& Parameters)
{
	// The negative path below logs one Error by design (LoadFromJsonString is
	// loud about a refused blob); declare it so the framework doesn't count
	// the intended refusal as a test failure.
	AddExpectedError(TEXT("failed to compile bundle"), EAutomationExpectedErrorFlags::Contains, 1);
	// Likewise ApplyLiveBundle refusing a bundle from another project, below.
	AddExpectedError(TEXT("ApplyLiveBundle - save is for project"), EAutomationExpectedErrorFlags::Contains, 1);
	// And UStoryletSave refusing a save with somebody else's schema tag.
	AddExpectedError(TEXT("LoadStateFromJson - not a storylets save"), EAutomationExpectedErrorFlags::Contains, 1);

	// A non-bundle blob refuses to compile, with the error readable.
	{
		FString Error;
		UStoryletBundle* Broken = UStoryletBundle::LoadFromJsonString(TEXT("{ \"schema\": \"other/thing@1\" }"), Error);
		TestNull(TEXT("foreign blob returns null"), Broken);
		TestFalse(TEXT("foreign blob carries an error"), Error.IsEmpty());
	}

	FString Error;
	UStoryletBundle* Bundle = UStoryletBundle::LoadFromJsonString(SmokeBundleJson, Error);
	if (!TestNotNull(TEXT("bundle compiles"), Bundle)) return false;
	TestTrue(TEXT("bundle reports compiled"), Bundle->IsCompiled());
	TestEqual(TEXT("bundle project"), Bundle->GetProject(), FString(TEXT("proj_smoke")));

	// The bundle inspector (design 2, piece 6): the callable surface read from
	// the asset alone, with nothing in play yet.
	{
		const FStoryletBundleDescription D = Bundle->DescribeBundle();
		TestEqual(TEXT("describe schema"), D.Identity.Schema, FString(TEXT("storylets/bundle@0")));
		TestEqual(TEXT("describe project"), D.Identity.Project, FString(TEXT("proj_smoke")));
		TestEqual(TEXT("describe version"), D.Identity.Version, FString(TEXT("1.0.0")));
		TestEqual(TEXT("describe hash"), D.Identity.Hash, FString(TEXT("smokehash")));
		TestEqual(TEXT("describe metadata"), D.Identity.Metadata, FString(TEXT("full")));

		TestEqual(TEXT("describe totals boxes"), D.Totals.Boxes, 1);
		TestEqual(TEXT("describe totals decks"), D.Totals.Decks, 1);
		TestEqual(TEXT("describe totals cards"), D.Totals.Cards, 2);
		TestEqual(TEXT("describe totals hands"), D.Totals.Hands, 1);
		TestEqual(TEXT("describe totals templates"), D.Totals.Templates, 0);

		// The deal() surface: the name game code calls, its box and slot cap.
		if (TestEqual(TEXT("describe lists the hand"), D.Hands.Num(), 1))
		{
			TestEqual(TEXT("hand gameId"), D.Hands[0].GameId, FString(TEXT("board")));
			TestEqual(TEXT("hand box"), D.Hands[0].Box, FString(TEXT("main")));
			TestEqual(TEXT("hand slots"), D.Hands[0].Slots, 2.0);
			TestEqual(TEXT("hand slots label"), D.Hands[0].SlotsLabel, FString(TEXT("2")));
			TestTrue(TEXT("standalone hand has no template"), D.Hands[0].Template.IsEmpty());
		}

		if (TestEqual(TEXT("describe lists the box"), D.Boxes.Num(), 1))
		{
			TestEqual(TEXT("box gameId"), D.Boxes[0].GameId, FString(TEXT("main")));
			TestTrue(TEXT("box ranking"), D.Boxes[0].bRankingSpecificity);
			TestEqual(TEXT("box declares no tag groups"), D.Boxes[0].TagGroups.Num(), 0);
			TestEqual(TEXT("box card count"), D.Boxes[0].Counts.Cards, 2);
		}

		// world and story always show; nothing else declares here.
		if (TestEqual(TEXT("describe property scopes"), D.Properties.Num(), 2))
		{
			TestTrue(TEXT("world scope first"), D.Properties[0].Scope == EStoryletScopeKind::World);
			TestEqual(TEXT("world declares nothing"), D.Properties[0].Properties.Num(), 0);
			TestTrue(TEXT("story scope second"), D.Properties[1].Scope == EStoryletScopeKind::Story);
			if (TestEqual(TEXT("story declares two"), D.Properties[1].Properties.Num(), 2))
			{
				TestEqual(TEXT("story row label"), D.Properties[1].Properties[0].Label,
					FString(TEXT("gold: number = 0")));
				TestEqual(TEXT("story enum row label"), D.Properties[1].Properties[1].Label,
					FString(TEXT("mood: enum = \"calm\" [calm, tense]")));
			}
		}
	}

	UStoryletEngine* Engine = UStoryletEngine::Create(Bundle, 1, /*bRetainLog=*/true);
	if (!TestNotNull(TEXT("engine creates"), Engine)) return false;
	// All play happens on a flow (design/flows.md); there is no default one.
	UStoryletFlow* MainFlow = Engine->OpenFlow(TEXT("main"));
	if (!TestNotNull(TEXT("flow opens"), MainFlow)) return false;
	TestFalse(TEXT("a fresh flow is open"), MainFlow->IsClosed());
	TestEqual(TEXT("the flow knows its name"), MainFlow->GetFlowId(), FString(TEXT("main")));
	TestEqual(TEXT("the flow points back at its engine"), MainFlow->GetEngine(), Engine);

	// Boxes: one, addressed by gameId, clock at 0.
	TArray<FStoryletBoxView> Boxes = MainFlow->ListBoxes();
	if (!TestEqual(TEXT("one box"), Boxes.Num(), 1)) return false;
	TestEqual(TEXT("box gameId"), Boxes[0].GameId, FString(TEXT("main")));
	TestEqual(TEXT("box turn starts at 0"), Boxes[0].Turn, 0.0);

	// Deal fills the two-slot hand with both cards.
	TArray<FStoryletDealtCard> Hand = MainFlow->Deal(TEXT("board"));
	if (!TestEqual(TEXT("deal fills both slots"), Hand.Num(), 2)) return false;

	// Card fields cross the boundary as stringified pairs.
	for (const FStoryletDealtCard& Card : Hand)
	{
		if (Card.GameId == TEXT("one"))
		{
			if (TestEqual(TEXT("card one carries its field"), Card.Fields.Num(), 1))
			{
				TestEqual(TEXT("field name"), Card.Fields[0].Name, FString(TEXT("note")));
				TestEqual(TEXT("field display"), Card.Fields[0].Value.Display, FString(TEXT("hello")));
				TestTrue(TEXT("field kind"), Card.Fields[0].Value.Kind == EStoryletValueKind::String);
			}
		}
	}

	// Outcomes evaluate against current state.
	TArray<FStoryletOutcomeView> Views = MainFlow->Outcomes(TEXT("one"), TEXT("board"));
	if (!TestEqual(TEXT("one outcome"), Views.Num(), 1)) return false;
	TestTrue(TEXT("outcome available"), Views[0].bAvailable);

	// Typed property access; play lands the write and advances the box clock.
	TestEqual(TEXT("gold starts at 0"), MainFlow->GetPropertyNumber(TEXT("story.gold")), 0.0);
	FString PlayError;
	if (!TestTrue(TEXT("play succeeds"), MainFlow->Play(TEXT("one"), TEXT("go"), TEXT("board"), PlayError)))
	{
		AddError(FString::Printf(TEXT("play error: %s"), *PlayError));
		return false;
	}
	TestEqual(TEXT("gold after play"), MainFlow->GetPropertyNumber(TEXT("story.gold")), 5.0);
	TestEqual(TEXT("turn after play"), MainFlow->GetTurn(TEXT("main")), 1.0);

	// A played unknown outcome errors instead of throwing across the boundary.
	{
		FString BadError;
		TestFalse(TEXT("bad play fails"), MainFlow->Play(TEXT("two"), TEXT("nope"), TEXT("board"), BadError));
		TestFalse(TEXT("bad play carries an error"), BadError.IsEmpty());
	}

	// The retained log (Create's bRetainLog; the BP Log/ClearLog surface):
	// the deal and the play's write arrive flattened, with the one-line
	// summaries the examiner's log panel shows.
	{
		TArray<FStoryletLogEntry> Entries = MainFlow->Log();
		TestTrue(TEXT("log retained entries"), Entries.Num() > 0);
		bool bSawDeal = false, bSawWrite = false, bSawPlay = false;
		for (const FStoryletLogEntry& E : Entries)
		{
			if (E.Kind == EStoryletLogKind::Deal) { bSawDeal = true; }
			if (E.Kind == EStoryletLogKind::Play) { bSawPlay = true; }
			if (E.Kind == EStoryletLogKind::Write)
			{
				bSawWrite = true;
				TestTrue(TEXT("write entry carries the turn"), E.bHasTurn);
				TestEqual(TEXT("write summary shares the logger line shape"),
					E.Summary, FString(TEXT("[1] write story.gold: 0 -> 5")));
			}
		}
		TestTrue(TEXT("log saw the deal"), bSawDeal);
		TestTrue(TEXT("log saw the write"), bSawWrite);
		TestTrue(TEXT("log saw the play"), bSawPlay);
		MainFlow->ClearLog();
		TestEqual(TEXT("ClearLog empties the log"), MainFlow->Log().Num(), 0);
	}

	// The kernel-shaped state logger over the std core (design 3.4):
	// push-based on the PropertyBag audit hook, so a host write logs the
	// moment it lands; capture reports it once and re-baselines.
	{
		storylets::Engine CoreEngine(Bundle->GetCompiled()->Bundle);
		storylets::Flow& Core = *CoreEngine.openFlow("main");
		TArray<FString> Lines;
		storylets::StateLoggerOptions Opts;
		Opts.sink = [&Lines](const std::string& Line) { Lines.Add(FString(UTF8_TO_TCHAR(Line.c_str()))); };
		std::unique_ptr<storylets::StateLogger> Logger = storylets::createStateLogger(CoreEngine, Core, std::move(Opts));

		Core.setProperty("story.gold", storylets::StoryletValue::Num(9));
		TestTrue(TEXT("state logger pushes the write as it lands"),
			Lines.Contains(FString(TEXT("story.gold: 0 -> 9"))));

		std::vector<storylets::StateChange> Changes = Logger->capture();
		int32 GoldChanges = 0;
		for (const storylets::StateChange& C : Changes)
		{
			if (C.path == "story.gold") { ++GoldChanges; }
		}
		TestEqual(TEXT("capture reports the pushed write once"), GoldChanges, 1);
		TestEqual(TEXT("capture re-baselines"), static_cast<int32>(Logger->capture().size()), 0);
		Logger->dispose();
	}

	// Property examiner rows: path-addressed, defaults marked.
	{
		TArray<FStoryletPropertyView> Rows = MainFlow->ListProperties();
		bool bFoundGold = false;
		for (const FStoryletPropertyView& Row : Rows)
		{
			if (Row.Path == TEXT("story.gold"))
			{
				bFoundGold = true;
				TestTrue(TEXT("gold row is number"), Row.Type == EStoryletPropertyType::Number);
				TestEqual(TEXT("gold row value"), Row.Value, FString(TEXT("5")));
				TestEqual(TEXT("gold row default"), Row.Default, FString(TEXT("0")));
				TestFalse(TEXT("gold row not at default"), Row.bIsDefault);
			}
			if (Row.Path == TEXT("story.mood"))
			{
				TestTrue(TEXT("mood row is enum"), Row.Type == EStoryletPropertyType::Enum);
				TestEqual(TEXT("mood row options"), Row.Values.Num(), 2);
				TestTrue(TEXT("mood row at default"), Row.bIsDefault);
			}
		}
		TestTrue(TEXT("gold row listed"), bFoundGold);
	}

	// The flow surface at the UObject boundary (design/flows.md): a second
	// parallel play over the same engine, sharing what is declared shared and
	// nothing else. The behaviour itself is pinned by the corpus; this is the
	// Blueprint-visible shape of it.
	{
		UStoryletFlow* Other = Engine->OpenFlow(TEXT("other"));
		if (TestNotNull(TEXT("a second flow opens"), Other))
		{
			TestEqual(TEXT("GetFlow hands back the same wrapper"), Engine->GetFlow(TEXT("other")), Other);
			const TArray<UStoryletFlow*> Live = Engine->Flows();
			if (TestEqual(TEXT("both flows are live"), Live.Num(), 2))
			{
				TestEqual(TEXT("flows come back in open order"), Live[0], MainFlow);
				TestEqual(TEXT("the second flow is second"), Live[1], Other);
			}

			// @story is shared by declaration: one value for both flows, and
			// the engine reads it too.
			TestEqual(TEXT("the second flow sees the shared story property"),
				Other->GetPropertyNumber(TEXT("story.gold")), 5.0);
			TestEqual(TEXT("and so does the engine"),
				Engine->GetPropertyNumber(TEXT("story.gold")), 5.0);
			Other->SetPropertyNumber(TEXT("story.gold"), 9.0);
			TestEqual(TEXT("a shared write lands for every flow"),
				MainFlow->GetPropertyNumber(TEXT("story.gold")), 9.0);
			MainFlow->SetPropertyNumber(TEXT("story.gold"), 5.0);

			// Clocks and boards are per flow, so the second one starts fresh.
			TestEqual(TEXT("the second flow's clock is its own"), Other->GetTurn(TEXT("main")), 0.0);
			TestEqual(TEXT("the first flow's clock is untouched"), MainFlow->GetTurn(TEXT("main")), 1.0);
			// Every hand is on the board from the start; the second flow's is
			// still empty while the first one's holds what survived the play.
			const TArray<FStoryletHandContents> OtherBoard = Other->Board();
			if (TestEqual(TEXT("the second flow has the same hand"), OtherBoard.Num(), 1))
			{
				TestEqual(TEXT("but nothing dealt into it"), OtherBoard[0].Cards.Num(), 0);
			}

			// Closing leaves the wrapper inert and the engine without it, so
			// the save below carries one flow.
			Engine->CloseFlow(TEXT("other"));
			TestTrue(TEXT("a closed flow reads as closed"), Other->IsClosed());
			TestNull(TEXT("the engine no longer hands it out"), Engine->GetFlow(TEXT("other")));
			TestEqual(TEXT("one flow left"), Engine->Flows().Num(), 1);
		}
	}

	// Save / load round trip through the .storyletsave string boundary.
	const FString SaveJson = UStoryletSave::SaveStateToJson(Engine);
	if (!TestFalse(TEXT("save produced text"), SaveJson.IsEmpty())) return false;
	TestTrue(TEXT("save is the host's file"), SaveJson.Contains(TEXT("storylets/savefile@1")));
	TestTrue(TEXT("with the engine envelope inside"), SaveJson.Contains(TEXT("storylets/save@1")));

	UStoryletEngine* RestoredEngine = UStoryletEngine::Create(Bundle, 0);
	if (!TestNotNull(TEXT("second engine creates"), RestoredEngine)) return false;
	// A wrapper taken BEFORE the load must survive it, re-bound by name - the
	// contract a Blueprint variable holding a flow depends on.
	UStoryletFlow* Restored = RestoredEngine->OpenFlow(TEXT("main"));
	if (!TestTrue(TEXT("load succeeds"), UStoryletSave::LoadStateFromJson(RestoredEngine, SaveJson)))
	{
		return false;
	}
	TestFalse(TEXT("the pre-load wrapper is still live"), Restored->IsClosed());
	TestEqual(TEXT("restored gold"), Restored->GetPropertyNumber(TEXT("story.gold")), 5.0);
	TestEqual(TEXT("restored turn"), Restored->GetTurn(TEXT("main")), 1.0);
	TArray<FStoryletHandContents> Board = Restored->Board();
	if (TestEqual(TEXT("restored board has one hand"), Board.Num(), 1))
	{
		TestEqual(TEXT("restored board keyed by hand gameId"), Board[0].Hand, FString(TEXT("board")));
		if (TestEqual(TEXT("played card left the hand"), Board[0].Cards.Num(), 1))
		{
			TestEqual(TEXT("surviving card"), Board[0].Cards[0].GameId, FString(TEXT("two")));
		}
	}

	// A foreign blob is refused, the engine untouched.
	{
		TestFalse(TEXT("foreign save refused"),
			UStoryletSave::LoadStateFromJson(RestoredEngine, TEXT("{ \"schema\": \"patter/save@0\" }")));
		TestEqual(TEXT("engine untouched after refusal"),
			Restored->GetPropertyNumber(TEXT("story.gold")), 5.0);
	}

	// The Live Link seams (design/live-link.md): the wrapper-level trace
	// subscription, the std client's frame order over a recording sink, and
	// ApplyLiveBundle swapping in place with the subscription surviving. The
	// frames themselves are held to the shared fixture by the clang TestHost;
	// this is the UObject boundary only.
	{
		TArray<FString> Sent;
		storylets::LiveLinkClient Client("smokehash", std::optional<std::string>("Smoke"),
			[&Sent](const std::string& Frame) { Sent.Add(FString(UTF8_TO_TCHAR(Frame.c_str()))); });

		TArray<FString> Seen;
		// The ENGINE's tap: one stream over every flow, each event tagged, which
		// is what Live Link forwards so the editor can follow a participant.
		const int32 Handle = Engine->SubscribeTrace(
			[&Seen, &Client](const FString& FlowId, const storylets::TraceEvent& E)
			{
				Seen.Add(FString(storylets::TraceKindWire(E.kind)));
				Client.onTrace(TCHAR_TO_UTF8(*FlowId), E);
			});
		TestTrue(TEXT("SubscribeTrace hands back a handle"), Handle != 0);

		Client.attach([Engine]() { return Engine->GetCoreEngine(); });
		TestEqual(TEXT("nothing is sent before the socket opens"), Sent.Num(), 0);
		Client.onOpen();
		if (TestEqual(TEXT("hello then the queued board on open"), Sent.Num(), 2))
		{
			TestTrue(TEXT("hello first, with the flow list and boxes"), Sent[0].StartsWith(TEXT("{\"t\":\"hello\",\"v\":2,\"build\":\"smokehash\",\"flows\":[\"main\"],\"project\":\"Smoke\",\"boxes\":[\"main\"]}")));
			TestTrue(TEXT("board second, naming its flow"), Sent[1].StartsWith(TEXT("{\"t\":\"board\",\"flow\":\"main\",\"hands\":{\"board\":[\"two\"]},\"turns\":{\"main\":1}}")));
		}

		// A live refresh: the same content under a new build hash, swapped in
		// place. The handle, the subscription and the run all survive.
		FString NewJson = FString(SmokeBundleJson).Replace(TEXT("smokehash"), TEXT("smokehash2"));
		FString ApplyError;
		TestTrue(TEXT("ApplyLiveBundle applies a pushed bundle"),
			FStoryletLiveLink::ApplyLiveBundle(Engine, NewJson, ApplyError));
		TestTrue(TEXT("apply error empty"), ApplyError.IsEmpty());
		TestEqual(TEXT("the engine now plays the new bundle"),
			Engine->GetBundle() ? Engine->GetBundle()->GetBuildId() : FString(), FString(TEXT("smokehash2")));
		TestFalse(TEXT("the flow wrapper survived the swap, re-bound by name"), MainFlow->IsClosed());
		TestEqual(TEXT("gold carried across the swap"), MainFlow->GetPropertyNumber(TEXT("story.gold")), 5.0);
		TestEqual(TEXT("turn carried across the swap"), MainFlow->GetTurn(TEXT("main")), 1.0);

		Seen.Reset();
		MainFlow->AdvanceTurns(TEXT("main"), 1);
		TestTrue(TEXT("the subscription survived the swap"), Seen.Contains(TEXT("turns")));
		TestEqual(TEXT("the client saw the new core's turn"), Sent.Last(),
			FString(TEXT("{\"t\":\"board\",\"flow\":\"main\",\"hands\":{\"board\":[\"two\"]},\"turns\":{\"main\":2}}")));

		// A bundle from another project is refused, the run untouched.
		FString ForeignJson = FString(SmokeBundleJson).Replace(TEXT("proj_smoke"), TEXT("proj_other"));
		FString ForeignError;
		TestFalse(TEXT("ApplyLiveBundle refuses another project"),
			FStoryletLiveLink::ApplyLiveBundle(Engine, ForeignJson, ForeignError));
		TestFalse(TEXT("refusal carries an error"), ForeignError.IsEmpty());
		TestEqual(TEXT("run untouched after the refusal"), MainFlow->GetTurn(TEXT("main")), 2.0);

		Engine->UnsubscribeTrace(Handle);
		Seen.Reset();
		MainFlow->AdvanceTurns(TEXT("main"), 1);
		TestEqual(TEXT("unsubscribed handlers stay quiet"), Seen.Num(), 0);
		Client.close();
	}

	if (!HasAnyErrors())
	{
		UE_LOG(LogTemp, Display, TEXT("STORYLETSMOKE: PASS"));
	}
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
