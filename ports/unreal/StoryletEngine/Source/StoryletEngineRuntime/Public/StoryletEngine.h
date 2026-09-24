// Blueprint/C++ API over the pure core: UStoryletEngine wraps storylets::Engine
// (the world - the bundle, the shared state, @world), UStoryletFlow wraps a
// storylets::Flow owned by that engine (one playthrough - its own board,
// clocks, cooldowns, history and per-flow state). All play happens on a flow;
// open one with OpenFlow, exactly as every other runtime and Patterplay's
// UPatterEngine / UPatterFlow do (design/flows.md). The std objects are held
// behind Pimpls. Exceptions from the core are caught at this boundary and
// surfaced as error strings / logs - Blueprint never sees a C++ exception.
//
// The property surface is TYPED ONLY (GetPropertyNumber / String / Bool /
// Flags plus the matching setters); no generic FStoryletValue parameter or
// return crosses the Blueprint boundary here. A discriminated value struct
// on a BP pin forces every graph through a kind switch and makes silently
// mis-defaulted payloads easy (set a Number, forget the Kind, write false),
// so the wrapper keeps one honest pin per type instead - the same decision
// as Patterplay's UPatterEngine accessors. It appears on BOTH objects because
// the core reads differ: the engine sees @world and the shared half only and
// refuses a per-flow path, while a flow sees its whole merged view.
#pragma once

#include <memory>

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "Templates/PimplPtr.h"
#include "StoryletTypes.h"
#include "Storylets/StoryletValue.h"   // storylets::ScopeRegistry, the shared kernel's (declared only: nothing that throws)
#include "StoryletEngine.generated.h"

class UStoryletBundle;
class UStoryletEngine;
namespace storylets { class Engine; class Flow; struct TraceEvent; }

/** Pimpl holders (defined in StoryletEngine.cpp). */
class UStoryletWorld;
struct FStoryletEngineImpl;
struct FStoryletFlowImpl;

/**
 * One playthrough over the engine's world: the play verbs, over this flow's
 * own PRNG, per-box clocks, cooldowns, board, claims and play history. Handed
 * out by UStoryletEngine::OpenFlow, which owns it; a flow the engine has
 * closed (or replaced by name) is inert and every verb refuses.
 */
UCLASS(BlueprintType)
class STORYLETENGINERUNTIME_API UStoryletFlow : public UObject
{
	GENERATED_BODY()

public:
	/** The name this flow was opened under. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	FString GetFlowId() const { return Id; }

	/** True once the engine has closed this flow (closed, dropped by Reset,
	 *  or replaced by a second OpenFlow of the same name). A closed flow is
	 *  inert: every verb below refuses and logs. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	bool IsClosed() const;

	/** Close this flow: it leaves the engine and this handle goes inert. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	void Close();

	// --- the host surface (schema 5) ---------------------------------------

	/** Refresh one hand (by gameId or id); returns its new contents. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	TArray<FStoryletDealtCard> Deal(const FString& HandRef);

	/** Re-deal the named hands (seeded hand-order shuffle, evict, fill).
	 *  Returns the dealt slice: the new contents of exactly these hands,
	 *  keyed by hand gameId. Board() stays the whole-board read. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	TArray<FStoryletHandContents> DealMany(const TArray<FString>& HandRefs);

	/** Re-deal every hand in the bundle (the no-argument dealMany). */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	TArray<FStoryletHandContents> DealAllHands();

	/** Look at the top of the box's stock through raw tag criteria
	 *  ({group gameId: tag gameId}): claims respected, nothing registered.
	 *  You can never play a card you only peeked. MaxCards < 0 = unlimited.
	 *  Criteria order matters (it composes into @hand in order), and a
	 *  Blueprint Map keeps its authored order. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	TArray<FStoryletDealtCard> Peek(const FString& BoxRef, const TMap<FString, FString>& Criteria, int32 MaxCards = -1);

	/** The board: current hand contents, dealt order, keyed by hand gameId. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	TArray<FStoryletHandContents> Board() const;

	/** The board narrowed to one box's hands (by box gameId or id), same
	 *  shape and same order: "give me the barks hands" is a common query,
	 *  and boxes are how a game separates its storylet systems. Elsewhere
	 *  this is an optional argument on board() itself; it is a separate
	 *  Blueprint method because a BP pin has no optional arguments and an
	 *  always-present BoxRef pin would make the whole-board read look like
	 *  it needed one (the same call as PlayAdvancing and DealAllHands).
	 *  Empty (and a log) on an unknown box. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	TArray<FStoryletHandContents> BoardForBox(const FString& BoxRef) const;

	/** A dealt card's outcomes, each gate evaluated against CURRENT state. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	TArray<FStoryletOutcomeView> Outcomes(const FString& CardRef, const FString& FromHand);

	/** Apply an outcome (schema 3.7): the card must sit in FromHand on the
	 *  board. False (with OutError) on a gated-shut outcome, a bad write
	 *  target, or an unknown card/hand - nothing mutates on failure.
	 *  An EMPTY OutcomeGameId plays a card with no outcomes: everything a
	 *  play does except the writes (logged, turn advanced, redraw applied,
	 *  the card leaves its hand). Refused on a card that has outcomes. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	bool Play(const FString& CardRef, const FString& OutcomeGameId, const FString& FromHand, FString& OutError);

	/** Play with an explicit turn advance (overrides the bundle's
	 *  settings.playAdvancesTurns for this play only). An empty
	 *  OutcomeGameId plays a card with no outcomes, as Play does. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	bool PlayAdvancing(const FString& CardRef, const FString& OutcomeGameId, const FString& FromHand,
		double AdvanceTurns, FString& OutError);

	/** Advance one box's clock on THIS flow (a turn is one draw-from-stock
	 *  session for that box; there is deliberately no global turn). */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	void AdvanceTurns(const FString& BoxRef, double Turns = 1);

	/** A box's current turn on this flow (0 and a log on an unknown box). */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	double GetTurn(const FString& BoxRef) const;

	/** Every box, bundle order: identity plus THIS flow's clock (the
	 *  enumeration surface the examiner's turns section keys on). */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	TArray<FStoryletBoxView> ListBoxes() const;

	// --- state, as this flow sees it ----------------------------------------

	/** Every declared property as an examiner row, in the flow's MERGED view:
	 *  @world through the engine's resolver, then per scope the shared values
	 *  and this flow's own copies. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Debug")
	TArray<FStoryletPropertyView> ListProperties() const;

	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	double GetPropertyNumber(const FString& Path) const;

	/** The property's display string, whatever its kind: the raw string for
	 *  string/enum properties, "true"/"false", a JS-stable number, or the
	 *  flags comma-joined. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	FString GetPropertyString(const FString& Path) const;

	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	bool GetPropertyBool(const FString& Path) const;

	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	TArray<FString> GetPropertyFlags(const FString& Path) const;

	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	void SetPropertyNumber(const FString& Path, double Value);

	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	void SetPropertyBool(const FString& Path, bool bValue);

	/** Sets string and enum properties alike (an enum value is a string). */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	void SetPropertyString(const FString& Path, const FString& Value);

	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	void SetPropertyFlags(const FString& Path, const TArray<FString>& Values);

	// --- the retained flow log (schema 5) ------------------------------------

	/** The retained log (opt-in via the engine's bRetainLog), oldest first,
	 *  capped: one flattened entry per trace event, with the one-line Summary
	 *  the examiner's log panel shows. Empty when the engine was created
	 *  without the log. The durable play history in a save stays the play log
	 *  (schema 4) - this log is a flow-lifetime utility and is NOT saved. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Debug")
	TArray<FStoryletLogEntry> Log() const;

	/** Empty the retained log; Seq keeps counting, so ordering across a
	 *  clear stays meaningful. Cosmetic - no game state changes. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Debug")
	void ClearLog();

	// --- the trace stream, C++ only (schema 5) -------------------------------

	/** Subscribe to this flow's trace from C++ (Blueprint polls Log() instead;
	 *  no delegate crosses that boundary). The subscription is held at this
	 *  wrapper, not on the core, so it survives ApplyLiveBundle's swap. Fires
	 *  synchronously, on the thread that drove the flow. Returns a handle for
	 *  UnsubscribeTrace; 0 when the flow is closed. */
	int32 SubscribeTrace(TFunction<void(const storylets::TraceEvent&)> Handler);

	void UnsubscribeTrace(int32 Handle);

	/** The engine that owns this flow. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	UStoryletEngine* GetEngine() const { return Owner; }

	/** The std core behind the Pimpl; null once closed. In-module C++ access
	 *  only (the Live Link client reads the board from it); Blueprint never
	 *  sees it. Never cache it across ApplyLiveBundle. */
	storylets::Flow* GetCoreFlow() const;

	/** @internal - UStoryletEngine builds and rebinds these. The wrapper holds
	 *  the flow by SHARED pointer, not raw: closing a flow drops it from the
	 *  engine's map, and a raw pointer would dangle in every handle the game
	 *  still holds. Shared, the object outlives the close and the core's own
	 *  closed flag is what makes this wrapper inert - which is the contract
	 *  the other runtimes state. */
	void Init(UStoryletEngine* InOwner, const FString& InId, std::shared_ptr<storylets::Flow> InFlow);
	/** Live bundle refresh: point this wrapper at the flow of the SAME id
	 *  inside the swapped engine (null when it did not survive - the wrapper
	 *  then reads as closed). */
	void Rebind(std::shared_ptr<storylets::Flow> InFlow);
	/** (Re)install the one core-level trace hook that feeds this wrapper's
	 *  subscribers; removed again when the last one leaves, so an unwatched
	 *  flow does no trace work. */
	void SyncCoreTraceHook();

	virtual void BeginDestroy() override;

private:
	UPROPERTY()
	TObjectPtr<UStoryletEngine> Owner = nullptr;

	/** The flow's id, for re-binding after a live swap. */
	FString Id;

	TPimplPtr<FStoryletFlowImpl> Impl;
};

/**
 * The world + flow manager: the compiled bundle, the shared state, the @world
 * surface, and the named flows played over it. All play happens on a
 * UStoryletFlow from OpenFlow.
 */
UCLASS(BlueprintType)
class STORYLETENGINERUNTIME_API UStoryletEngine : public UObject
{
	GENERATED_BODY()

public:
	/** Construct a play-ready engine on a compiled bundle, seeding each flow's
	 *  PRNG (schema 3.3; seed 0 is the cross-runtime default). bRetainLog
	 *  switches on the retained per-flow log (schema 5; the other runtimes'
	 *  log option): every trace event, sequence-stamped, capped at 1000
	 *  entries, read back through a flow's Log(). World, when given, is the
	 *  game's @world container (StoryletWorld.h): the engine reads and writes
	 *  @world through it, shared by every flow and by whatever else the game
	 *  binds to the same object (Patterplay's host scope in the Hamlet demo),
	 *  and never saves it. Absent, @world is self-backed from the declared
	 *  defaults and saved with everything else. The binding survives
	 *  ApplyLiveBundle. The engine keeps its properties in a registry of its
	 *  own; a C++ game running several engines passes its one registry through
	 *  CreateWithRegistry instead. Returns nullptr (and logs) on a null or
	 *  uncompiled bundle. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	static UStoryletEngine* Create(UStoryletBundle* Bundle, int32 Seed = 0, bool bRetainLog = false, UStoryletWorld* World = nullptr);

	/** Create, on the GAME's registry: one storylets::ScopeRegistry per game,
	 *  holding every engine's properties except those the game keeps itself
	 *  (patterkit design/one-registry-handover.md). The engine registers its
	 *  bags in it (@story under `story`, every other bag under a key starting
	 *  `storylets/`, and @world when World is given), reads every other scope
	 *  from it, and a save leaves the property values to the game, which saves
	 *  the registry once, beside the engine's file. Without World, @world is
	 *  the game's to register in the registry. C++ only: the registry is a
	 *  std object shared by pointer, which no Blueprint pin carries. Returns
	 *  nullptr (and logs) on a null or uncompiled bundle or a null registry,
	 *  and when a token the engine registers is already another's (the log
	 *  names who holds it; the registry is left as it was).
	 *
	 *  storylets::ScopeRegistry is the shared kernel's
	 *  wildwinter::expr::ScopeRegistry, the SAME type Patterplay's
	 *  UPatterEngine::CreateWithRegistry takes, so a game combining the two
	 *  passes one registry to both. The module that makes the registry includes
	 *  "Storylets/Kernel.h" and sets bEnableExceptions in its Build.cs. */
	static UStoryletEngine* CreateWithRegistry(UStoryletBundle* Bundle, std::shared_ptr<storylets::ScopeRegistry> Registry,
		int32 Seed = 0, bool bRetainLog = false, UStoryletWorld* World = nullptr);

	/** The registry this engine's properties live in: the game's, from
	 *  CreateWithRegistry, or the engine's own. C++ only; null when invalid. */
	std::shared_ptr<storylets::ScopeRegistry> GetRegistry() const;

	/** The @world container given to Create, or null when self-backed. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	UStoryletWorld* GetBoundWorld() const;

	// --- flows (design/flows.md) ---------------------------------------------

	/** Open (or REPLACE) the named flow and hand back its wrapper. Re-opening
	 *  a name closes the old flow and reseeds that name's whole per-flow
	 *  state; shared state is untouched. There is no default flow: "main" is
	 *  a caller convention, not an engine rule. Null (and a log) when the
	 *  engine is invalid. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	UStoryletFlow* OpenFlow(const FString& Id);

	/** The open flow of that name, or null. Every flow a load restored is
	 *  open, including one this engine never opened itself. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	UStoryletFlow* GetFlow(const FString& Id) const;

	/** Every open flow, in the order they were opened. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	TArray<UStoryletFlow*> Flows() const;

	/** Close the named flow: its wrapper goes inert. A quiet no-op when no
	 *  flow of that name is open. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	void CloseFlow(const FString& Id);

	// --- parking one visit (design/engine-server.md 4.1) ------------------------
	//
	// The string boundary, as UStoryletSave is for the whole envelope: no
	// FlowSave struct crosses a Blueprint pin, and a parked visit is stored and
	// shipped as text anyway. Park with SaveFlowToJson then CloseFlow (closing
	// is what releases the visit's shared claims); resume with
	// OpenFlowFromJson, and ask PreviewFlowRestoreJson first if the answer
	// matters before the act.

	/** ONE flow's state as JSON, to park a visit that is walking away. Empty
	 *  (and a log) when no flow of that name is open. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Save")
	FString SaveFlowToJson(const FString& Id) const;

	/** Open the named flow AS IT WAS, from a SaveFlowToJson string. Replaces
	 *  any flow already open under that name, exactly as OpenFlow does. Drift
	 *  is tolerated as a save load tolerates it, plus one thing: a shared card
	 *  the other open flows now hold every copy of is not put back. Null (and a
	 *  log) on malformed JSON. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Save")
	UStoryletFlow* OpenFlowFromJson(const FString& Id, const FString& Json);

	/** What OpenFlowFromJson would do to that name, as a LoadReport JSON
	 *  string, without doing it (design/engine-server.md 4.9). Nothing moves.
	 *  Empty (and a log) on malformed JSON. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Save")
	FString PreviewFlowRestoreJson(const FString& Id, const FString& Json) const;

	/** Close every flow and reseed the shared state to its defaults. Values
	 *  loaded into the registry for this engine and not yet claimed are
	 *  dropped; another engine's are not. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	void Reset();

	// --- shared + @world state ------------------------------------------------

	/** The shared surface as examiner rows: @world (read through the world
	 *  resolver) then the shared half of each scope. A flow's own copies are
	 *  on UStoryletFlow::ListProperties. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Debug")
	TArray<FStoryletPropertyView> ListProperties() const;

	/** Shared and @world paths only, and another engine's game-wide scope in
	 *  the registry ("patter.gold"). A path that resolves PER-FLOW is refused
	 *  (0 / "" / false and a log naming the fix): read it on a flow, where
	 *  the answer is that playthrough's. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	double GetPropertyNumber(const FString& Path) const;

	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	FString GetPropertyString(const FString& Path) const;

	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	bool GetPropertyBool(const FString& Path) const;

	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	TArray<FString> GetPropertyFlags(const FString& Path) const;

	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	void SetPropertyNumber(const FString& Path, double Value);

	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	void SetPropertyBool(const FString& Path, bool bValue);

	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	void SetPropertyString(const FString& Path, const FString& Value);

	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	void SetPropertyFlags(const FString& Path, const TArray<FString>& Values);

	// --- live refresh (design/live-link.md) ------------------------------------

	/** Swap a freshly compiled bundle in under the running engine: a new core
	 *  on NewBundle, loaded from this one's save, swapped IN PLACE so this
	 *  UObject, every UStoryletFlow handed out, the debug registration and
	 *  every trace subscriber stay valid - flow wrappers re-bind by id (the
	 *  Patterplay precedent; FStoryletLiveLink's OnBundle hands a pushed
	 *  bundle here, then SetBuild). Edited content is tolerated the way a load
	 *  is: orphaned hand contents and cooldowns drop, new properties take
	 *  their defaults, and a flow whose name is gone reads as closed. The
	 *  retained logs start again. On the game's registry (CreateWithRegistry)
	 *  the old core hands its bags over: each leaves the registry keeping its
	 *  values, and the new core claims them as it registers the same keys.
	 *  False (with OutError, engine untouched) on a null or uncompiled bundle,
	 *  or a save the new bundle refuses. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Live Link")
	bool ApplyLiveBundle(UStoryletBundle* NewBundle, FString& OutError);

	// --- persistence (schema 4) -------------------------------------------------
	//
	// The .storyletsave string boundary is UStoryletSave (StoryletSave.h), a
	// Blueprint function library over this engine - the parity of Patterplay's
	// UPatterSave, Unity's StoryletSave and play-helpers' save.ts.

	// --- the debug registry -------------------------------------------------------

	/** Publish this engine to the editor's Runtime State examiner under an
	 *  optional label; its flows appear beneath it. Unregisters itself when
	 *  destroyed. */
	/** The RUN's log: every flow's events in one order, each entry naming its
	 *  flow. Opt in with the same bRetainLog the flow logs use.
	 *
	 *  A flow's own log cannot answer the question a run raises: when a story
	 *  action in ANOTHER flow moves shared state, your flow's log says nothing
	 *  and your value simply changes (design/shared-scarcity.md 8.2). */
	/** Every flow's trace in one stream, each event tagged with its flow. C++
	 *  only, as the flow's own is: no delegate crosses a Blueprint pin. This is
	 *  what Live Link forwards, so the editor can follow one participant and
	 *  switch (design/live-link.md). Returns a handle for UnsubscribeTrace. */
	int32 SubscribeTrace(TFunction<void(const FString&, const storylets::TraceEvent&)> Handler);

	void UnsubscribeTrace(int32 Handle);

	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Debug")
	TArray<FStoryletLogEntry> GetRunLog() const;

	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Debug")
	void ClearRunLog();

	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Debug")
	void RegisterForDebug(const FString& Label);

	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Debug")
	void UnregisterForDebug();

	/** True when the wrapped std engine exists (Create succeeded). */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	bool IsValidEngine() const;

	/** The bundle this engine plays (the new one after ApplyLiveBundle). */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	UStoryletBundle* GetBundle() const { return BundleRef; }

	/** The std core behind the Pimpl; null when invalid. In-module C++ access
	 *  only; Blueprint never sees it. Never cache it across ApplyLiveBundle. */
	storylets::Engine* GetCoreEngine() const;

	/** @internal - re-point every wrapper handed out at the flow of the same
	 *  name inside the current core (null when it did not survive, which reads
	 *  as closed). Called after anything that rebuilds the core's flows: a
	 *  live-bundle swap, and a save load. */
	void RebindFlowsAfterLoad();

	/** @internal - take or drop the one core subscription behind the wrapper's
	 *  handlers; re-taken after a live swap rebuilds the core. */
	void SyncCoreTraceHook();

	virtual void BeginDestroy() override;

private:
	/** Create and CreateWithRegistry, on a registry or (null) the engine's own. */
	static UStoryletEngine* CreateOn(UStoryletBundle* Bundle, std::shared_ptr<storylets::ScopeRegistry> Registry,
		int32 Seed, bool bRetainLog, UStoryletWorld* World);

	UPROPERTY()
	TObjectPtr<UStoryletBundle> BundleRef = nullptr;

	/** The bound @world container (null = self-backed); held here so the
	 *  resolver's weak reference stays live for as long as this engine does. */
	UPROPERTY()
	TObjectPtr<UStoryletWorld> WorldRef = nullptr;

	/** Every LIVE wrapper handed out by OpenFlow or GetFlow, so a live swap
	 *  or a load can re-bind them by id (weak: a flow the game dropped must
	 *  not be kept alive here). A wrapper leaves when its flow is closed or
	 *  replaced: re-binding by id would otherwise point it at the next flow
	 *  of that name, and a closed flow stays closed. Mutable because GetFlow
	 *  (const) makes the wrapper for a flow a load restored. */
	mutable TArray<TWeakObjectPtr<UStoryletFlow>> WrappedFlows;

	TPimplPtr<FStoryletEngineImpl> Impl;
};
