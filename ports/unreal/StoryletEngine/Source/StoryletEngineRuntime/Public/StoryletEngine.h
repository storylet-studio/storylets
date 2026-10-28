// Blueprint/C++ API over the pure core: UStoryletEngine wraps storylets::Engine
// (the world - the bundle, the shared state, the host scopes), UStoryletFlow wraps a
// storylets::Flow owned by that engine (one playthrough - its own board,
// clocks, cooldowns, history and per-flow state). All play happens on a flow;
// open one with OpenFlow, exactly as every other runtime and Patterplay's
// UPatterEngine / UPatterFlow do (design/flows.md). The std objects are held
// behind Pimpls. Exceptions from the core are caught at this boundary -
// Blueprint never sees a C++ exception - and surfaced by one convention:
//
// REFUSALS THE GAME CAN SEE (a family ruling, 2026-10-28, as Patterplay's).
// Every refusal is logged to LogStoryletEngine (StoryletLog.h) at Error, and:
//   - a SETTER (SetProperty* on the engine and on a flow, a flow's
//     AdvanceTurns) returns FString: empty when it landed, else the refusal,
//     with nothing changed;
//   - every other refusing call, which already returns something (a flow, a
//     hand, a bool, a JSON string), hands back its fallback (null, empty,
//     false) and keeps the message for GetLastError() on the object it was
//     called on, the engine or the flow (the UStoryletSave verbs keep theirs
//     on the engine they were given). Out-params stay as they were: Play,
//     Discard and ApplyLiveBundle still fill OutError too.
// GetLastError is set by a refusal and cleared by the next of those calls
// that succeeds; the setters set and clear it too. Reads (GetProperty*,
// Board, GetTurn, ListBoxes, ListProperties, Log) don't touch it: a refused
// read logs a Warning and hands back zero, empty or false.
//
// The property surface is TYPED ONLY (GetPropertyNumber / String / Bool /
// Flags plus the matching setters); no generic FStoryletValue parameter or
// return crosses the Blueprint boundary here. A discriminated value struct
// on a BP pin forces every graph through a kind switch and makes silently
// mis-defaulted payloads easy (set a Number, forget the Kind, write false),
// so the wrapper keeps one honest pin per type instead. Patterplay's
// UPatterEngine decided otherwise: it has a generic GetProperty with an
// FPatterValue out-pin as well as typed ones, and the two families' surfaces
// are to be aligned for 1.0 (the hands-on review, 2026-10, ruling 3). It
// appears on BOTH objects because the core reads differ: the engine sees
// the host scopes (@world, ...) and the shared half only and refuses a per-flow path, while a flow
// sees its whole merged view.
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
namespace storylets { class Engine; class Flow; struct TraceEvent; struct OpenFlowOptions; }

/** Pimpl holders (defined in StoryletEngine.cpp). */
class UStoryletWorld;
struct FStoryletEngineImpl;
struct FStoryletFlowImpl;

/** OpenFlow replaced a flow that still had cards dealt: its id and how many.
 *  The diagnostic hook every runtime has (the JS onReplacedFlow): the host
 *  that calls OpenFlow straight after a load discards the restored hand, and
 *  GetFlow is the call it meant. */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FStoryletReplacedFlow, const FString&, FlowId, int32, DealtCards);

/** A content error the engine played through: what failed, where, and why. */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FStoryletErrorEvent, const FStoryletPlayError&, Error);

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

	/** Why this flow's last refusing call was refused; empty when it wasn't.
	 *  Set on a refusal and cleared by the next refusing call that succeeds
	 *  (the convention at the top of this file). Blueprint can't catch what
	 *  the core throws, so the message is kept here, and logged. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	FString GetLastError() const { return LastError; }

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
	 *  You can never play a card you only peeked. At most MaxCards come back,
	 *  and a MaxCards of 0 or less returns nothing, as peek(n) does in every
	 *  runtime; PeekAll is the uncapped look. Criteria order matters (it
	 *  composes into @hand in order), and a Blueprint Map keeps its authored
	 *  order. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	TArray<FStoryletDealtCard> Peek(const FString& BoxRef, const TMap<FString, FString>& Criteria, int32 MaxCards);

	/** Peek with no cap: every available card, ranked. Elsewhere this is
	 *  peek() with the count left out; it is a separate Blueprint method
	 *  because a BP pin has no "absent" (the same call as DealAllHands). */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	TArray<FStoryletDealtCard> PeekAll(const FString& BoxRef, const TMap<FString, FString>& Criteria);

	/** The board: current hand contents, dealt order, keyed by hand gameId. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	TArray<FStoryletHandContents> Board() const;

	/** The board narrowed to one box's hands (by box gameId or id), same
	 *  shape and same order: "give me the barks hands" is a common query,
	 *  and boxes are how a game separates its storylet systems. Elsewhere
	 *  this is an optional argument on board() itself; it is a separate
	 *  Blueprint method because a BP pin has no optional arguments and an
	 *  always-present BoxRef pin would make the whole-board read look like
	 *  it needed one (the same call as PlayAdvancing and DealAllHands).
	 *  Empty (and a log) on an unknown box. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	TArray<FStoryletHandContents> BoardForBox(const FString& BoxRef) const;

	/** A dealt card's outcomes, each gate evaluated against CURRENT state. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	TArray<FStoryletOutcomeView> Outcomes(const FString& CardRef, const FString& FromHand);

	/** Apply an outcome (schema 3.7): the card must sit in FromHand on the
	 *  board. False (with OutError) on a gated-shut outcome, a bad write
	 *  target, or an unknown card/hand - nothing mutates on failure.
	 *  An EMPTY OutcomeGameId plays a card with no outcomes: everything a
	 *  play does except the writes (logged, turn advanced, redraw applied,
	 *  the card leaves its hand). Refused on a card that has outcomes. One
	 *  copy leaves, for a card the hand holds more than once. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	bool Play(const FString& CardRef, const FString& OutcomeGameId, const FString& FromHand, FString& OutError);

	/** Play with an explicit turn advance (overrides the bundle's
	 *  settings.playAdvancesTurns for this play only). An empty
	 *  OutcomeGameId plays a card with no outcomes, as Play does. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	bool PlayAdvancing(const FString& CardRef, const FString& OutcomeGameId, const FString& FromHand,
		double AdvanceTurns, FString& OutError);

	/** Take a card out of FromHand without playing it: the player turned it
	 *  down, or the game wants the room. No outcome, no play in the log, no
	 *  move of the clock; it starts its Redraw from the current turn, as a
	 *  play would, so a re-ranking deal doesn't hand it straight back. One
	 *  copy leaves, for a card the hand holds more than once. False (with
	 *  OutError) on an unknown card or hand, or a card not in that hand;
	 *  nothing mutates on failure. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	bool Discard(const FString& CardRef, const FString& FromHand, FString& OutError);

	/** Advance one box's clock on THIS flow (a turn is one draw-from-stock
	 *  session for that box; there is deliberately no global turn). Returns
	 *  "" when the clock moved, else why it was refused (an unknown box, a
	 *  timed box, a closed flow), with nothing changed, and logged. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine", meta = (ReturnDisplayName = "Refusal"))
	FString AdvanceTurns(const FString& BoxRef, double Turns = 1);

	/** A box's current turn on this flow (0 and a log on an unknown box). */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	double GetTurn(const FString& BoxRef) const;

	/** Every box, bundle order: identity plus THIS flow's clock (the
	 *  enumeration surface the examiner's turns section keys on). */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	TArray<FStoryletBoxView> ListBoxes() const;

	// --- state, as this flow sees it ----------------------------------------

	/** Every declared property as an examiner row, in the flow's MERGED view:
	 *  @world through the engine's resolver, then per scope the shared values
	 *  and this flow's own copies. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Debug")
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

	/** Write a number, in this flow's merged view. Returns "" when the write
	 *  landed, else why it was refused, with nothing changed (and logged): a
	 *  value that doesn't fit the property's declaration, in the same words
	 *  on every runtime (`"story.gold" takes a number; "5" doesn't fit`), a
	 *  name the content doesn't declare, or a closed flow. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine", meta = (ReturnDisplayName = "Refusal"))
	FString SetPropertyNumber(const FString& Path, double Value);

	/** SetPropertyNumber for true or false: "" when it landed, else why not. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine", meta = (ReturnDisplayName = "Refusal"))
	FString SetPropertyBool(const FString& Path, bool bValue);

	/** Sets string and enum properties alike (an enum value is a string): ""
	 *  when it landed, else why not. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine", meta = (ReturnDisplayName = "Refusal"))
	FString SetPropertyString(const FString& Path, const FString& Value);

	/** SetPropertyNumber for a list of flags: "" when it landed, else why not. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine", meta = (ReturnDisplayName = "Refusal"))
	FString SetPropertyFlags(const FString& Path, const TArray<FString>& Values);

	// --- durable state (ruling H) --------------------------------------------

	/** This flow's DURABLE HALF as JSON, the player's pocket: every per-flow
	 *  `durable` property's value by its address, and every per-flow durable
	 *  one-shot this flow has spent, by card gameId. Keep it between runs and
	 *  open the player's flow with it in the next one, through
	 *  UStoryletEngine::OpenFlowWithDurableJson; the shared half is the
	 *  engine's SaveDurableToJson. Empty (and a log) on a closed flow. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Save")
	FString SaveDurableToJson() const;

	// --- the retained flow log (schema 5) ------------------------------------

	/** The retained log (opt-in via the engine's bRetainLog), oldest first,
	 *  capped: one flattened entry per trace event, with the one-line Summary
	 *  the examiner's log panel shows. Empty when the engine was created
	 *  without the log. The durable play history in a save stays the play log
	 *  (schema 4) - this log is a flow-lifetime utility and is NOT saved. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Debug")
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
	 *  UnsubscribeTrace; 0 (and a log) when the flow is closed. */
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
	/** True, having logged "<Verb> - flow "<id>" is closed" (the core's own
	 *  refusal), when this wrapper is closed: the header's promise that every
	 *  verb on a closed flow refuses AND logs. Reads log at Warning and verbs
	 *  at Error, as each one's other refusals do. For a read; a refusing
	 *  call uses RefuseClosedCall. */
	bool RefuseClosed(const TCHAR* Verb, bool bRead = false) const;

	/** RefuseClosed for a refusing call: LastError cleared, and on a closed
	 *  flow set to the refusal. */
	bool RefuseClosedCall(const TCHAR* Verb) const;

	/** The core's refusal, word for word, for a wrapper whose core is gone. */
	FString ClosedMessage() const;

	UPROPERTY()
	TObjectPtr<UStoryletEngine> Owner = nullptr;

	/** The flow's id, for re-binding after a live swap. */
	FString Id;

	/** See GetLastError. Mutable: a const call (SaveDurableToJson) refuses too. */
	mutable FString LastError;

	TPimplPtr<FStoryletFlowImpl> Impl;
};

/**
 * The world + flow manager: the compiled bundle, the shared state, the host
 * scopes (@world, ...), and the named flows played over it. All play happens
 * on a UStoryletFlow from OpenFlow.
 */
UCLASS(BlueprintType)
class STORYLETENGINERUNTIME_API UStoryletEngine : public UObject
{
	GENERATED_BODY()

public:
	/** Construct a play-ready engine on a compiled bundle. The engine makes
	 *  its own property registry and acts as its own game.
	 *
	 *  HostScopes binds the scopes the GAME owns, by token without the `@`,
	 *  each to a container (StoryletWorld.h): for @world, a map of "world" to
	 *  your container. The story reads and writes your values through it,
	 *  shared by every flow and by whatever else is bound to the same object
	 *  (Patterplay's host scope in the Hamlet demo, your own systems). A bound
	 *  scope is EXTERNAL to the engine: never in its save, never written by a
	 *  load; the game saves its container itself. A declared scope left
	 *  unbound is self-backed from its declared defaults, and saved with
	 *  everything else. Tokens are case-sensitive: a token the bundle doesn't
	 *  declare is reported through OnError (Setup), naming the declared
	 *  spelling when only the case differs. The bindings survive
	 *  ApplyLiveBundle. The same option on every runtime (JS `hostScopes`,
	 *  Unity `EngineOptions.HostScopes`, Godot `host_scopes`) and Patterplay's
	 *  UPatterEngine::Create. Leave the map empty to bind none. Returns
	 *  nullptr (and logs) on a null or uncompiled bundle. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine", meta = (AutoCreateRefTerm = "HostScopes"))
	static UStoryletEngine* Create(UStoryletBundle* Bundle, const TMap<FString, UStoryletWorld*>& HostScopes);

	/** Create, choosing how the engine plays: each flow's default seed and the
	 *  retained log (see FStoryletEngineOptions), with the host scopes Create
	 *  takes. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine", meta = (AutoCreateRefTerm = "HostScopes"))
	static UStoryletEngine* CreateWithOptions(UStoryletBundle* Bundle, const FStoryletEngineOptions& Options,
		const TMap<FString, UStoryletWorld*>& HostScopes);

	/** Create, on the GAME's registry: one storylets::ScopeRegistry per game,
	 *  holding every engine's properties except those the game keeps itself
	 *  (patterkit design/one-registry-handover.md). The engine registers its
	 *  bags in it (@story under `story`, every other bag under a key starting
	 *  `storylets/`, and each bound host scope as an external scope), reads
	 *  every other scope from it, and self-backs nothing: a declared host
	 *  scope left unbound is the game's to register. A save leaves the
	 *  property values to the game, which saves the registry once, beside the
	 *  engine's file. C++ only: the registry is a std object shared by
	 *  pointer, which no Blueprint pin carries. Returns nullptr (and logs) on
	 *  a null or uncompiled bundle or a null registry, and when a token the
	 *  engine registers is already another's (the log names who holds it; the
	 *  registry is left as it was).
	 *
	 *  storylets::ScopeRegistry is the shared kernel's
	 *  wildwinter::expr::ScopeRegistry, the SAME type Patterplay's
	 *  UPatterEngine::CreateWithRegistry takes, so a game combining the two
	 *  passes one registry to both. The module that makes the registry includes
	 *  "Storylets/Kernel.h" and sets bEnableExceptions in its Build.cs. */
	static UStoryletEngine* CreateWithRegistry(UStoryletBundle* Bundle, const std::shared_ptr<storylets::ScopeRegistry>& Registry,
		const TMap<FString, UStoryletWorld*>& HostScopes = {}, const FStoryletEngineOptions& Options = FStoryletEngineOptions());

	/** The registry this engine's properties live in: the game's, from
	 *  CreateWithRegistry, or the engine's own. C++ only; null when invalid. */
	std::shared_ptr<storylets::ScopeRegistry> GetRegistry() const;

	/** Why this engine's last refusing call was refused; empty when it
	 *  wasn't: OpenFlow and the other opens, the save and load verbs (UStoryletSave's
	 *  included), CloseFlow, Reset, ApplyLiveBundle and the SetProperty*
	 *  setters. Set on a refusal and cleared by the next of them that
	 *  succeeds (the convention at the top of this file). */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	FString GetLastError() const { return LastError; }

	/** @internal - the refusal convention for calls made outside this class
	 *  (UStoryletSave): clear LastError before the call, keep and log a
	 *  refusal. */
	void ClearLastError() const { LastError.Reset(); }
	void NoteRefusal(const TCHAR* Verb, const FString& Message) const;

	/** The container bound at Create under this host scope's token ("world"),
	 *  or null when none is (the scope is self-backed, the game's registry
	 *  holds it, or the bundle has no such scope). Case-sensitive, as the
	 *  engine matches a token. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	UStoryletWorld* GetHostScope(const FString& Token) const;

	/** The name before host scopes: GetHostScope("world"). */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine", meta = (DeprecatedFunction, DeprecationMessage = "Use GetHostScope(\"world\"), the name every runtime uses."))
	UStoryletWorld* GetBoundWorld() const { return GetHostScope(TEXT("world")); }

	/** Fired when OpenFlow (or OpenFlowFromJson) replaces a flow that still
	 *  had cards dealt, with its id and how many, before the old flow goes
	 *  inert. Behaviour is unchanged; this makes visible the host that opens
	 *  a flow straight after a load and throws the restored hand away, where
	 *  GetFlow was the call. Survives ApplyLiveBundle. */
	UPROPERTY(BlueprintAssignable, Category = "Storylet Engine|Debug")
	FStoryletReplacedFlow OnReplacedFlow;

	/** Fired with each condition the engine could not evaluate and counted as
	 *  false (see FStoryletPlayError), whether or not anything traces: a host
	 *  value of the wrong type, a resolver that throws, a division by zero.
	 *  The deal carries on either way. With nothing bound, each is logged as a
	 *  Warning instead, so a content bug is never silent. A set-up problem
	 *  (Kind "setup": a host scope the bundle doesn't declare) found while the
	 *  engine is made comes before this event can be bound: it is logged as a
	 *  Warning at once, recorded in the retained log, and delivered here on
	 *  the first OpenFlow. Survives ApplyLiveBundle. Patterplay's OnError, the
	 *  same shape. */
	UPROPERTY(BlueprintAssignable, Category = "Storylet Engine")
	FStoryletErrorEvent OnError;

	// --- flows (design/flows.md) ---------------------------------------------

	/** Open (or REPLACE) the named flow and hand back its wrapper. Re-opening
	 *  a name closes the old flow and reseeds that name's whole per-flow
	 *  state; shared state is untouched. There is no default flow: "main" is
	 *  a caller convention, not an engine rule. Null (and a log) when the
	 *  engine is invalid. The flow's PRNG takes the engine's seed. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	UStoryletFlow* OpenFlow(const FString& Id);

	/** OpenFlow with this flow's own PRNG seed in place of the engine's (the
	 *  other runtimes' openFlow seed option; schema 3.3). A separate method
	 *  because a BP pin has no "absent" (the same call as PlayAdvancing). */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	UStoryletFlow* OpenFlowSeeded(const FString& Id, int32 Seed);

	/** The open flow of that name, or null. Every flow a load restored is
	 *  open, including one this engine never opened itself. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
	UStoryletFlow* GetFlow(const FString& Id) const;

	/** Every open flow, in the order they were opened. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine")
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
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Save")
	FString SaveFlowToJson(const FString& Id) const;

	/** Open the named flow AS IT WAS, from a SaveFlowToJson string. Replaces
	 *  any flow already open under that name, exactly as OpenFlow does. Drift
	 *  is tolerated as a save load tolerates it, plus one thing: a shared card
	 *  the other open flows now hold every copy of is not put back.
	 *  OutReportJson is the restore's LoadReport as JSON, the same report
	 *  PreviewFlowRestoreJson gives for the same blob (the other runtimes'
	 *  onRestoreReport): what the drift cost comes back with the act, whether
	 *  or not anybody looked first. Null, an empty report and a log on
	 *  malformed JSON. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Save")
	UStoryletFlow* OpenFlowFromJson(const FString& Id, const FString& Json, FString& OutReportJson);

	/** What OpenFlowFromJson would do to that name, as a LoadReport JSON
	 *  string, without doing it (design/engine-server.md 4.9). Nothing moves.
	 *  Empty (and a log) on malformed JSON. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Save")
	FString PreviewFlowRestoreJson(const FString& Id, const FString& Json) const;

	// --- durable state (ruling H) ------------------------------------------------
	//
	// What outlives a run: a `durable` property's value and a `durable` card's
	// `redraw: never` spend. Two halves of one shape, each a JSON string as a
	// parked flow is: the installation's memory here, a player's pocket on
	// UStoryletFlow::SaveDurableToJson. A new run starts from a fresh engine:
	// LoadDurableFromJson puts the memory in, and OpenFlowWithDurableJson opens
	// each returning player's flow with their pocket. Values are keyed by
	// property address and spends by card gameId, so a half crosses builds, and
	// whatever no longer fits comes back in the report.

	/** The engine's DURABLE HALF as JSON, the installation's memory: every
	 *  shared `durable` property's value by its address, and every shared
	 *  durable one-shot that has been spent, by card gameId. Empty (and a log)
	 *  on an invalid engine. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Save")
	FString SaveDurableToJson() const;

	/** Write a SaveDurableToJson string into this engine, a fresh one at the
	 *  top of a new run. Every shared durable property takes the memory's
	 *  value, or its default where the memory carries none that fits, and
	 *  every spend it lists is taken out of the world; nothing else is
	 *  touched. OutReportJson is the LoadReport as JSON: what no longer fits
	 *  this build (an address no longer declared durable and shared, a value
	 *  its declaration no longer takes, a card that is gone). False, an empty
	 *  report and a log, with the engine untouched, on malformed JSON, an
	 *  unknown schema or another project's memory. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Save")
	bool LoadDurableFromJson(const FString& Json, FString& OutReportJson);

	/** OpenFlow with the player's POCKET written in, from a flow's
	 *  SaveDurableToJson string: the flow starts as any new flow does, on the
	 *  engine's seed and fresh clocks, with the pocket's values laid over its
	 *  defaults and its durable spends spent. Replaces any flow already open
	 *  under that name, exactly as OpenFlow does. OutReportJson is the
	 *  LoadReport as JSON (the other runtimes' onRestoreReport), naming what
	 *  no longer fits this build. Null, an empty report and a log on malformed
	 *  JSON, an unknown schema or another project's pocket, and the flow
	 *  already open under that name is left as it was. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Save")
	UStoryletFlow* OpenFlowWithDurableJson(const FString& Id, const FString& Json, FString& OutReportJson);

	/** OpenFlowWithDurableJson with this flow's own PRNG seed in place of the
	 *  engine's (the other runtimes' openFlow seed option beside `durable`). A
	 *  separate method because a BP pin has no "absent", as OpenFlowSeeded is
	 *  to OpenFlow. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Save")
	UStoryletFlow* OpenFlowWithDurableJsonSeeded(const FString& Id, const FString& Json, int32 Seed, FString& OutReportJson);

	/** Close every flow and reseed the shared state to its defaults. Values
	 *  loaded into the registry for this engine and not yet claimed are
	 *  dropped; another engine's are not. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine")
	void Reset();

	// --- shared + @world state ------------------------------------------------

	/** The shared surface as examiner rows: @world (read through the world
	 *  resolver) then the shared half of each scope. A flow's own copies are
	 *  on UStoryletFlow::ListProperties. */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Debug")
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

	/** Write a shared or @world number (or another engine's game-wide scope,
	 *  whose engine checks it). Returns "" when the write landed, else why it
	 *  was refused, with nothing changed (and logged): a value that doesn't
	 *  fit the property's declaration, in the same words on every runtime
	 *  (`"story.gold" takes a number; "5" doesn't fit`), an undeclared name,
	 *  or a path that resolves per-flow (write it on a flow). */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine", meta = (ReturnDisplayName = "Refusal"))
	FString SetPropertyNumber(const FString& Path, double Value);

	/** SetPropertyNumber for true or false: "" when it landed, else why not. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine", meta = (ReturnDisplayName = "Refusal"))
	FString SetPropertyBool(const FString& Path, bool bValue);

	/** SetPropertyNumber for text or an enum's value: "" when it landed, else why not. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine", meta = (ReturnDisplayName = "Refusal"))
	FString SetPropertyString(const FString& Path, const FString& Value);

	/** SetPropertyNumber for a list of flags: "" when it landed, else why not. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine", meta = (ReturnDisplayName = "Refusal"))
	FString SetPropertyFlags(const FString& Path, const TArray<FString>& Values);

	// --- live refresh (design/live-link.md) ------------------------------------

	/** Swap a freshly compiled bundle in under the running engine: a new core
	 *  on NewBundle, loaded from this one's save, swapped IN PLACE so this
	 *  UObject, every UStoryletFlow handed out, the debug registration and
	 *  every trace subscriber stay valid - flow wrappers re-bind by id (the
	 *  Patterplay precedent; FStoryletLiveLink's OnBundle hands a pushed
	 *  bundle here, then SetBuild). Edited content is tolerated the way a load
	 *  is: orphaned hand contents and cooldowns drop, new properties take
	 *  their defaults, and a flow whose name is gone reads as closed. The
	 *  retained logs start again. This is the core's hotSwap: on the game's
	 *  registry (CreateWithRegistry) the old core carries its own values across
	 *  and steps out of the registry, and the new core loads them as a save
	 *  loads, so a property the edit dropped is dropped, a new one takes its
	 *  default, and values another engine keeps there are never touched.
	 *  False (with OutError, engine untouched) on a null or uncompiled bundle,
	 *  a save the new bundle refuses, or a rebuild that fails (the old core
	 *  then takes its registrations back). */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Live Link")
	bool ApplyLiveBundle(UStoryletBundle* NewBundle, FString& OutError);

	/** ApplyLiveBundle, handing back the swap's LoadReport as JSON in
	 *  OutReportJson (the play-helpers applyLiveBundle result's `report`):
	 *  the cards the edit knocked off the board and the properties it
	 *  dropped, defaulted or retyped. Empty when the swap is refused. */
	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Live Link")
	bool ApplyLiveBundleWithReport(UStoryletBundle* NewBundle, FString& OutError, FString& OutReportJson);

	// --- persistence (schema 4) -------------------------------------------------
	//
	// The .storyletsave string boundary is UStoryletSave (StoryletSave.h), a
	// Blueprint function library over this engine - the parity of Patterplay's
	// UPatterSave, Unity's StoryletSave and play-helpers' save.ts.

	// --- the run's trace and log ---------------------------------------------------

	/** Every flow's trace in one stream, each event tagged with its flow. C++
	 *  only, as the flow's own is: no delegate crosses a Blueprint pin. This is
	 *  what Live Link forwards, so the editor can follow one participant and
	 *  switch (design/live-link.md). Returns a handle for UnsubscribeTrace. */
	int32 SubscribeTrace(TFunction<void(const FString&, const storylets::TraceEvent&)> Handler);

	void UnsubscribeTrace(int32 Handle);

	/** The RUN's log: every flow's events in one order, each entry naming its
	 *  flow. Opt in with the same bRetainLog the flow logs use.
	 *
	 *  A flow's own log cannot answer the question a run raises: when a story
	 *  action in ANOTHER flow moves shared state, your flow's log says nothing
	 *  and your value simply changes (design/shared-scarcity.md 8.2). */
	UFUNCTION(BlueprintPure, Category = "Storylet Engine|Debug")
	TArray<FStoryletLogEntry> GetRunLog() const;

	UFUNCTION(BlueprintCallable, Category = "Storylet Engine|Debug")
	void ClearRunLog();

	// --- the debug registry -------------------------------------------------------

	/** Publish this engine to the editor's Runtime State examiner under an
	 *  optional label; its flows appear beneath it. Unregisters itself when
	 *  destroyed. */
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
	/** Create, CreateWithOptions and CreateWithRegistry, on a registry or
	 *  (null) the engine's own. */
	static UStoryletEngine* CreateOn(UStoryletBundle* Bundle, std::shared_ptr<storylets::ScopeRegistry> Registry,
		const TMap<FString, UStoryletWorld*>& HostScopes, const FStoryletEngineOptions& Options);

	/** Hand OnError the Setup reports held since the engine was built (see OnError). */
	void DeliverHeldErrors();

	/** True while CreateOn constructs the core: OnError can't be bound yet, so
	 *  a report is held instead. */
	bool bBuilding = false;
	TArray<FStoryletPlayError> HeldErrors;

	/** OpenFlow, OpenFlowSeeded, OpenFlowFromJson and the two durable opens:
	 *  the core's openFlow with these options, and the wrapper bookkeeping they
	 *  share. Null (and a log naming Verb) when the engine is invalid or the
	 *  core refuses. */
	UStoryletFlow* OpenFlowWith(const FString& Id, const storylets::OpenFlowOptions& Options, const TCHAR* Verb);

	/** The two durable opens: the pocket parsed from Json, the seed when given,
	 *  and the report into OutReportJson. */
	UStoryletFlow* OpenFlowWithDurable(const FString& Id, const FString& Json, TOptional<int32> Seed,
		FString& OutReportJson, const TCHAR* Verb);

	UPROPERTY()
	TObjectPtr<UStoryletBundle> BundleRef = nullptr;

	/** The game's host-scope containers, by token, as bound at Create: held
	 *  here so each resolver's weak reference stays live for as long as this
	 *  engine does. The core keeps each binding for its whole life, a live
	 *  swap's replacement included. */
	UPROPERTY()
	TMap<FString, TObjectPtr<UStoryletWorld>> HostScopeRefs;

	/** Every LIVE wrapper handed out by OpenFlow or GetFlow, so a live swap
	 *  or a load can re-bind them by id (weak: a flow the game dropped must
	 *  not be kept alive here). A wrapper leaves when its flow is closed or
	 *  replaced: re-binding by id would otherwise point it at the next flow
	 *  of that name, and a closed flow stays closed. Mutable because GetFlow
	 *  (const) makes the wrapper for a flow a load restored. */
	mutable TArray<TWeakObjectPtr<UStoryletFlow>> WrappedFlows;

	/** See GetLastError. Mutable: const calls (SaveFlowToJson,
	 *  PreviewFlowRestoreJson, SaveDurableToJson) refuse too. */
	mutable FString LastError;

	TPimplPtr<FStoryletEngineImpl> Impl;
};
