// OnRefit at the UE boundary (the core's own behaviour is held by the clang
// TestHost's port of the JS "onRefit: the registry's refits, this engine's
// share"). A game on its own registry that loads it with refit has a saved value
// that no longer fits its declaration put back to its default; the engine takes
// its own share of those as its bags claim them. One the registry held before
// the engine was made is claimed while CreateWithRegistry builds it, before
// OnRefit can be bound: it is logged as a Warning, as Patterplay's is. One
// claimed later (a load) reaches OnRefit, with what the save held, and nothing
// is logged. Runs via -ExecCmds="Automation RunTests StoryletEngine.Refit".

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "StoryletBundle.h"
#include "StoryletEngine.h"
#include "StoryletSave.h"
#include "StoryletTypes.h"
#include "StoryletReplacedFlowListener.h"

#include "Storylets/Kernel.h"   // the shared kernel (Expr/), its names in `storylets`

namespace
{
	// The JS test's moods bundle: story `mood`, an enum now of "calm" only
	// (the save was taken when it also had "angry"), one card and one hand.
	const TCHAR* MoodsBundleJson = TEXT(R"JSON({"schema":"storylets/bundle@0","content":{"project":"proj_refit","version":"1.0.0","hash":"refithash"},"metadata":"full","settings":{"playAdvancesTurns":1},"world":{"properties":[]},"story":{"properties":[{"name":"mood","type":"enum","values":["calm"],"default":"calm"}]},"boxes":[{"id":"b_x","gameId":"box","ranking":{"specificity":true},"fields":[],"properties":[],"tagGroups":[],"decks":[{"id":"k_main","gameId":"main","properties":[],"cards":[{"id":"c_any","gameId":"any","redraw":"always","outcomes":[{"id":"o_go","gameId":"go"}]}]}],"handTemplates":[],"hands":[{"id":"h_q","gameId":"q","rule":{"bindings":{},"slots":1}}]}]})JSON");

	/** A registry save from when @story.mood could be "angry", and was. */
	storylets::ScopeRegistry::SaveBlob SavedAngry()
	{
		storylets::ScopeRegistry::SaveBlob Blob;
		storylets::OrderedMap<std::string, storylets::StoryletValue> Story;
		Story.set("mood", storylets::StoryletValue::Str("angry"));
		Blob.set("story", Story);
		return Blob;
	}

	FString MoodOf(const storylets::ScopeRegistry& Registry)
	{
		const auto Mood = Registry.get("story", "mood");
		return Mood.has_value() && Mood->isString() ? FString(UTF8_TO_TCHAR(Mood->asString().c_str())) : FString(TEXT("<not a string>"));
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryletRefitTest,
	"StoryletEngine.Refit",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FStoryletRefitTest::RunTest(const FString& Parameters)
{
	// The value the game's registry held before the engine was made: claimed
	// while it is built, so logged (OnRefit can't be bound yet). Only that one:
	// the load below reaches the bound event and logs nothing.
	AddExpectedMessage(TEXT("the save's story.mood was \"angry\", which no longer fits its declaration; it is back at its default"),
		ELogVerbosity::Warning, EAutomationExpectedMessageFlags::Contains, 1);

	FString Error;
	UStoryletBundle* Bundle = UStoryletBundle::LoadFromJsonString(MoodsBundleJson, Error);
	if (!TestNotNull(TEXT("bundle compiles"), Bundle)) return false;

	// The game loads first: the value waits for the engine, which puts it back.
	{
		const auto Registry = std::make_shared<storylets::ScopeRegistry>();
		Registry->load(SavedAngry(), /*keepParked=*/false, /*refit=*/true);
		UStoryletEngine* Engine = UStoryletEngine::CreateWithRegistry(Bundle, Registry);
		if (!TestNotNull(TEXT("engine on the game's registry"), Engine)) return false;
		TestEqual(TEXT("story.mood is back at its default"), MoodOf(*Registry), FString(TEXT("calm")));
		TestEqual(TEXT("the engine took its refit from the registry"), static_cast<int32>(Registry->takeMisfits().size()), 0);
	}

	// The engine first, OnRefit bound, then the game's refitting load and the
	// engine's: heard at the load, with what the save held.
	{
		const auto Registry = std::make_shared<storylets::ScopeRegistry>();
		UStoryletEngine* Engine = UStoryletEngine::CreateWithRegistry(Bundle, Registry);
		if (!TestNotNull(TEXT("engine on the game's registry"), Engine)) return false;
		UStoryletReplacedFlowListener* Listener = NewObject<UStoryletReplacedFlowListener>();
		Engine->OnRefit.AddDynamic(Listener, &UStoryletReplacedFlowListener::OnRefitValue);
		const FString Saved = UStoryletSave::SerializeState(Engine);
		Registry->load(SavedAngry(), /*keepParked=*/false, /*refit=*/true);
		TestTrue(TEXT("the engine's load"), UStoryletSave::DeserializeState(Engine, Saved));
		TestEqual(TEXT("OnRefit heard"), FString::Join(Listener->Refits, TEXT(", ")), FString(TEXT("story.mood=angry")));
		TestEqual(TEXT("story.mood is back at its default"), MoodOf(*Registry), FString(TEXT("calm")));
		TestEqual(TEXT("the registry's misfits after"), static_cast<int32>(Registry->takeMisfits().size()), 0);
	}
	return true;
}

#endif
