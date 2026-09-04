// The Hamlet, the game part, with no Unreal UI in it: the same shape as the JS
// client's main.ts + performance.ts + world.ts, the Godot demo's hamlet_game.gd
// and the Unity demo's HamletGame.cs, so all four read side by side.
//
//   the Storylet Engine decides WHICH beat happens, and when
//   Patter performs that beat's dialogue
//   HamletWorld owns @world, and is handed to both
//
// Both engines are driven as their std C++ cores, the way the plugins' own
// TestHosts drive them. Neither is told the other exists: what joins them is a
// naming convention (a card's gameId is its scene id; an outcome's gameId is
// what the scene reports in a gameEvent's gameData.outcome) and the world.
#pragma once

#include "CoreMinimal.h"
#include <map>
#include <memory>
#include <string>
#include <vector>
#include "UObject/StrongObjectPtr.h"
#include "StoryletBundle.h"
#include "StoryletEngine.h"
#include "StoryletTypes.h"
#include "StoryletWorld.h"
#include "Storylets/StoryletValue.h"
#include "PatterBundle.h"
#include "PatterEngine.h"
#include "PatterWorld.h"
#include "HamletWorldSync.h"
#include "Patter/Engine.h"

/** The shared world: ONE set of values behind the two plugins' containers.
 *  UStoryletWorld is bound at UStoryletEngine::Create, UPatterWorld at
 *  UPatterEngine::Create, and UHamletWorldSync keeps them equal. The GAME's
 *  read-only policy is set on both, so either story's attempt to move such a
 *  value is refused by its own container. */
class HAMLETDEMO_API FHamletWorld
{
public:
	TStrongObjectPtr<UStoryletWorld> Store;    // strong: this class is not a UObject, so GC must be told
	TStrongObjectPtr<UPatterWorld> Mirror;
	TStrongObjectPtr<UHamletWorldSync> Sync;
	void Create();
	/** The host's own write, which the read-only policy does not bind; mirrored across. */
	void Host(const std::string& Name, const storylets::StoryletValue& Value) { Store->HostSet(Name, Value); }
	FString Line() const;
};

class HAMLETDEMO_API FHamletGame
{
public:
	static constexpr double Seed = 7;
	static constexpr const char* FlowId = "main";
	/** The box this host performs through Patter, and the name of its ONE Patter flow: opened once,
	 *  found again after a load, entered per card with Goto. Never re-opened, so the flow's visit
	 *  counts, shuffle cursors and PRNG carry on between performances. */
	static constexpr const TCHAR* BoxFlowId = TEXT("village");

	struct FShown { FString Kind; FString Character; FString Text; };
	struct FChoice { FString Id; FString Text; };
	struct FPerforming
	{
		FStoryletDealtCard Card;
		TStrongObjectPtr<UPatterFlow> Flow;   // the wrapper's flow (the engine holds its wrappers weakly)
		TArray<FShown> Shown;
		TArray<FChoice> Choices;
		std::string Outcome;
	};

	FHamletWorld World;
	TStrongObjectPtr<UStoryletBundle> StoryletBundle;
	TStrongObjectPtr<UStoryletEngine> Storylets;   // the plugin's wrapper, bound to World.Store
	TStrongObjectPtr<UStoryletFlow> Story;
	TArray<FString> HandRefs;   // every hand, for DealMany
	TStrongObjectPtr<UPatterBundle> PatterBundle;
	TStrongObjectPtr<UPatterEngine> Patter;   // Patterplay's wrapper, bound to World.Mirror
	TStrongObjectPtr<UPatterFlow> Performance;   // the one flow, see BoxFlowId
	TArray<TPair<FString, FString>> Places;   // gameId, title
	FString At;
	TUniquePtr<FPerforming> Playing;
	TArray<FString> Log;

	/** Both bundles as JSON text, each through its plugin's wrapper: UStoryletBundle then
	 *  UStoryletEngine::Create(Bundle, Seed, false, World.Store); UPatterBundle then
	 *  UPatterEngine::Create(Bundle, World.Mirror). Two Create calls, one world: the whole story. */
	bool Setup(const FString& StoryletJson, const FString& PatterJson, FString& OutError);

	void Go(const FString& Place);
	TArray<FStoryletDealtCard> Hand();
	void Start(const FStoryletDealtCard& Card);
	void Choose(const FString& OptionId);
	void Wait();

	/** One envelope, both engines, the world once: the JS client's shape, key for key. */
	FString Save() const;
	bool Load(const FString& Json, FString& OutError);

private:
	void Run();
	void Finish();
};
