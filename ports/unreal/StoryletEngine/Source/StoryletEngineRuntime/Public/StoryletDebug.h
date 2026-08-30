// A tiny registry so the editor's "Storylet Engine Runtime State" panel can
// watch live engines during play. In your game, after creating an engine,
// call FStoryletDebug::Register (or UStoryletEngine::RegisterForDebug) so the
// panel can list it, walk its flows, read their properties and edit them.
// Parity with the Unity / Godot StoryletDebug registries; the Patterplay
// FPatterDebug shape (which registers the engine too).
#pragma once

#include "CoreMinimal.h"
#include "UObject/WeakObjectPtr.h"

class UStoryletEngine;

class STORYLETENGINERUNTIME_API FStoryletDebug
{
public:
	/** A registered live engine plus the label the panel shows for it. */
	struct FEntry
	{
		TWeakObjectPtr<UStoryletEngine> Engine;
		FString Label;
	};

	/** Fired whenever the registry changes so an open panel can refresh. */
	DECLARE_MULTICAST_DELEGATE(FOnRegistryChanged);

	/** The game's Live Link to Storyletter, if it registered one, so the state
	 *  panel can show where the link is. One per process: a game talks to one
	 *  editor. Parity with Unity's StoryletDebug.Link and Godot's
	 *  StoryletDebug.link (2026-08-29 - Unity had this and the other two did
	 *  not, so the same panel answered a different question in each engine). */
	static TSharedPtr<class FStoryletLiveLink> GetLink();
	static void RegisterLink(const TSharedPtr<class FStoryletLiveLink>& Link);
	static void UnregisterLink(const TSharedPtr<class FStoryletLiveLink>& Link);

	static void Register(UStoryletEngine* Engine, const FString& Label);
	static void Unregister(UStoryletEngine* Engine);

	/** Live engines, stale weak pointers pruned. Safe from the editor tick. */
	static TArray<FEntry> List();

	static FOnRegistryChanged& OnChanged();
};
