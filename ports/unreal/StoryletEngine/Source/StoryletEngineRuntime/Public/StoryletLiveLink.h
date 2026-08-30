// FStoryletLiveLink - the game-side client for Storyletter's Live Link
// (design/live-link.md). Joins a running game to the editor over a loopback
// WebSocket: the attached session's trace stream and board snapshots go UP,
// so the editor's Board shows the game's run instead of its own (OBSERVE-ONLY:
// the game stays in control, the editor is a passive mirror); freshly compiled
// bundles come DOWN after a save, so the run picks up the edit without
// restarting. The Unreal parity of play-helpers' createLiveLink, same
// `storyletengine/debug@1` wire protocol, the frames built by the std-only
// storylets::LiveLinkClient (Storylets/LiveLink.h) this class owns a socket
// for; the Patterplay FPatterDebugLink shape.
//
// It is a debug tool: in a Shipping build every method is a no-op and the
// WebSockets dependency is compiled out entirely (see
// StoryletEngineRuntime.Build.cs), so it is safe to leave wired in. A missing
// editor is a silent no-op, and nothing here ever throws into the game. Hold
// the returned shared pointer for as long as you want the link open:
//
//   Link = FStoryletLiveLink::Create(Bundle->GetBuildId(), TEXT("My Game"));
//   Link->Attach(Engine);               // forward every flow's trace; a board each goes first
//   // ...play as normal; every deal, play and turn reaches the editor as it happens.
//
//   // Live refresh: the editor saved and pushed a new bundle.
//   Link->OnBundle = [Link, Flow](const FString& Build, const FString& Data)
//   {
//       FString Error;
//       if (!FStoryletLiveLink::ApplyLiveBundle(Flow, Data, Error)) { UE_LOG(...); return; }
//       Link->SetBuild(Build);             // the editor's icon goes back to in sync
//   };
#pragma once

#include "CoreMinimal.h"
#include "Templates/PimplPtr.h"
#include "Templates/SharedPointer.h"
#include "UObject/WeakObjectPtr.h"

class IWebSocket;
class UStoryletEngine;
class UStoryletEngine;
namespace storylets { class LiveLinkClient; }

class STORYLETENGINERUNTIME_API FStoryletLiveLink : public TSharedFromThis<FStoryletLiveLink>
{
public:
	/** Open a link to the editor. `Build` is the bundle's content hash
	 *  (UStoryletBundle::GetBuildId()); `Project` is optional and shows in
	 *  the editor's connect-icon tooltip. Patterpad listens on 4471,
	 *  Storyletter on 4472. */
	static TSharedRef<FStoryletLiveLink> Create(const FString& Build, const FString& Project = FString(),
		const FString& Url = TEXT("ws://127.0.0.1:4472"));
	~FStoryletLiveLink();

	/** Start forwarding this ENGINE's trace - every flow's events, each frame
	 *  naming the flow it came from (one engine at a time: an earlier one is
	 *  detached first). Sends a board snapshot per open flow straight away,
	 *  queued behind the hello if the socket is not open yet. The engine
	 *  survives ApplyLiveBundle in place, so a live refresh needs no
	 *  re-attach. */
	void Attach(UStoryletEngine* Engine);

	/** Stop forwarding (an engine you replace yourself: attach the new one). */
	void Detach();

	/** After applying a pushed bundle: report the build now running (re-hellos
	 *  with the new build and a fresh snapshot, so the editor's icon goes
	 *  back to in sync and it stops re-pushing the same bundle). */
	void SetBuild(const FString& Build);

	/** Close the link; every later call is a no-op. */
	void Close();

	/** Where the link is: "connecting", "connected" or "closed" - the same
	 *  three Unity's LiveLinkState carries and Godot's link_state() returns.
	 *  For the Runtime State panel, so a host can tell "the editor is not
	 *  listening" from "I never attached" (2026-08-29: Unity's examiner showed
	 *  this and the other two did not, so the same panel answered a different
	 *  question in each engine). */
	FString LinkState() const;

	/** The editor URL this link talks to. */
	const FString& GetUrl() const { return Url; }

	/** The build id the editor has been told this game is running. */
	const FString& GetBuild() const { return BuildId; }

	/** Live refresh: the editor pushed a freshly compiled bundle. `Data` is
	 *  the full .storyletsc JSON: hand it, with your session, to
	 *  ApplyLiveBundle, then call SetBuild(Build). Fires on the game thread.
	 *  Never fires with a malformed frame. No-op in Shipping (the whole link
	 *  compiles out). */
	TFunction<void(const FString& Build, const FString& Data)> OnBundle;

	/** Apply a pushed bundle to a session: compile `Data`
	 *  (UStoryletBundle::LoadFromJsonString), then
	 *  UStoryletEngine::ApplyLiveBundle, which swaps the new bundle in under
	 *  the run IN PLACE (the session object and every handle to it stay
	 *  valid). False (with OutError, and the session untouched) when the JSON
	 *  does not compile or the bundle refuses the run (another project). */
	static bool ApplyLiveBundle(UStoryletEngine* Engine, const FString& Data, FString& OutError);

private:
	FStoryletLiveLink(const FString& InBuild, const FString& InProject, const FString& InUrl);
	void Connect();

	FString BuildId;
	FString Project;
	FString Url;
	TWeakObjectPtr<UStoryletEngine> Engine;
	int32 TraceHandle = 0;
	TPimplPtr<storylets::LiveLinkClient> Client;   // the frames and their order; the socket is ours
	TSharedPtr<IWebSocket> Socket;
};
