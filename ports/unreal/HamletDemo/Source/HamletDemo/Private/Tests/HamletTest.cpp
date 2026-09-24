// Headless: the loop, the survivor rule, a mid-scene save/load, and the
// cross-host envelopes the JS client wrote. Drives FHamletGame directly.
//
//   UnrealEditor-Cmd HamletDemo.uproject -ExecCmds="Automation RunTests StoryletStudio.Hamlet; Quit" -unattended -nullrhi -nosplash
#include "Misc/AutomationTest.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "HamletGame.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FHamletLoopTest, "StoryletStudio.Hamlet.Loop",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

static FString Demo(const TCHAR* Name) { FString T; FFileHelper::LoadFileToString(T, *(FPaths::ProjectDir() / TEXT("Demos") / Name)); return T; }
static FString Join(const TArray<FStoryletDealtCard>& H) { FString S; for (const auto& c : H) { if (!S.IsEmpty()) S += TEXT(","); S += c.GameId; } return S; }

bool FHamletLoopTest::RunTest(const FString& Parameters)
{
	auto Fresh = [&](FHamletGame& G) { FString E; const bool ok = G.Setup(Demo(TEXT("hamlet.storyletsc")), Demo(TEXT("hamlet.patterc")), E); TestTrue(FString::Printf(TEXT("setup: %s"), *E), ok); return ok; };
	FHamletGame g; if (!Fresh(g)) return false;
	g.Go(TEXT("the-inn"));
	// The demo opens with one card: arriving at the gate moves the act and deals the village.
	{ const FStoryletDealtCard* gate = nullptr; auto opening = g.Hand(); for (const auto& c : opening) if (c.GameId == TEXT("arrive-at-the-gate")) gate = &c;
	  if (!TestNotNull(TEXT("the demo opens with the gate"), gate)) return false; g.Start(*gate); }
	// The scene ENDS but its outcome waits: the player reads it, then continues.
	TestTrue(TEXT("the gate's words wait on Continue"), g.Playing && g.Playing->bDone && g.Log.Num() == 0); g.Finish();
	const FStoryletDealtCard* settle = nullptr; auto hand = g.Hand();
	for (const auto& c : hand) if (c.GameId == TEXT("settle-at-the-inn")) settle = &c;
	TestNotNull(TEXT("the inn deals settle-at-the-inn"), settle);
	if (!settle) return false;
	g.Start(*settle);
	TestTrue(TEXT("Patter performs it: two choices on screen"), g.Playing && g.Playing->Choices.Num() == 2);
	const FString mid = g.Save();
	FHamletGame g2; if (!Fresh(g2)) return false; FString e2;
	TestTrue(TEXT("a mid-scene envelope loads and the conversation is back"), g2.Load(mid, e2) && g2.Playing && g2.Playing->Choices.Num() == 2);
	for (const auto& ch : g2.Playing->Choices) if (ch.Text.Contains(TEXT("road north"))) { g2.Choose(ch.Id); break; }
	TestTrue(TEXT("the branch's closing words wait on Continue"), g2.Playing && g2.Playing->bDone); g2.Finish();
	TestTrue(TEXT("Patter wrote @world.knows_road"), g2.World.Store->GetBool(TEXT("knows_road")));
	g2.Go(TEXT("the-mystic-tree"));
	TestEqual(TEXT("tree shows the ambient only (survivor rule)"), Join(g2.Hand()), FString(TEXT("wind-in-the-leaves")));
	g2.Start(g2.Hand()[0]); g2.Finish();   // no choice at all: it ends, and Continue plays it
	TestTrue(TEXT("The Road North lands once the seat frees"), Join(g2.Hand()).Contains(TEXT("the-road-north")));
	// Cross-host: envelopes the JS client wrote. The release zip carries them in Tests/fixtures; in the
	// repo checkout the Godot demo keeps them. Each is an assertion: a missing fixture, a refused load,
	// or the wrong landing fails the test.
	const FString shipped = FPaths::ConvertRelativePathToFull(FPaths::ProjectDir() / TEXT("Tests/fixtures"));
	const FString fixtures = FPaths::DirectoryExists(shipped) ? shipped
		: FPaths::ConvertRelativePathToFull(FPaths::ProjectDir() / TEXT("../../godot/HamletDemo/test/fixtures"));
	FString between, midjs;
	if (!TestTrue(TEXT("the JS client's envelope is at ") + fixtures, FFileHelper::LoadFileToString(between, *(fixtures / TEXT("envelope-from-js.json"))))) return false;
	FHamletGame g3; if (!Fresh(g3)) return false; FString e3; const bool bLoaded3 = g3.Load(between, e3);
	if (!TestTrue(TEXT("the JS client's envelope loads here: ") + e3, bLoaded3)) return false;
	TestEqual(TEXT("the JS client's envelope lands in the same place"), g3.At, FString(TEXT("the-mystic-tree")));
	TestTrue(TEXT("the JS client's envelope brings the same world (knows_road)"), g3.World.Store->GetBool(TEXT("knows_road")));
	if (!TestTrue(TEXT("the JS client's mid-scene envelope is at ") + fixtures, FFileHelper::LoadFileToString(midjs, *(fixtures / TEXT("envelope-from-js-mid.json"))))) return false;
	FHamletGame g4; if (!Fresh(g4)) return false; FString e4; const bool bLoaded4 = g4.Load(midjs, e4);
	if (!TestTrue(TEXT("the JS client's mid-scene envelope loads here: ") + e4, bLoaded4)) return false;
	TestTrue(TEXT("a MID-SCENE envelope from the JS client brings the conversation back, two choices on screen"), g4.Playing && g4.Playing->Choices.Num() == 2);
	return true;
}
#endif
