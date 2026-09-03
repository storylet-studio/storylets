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
#include "Storylets/Engine.h"
#include "Patter/Engine.h"

/** The shared world: one map of plain values behind both engines' resolver
 *  shapes. The GAME's read-only policy lives here: a story that tries to move a
 *  read-only value is refused loudly. */
class HAMLETDEMO_API FHamletWorld
{
public:
	std::map<std::string, storylets::StoryletValue> Values;   // our value type, used as the plain store
	std::vector<std::string> ReadOnly;

	storylets::WorldResolver ForStorylets();
	patter::HostScope ForPatter();
	/** The host's own write, which the read-only policy does not bind. */
	void Host(const std::string& Name, const storylets::StoryletValue& Value) { Values[Name] = Value; }
	FString Line() const;

private:
	patter::PatterValue Slot;   // HostScope::get returns a pointer that must outlive the call
	void Write(const std::string& Name, const storylets::StoryletValue& Value);
};

class HAMLETDEMO_API FHamletGame
{
public:
	static constexpr double Seed = 7;
	static constexpr const char* FlowId = "main";
	static constexpr const char* PerformanceId = "performance";

	struct FShown { FString Kind; FString Character; FString Text; };
	struct FChoice { FString Id; FString Text; };
	struct FPerforming
	{
		storylets::DealtCard Card;
		patter::Flow* Flow = nullptr;   // engine-owned; Patter's openFlow/getFlow hand out raw pointers
		TArray<FShown> Shown;
		TArray<FChoice> Choices;
		std::string Outcome;
	};

	FHamletWorld World;
	std::unique_ptr<storylets::Engine> Storylets;
	storylets::FlowPtr Story;
	std::shared_ptr<patter::Bundle> PatterBundle;   // the engine takes the bundle by reference, so this owns it
	std::unique_ptr<patter::Engine> Patter;
	TArray<TPair<FString, FString>> Places;   // gameId, title
	FString At;
	TUniquePtr<FPerforming> Playing;
	TArray<FString> Log;

	/** Both bundles as JSON text; Patter's is parsed by its own plugin (UPatterBundle) and copied
	 *  into a core bundle so THIS code can build patter::Engine with the shared world, which the
	 *  core accepts only at construction. Ours is parsed by the core's public JsonParser. */
	bool Setup(const FString& StoryletJson, const FString& PatterJson, FString& OutError);

	void Go(const FString& Place);
	std::vector<storylets::DealtCard> Hand();
	void Start(const storylets::DealtCard& Card);
	void Choose(const FString& OptionId);
	void Wait();

	/** One envelope, both engines, the world once: the JS client's shape, key for key. */
	FString Save() const;
	bool Load(const FString& Json, FString& OutError);

private:
	void Run();
	void Finish();
};
