#include "StoryletDebug.h"
#include "StoryletLiveLink.h"
#include "StoryletEngine.h"

// The live-engine registry is a debug-only affordance (it feeds the editor's
// Runtime State examiner, which lives in the editor-only module). Strip its
// work from Shipping builds so nothing holds engine references there; the
// API stays present as no-ops so callers compile unchanged.
#if !UE_BUILD_SHIPPING

namespace
{
	TArray<FStoryletDebug::FEntry>& Registry()
	{
		static TArray<FStoryletDebug::FEntry> Entries;
		return Entries;
	}

	FStoryletDebug::FOnRegistryChanged& ChangedDelegate()
	{
		static FStoryletDebug::FOnRegistryChanged Delegate;
		return Delegate;
	}

	/** Drop entries whose engine has been GC'd. */
	void Prune()
	{
		Registry().RemoveAll([](const FStoryletDebug::FEntry& E) { return !E.Engine.IsValid(); });
	}
}

namespace
{
	/** The one link, held weakly: the registry must not keep a torn-down link
	 *  alive any more than it keeps a dead engine. */
	TWeakPtr<FStoryletLiveLink>& LinkSlot()
	{
		static TWeakPtr<FStoryletLiveLink> Slot;
		return Slot;
	}
}

TSharedPtr<FStoryletLiveLink> FStoryletDebug::GetLink()
{
	return LinkSlot().Pin();
}

void FStoryletDebug::RegisterLink(const TSharedPtr<FStoryletLiveLink>& Link)
{
	if (LinkSlot().Pin() == Link) return;
	LinkSlot() = Link;
	ChangedDelegate().Broadcast();
}

void FStoryletDebug::UnregisterLink(const TSharedPtr<FStoryletLiveLink>& Link)
{
	if (LinkSlot().Pin() != Link) return;
	LinkSlot().Reset();
	ChangedDelegate().Broadcast();
}

void FStoryletDebug::Register(UStoryletEngine* Engine, const FString& Label)
{
	if (!Engine) return;
	Prune();
	for (FEntry& E : Registry())
	{
		if (E.Engine.Get() == Engine)
		{
			E.Label = Label;
			ChangedDelegate().Broadcast();
			return;
		}
	}
	Registry().Add(FEntry{ Engine, Label });
	ChangedDelegate().Broadcast();
}

void FStoryletDebug::Unregister(UStoryletEngine* Engine)
{
	const int32 Removed = Registry().RemoveAll(
		[Engine](const FEntry& E) { return E.Engine.Get() == Engine; });
	if (Removed > 0) ChangedDelegate().Broadcast();
}

TArray<FStoryletDebug::FEntry> FStoryletDebug::List()
{
	Prune();
	return Registry();
}

FStoryletDebug::FOnRegistryChanged& FStoryletDebug::OnChanged()
{
	return ChangedDelegate();
}

#else // UE_BUILD_SHIPPING - no-op registry.

void FStoryletDebug::Register(UStoryletEngine*, const FString&) {}
void FStoryletDebug::Unregister(UStoryletEngine*) {}
TSharedPtr<FStoryletLiveLink> FStoryletDebug::GetLink() { return nullptr; }
void FStoryletDebug::RegisterLink(const TSharedPtr<FStoryletLiveLink>&) {}
void FStoryletDebug::UnregisterLink(const TSharedPtr<FStoryletLiveLink>&) {}
TArray<FStoryletDebug::FEntry> FStoryletDebug::List() { return {}; }

FStoryletDebug::FOnRegistryChanged& FStoryletDebug::OnChanged()
{
	static FOnRegistryChanged Delegate;
	return Delegate;
}

#endif
