// Blueprint-facing types for the Storylet Engine's engine and flow surface. The pure
// core's std:: views (DealtCard / OutcomeView / BoxView / PropertyRow)
// are converted to these at the UObject boundary; nothing std crosses it.
#pragma once

#include "CoreMinimal.h"
#include "StoryletTypes.generated.h"

/** The storylets value kinds (boolean / number / string / flags; an enum
 *  value is a string at runtime, so four kinds carry all five types). */
UENUM(BlueprintType)
enum class EStoryletValueKind : uint8
{
	Boolean,
	Number,
	String,
	Flags
};

/** The declared property types (the bundle's vocabulary; Enum and String both
 *  carry string values at runtime). */
UENUM(BlueprintType)
enum class EStoryletPropertyType : uint8
{
	Boolean,
	Number,
	String,
	Enum,
	Flags,
	/** A quality: a closed, ORDERED ladder of stages. Absent until 2026-09-01, so
	 *  PropertyTypeFrom's fallback turned every quality into a Boolean and the
	 *  Inspector drew it as a writable checkbox. */
	Quality
};

/** One storylets value, flattened for Blueprint: a kind discriminator plus
 *  one payload per kind (only the payload the kind names is meaningful), and
 *  the stringified display form (JS-stable numbers; flags comma-joined) so a
 *  host can print any value without switching on the kind. */
USTRUCT(BlueprintType)
struct FStoryletValue
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	EStoryletValueKind Kind = EStoryletValueKind::Boolean;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	bool bBool = false;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	double Number = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString String;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FString> Flags;

	/** The stringified rendering: "true"/"false", JS-stable number, the raw
	 *  string, or the flags comma-joined. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Display;
};

/** One card-template field on a dealt card: name plus value ("stringified
 *  pairs" via Value.Display; the typed payload rides along). The engine never
 *  interprets fields - they are data for the host. */
USTRUCT(BlueprintType)
struct FStoryletFieldEntry
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Name;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FStoryletValue Value;
};

/** A card view in a dealt hand or a peeked list. Carries NO outcome
 *  availability - ask Outcomes() for current truth (schema 5). */
USTRUCT(BlueprintType)
struct FStoryletDealtCard
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Id;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString GameId;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Title;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Purpose;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FStoryletFieldEntry> Fields;
};

/** One outcome on a dealt card; bAvailable is evaluated against CURRENT
 *  state at the moment of the ask, never a deal-time snapshot. */
USTRUCT(BlueprintType)
struct FStoryletOutcomeView
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Id;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString GameId;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Title;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Purpose;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	bool bAvailable = false;

	/** Outcome-template data, declared by the box's outcome fields. Passed
	 *  through as the bundle wrote it; empty when the outcome carries none. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FStoryletFieldEntry> Fields;
};

/** One hand's contents (dealt order), keyed by the hand's gameId: the shape
 *  DealMany's dealt slice and Board() return. */
USTRUCT(BlueprintType)
struct FStoryletHandContents
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Hand;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FStoryletDealtCard> Cards;
};

/** One box on the enumeration surface: identity plus its turn clock. The
 *  examiner's turns section keys on Title (or GameId when untitled), never
 *  the internal Id. */
USTRUCT(BlueprintType)
struct FStoryletBoxView
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Id;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString GameId;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Title;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	double Turn = 0;
};

/** The retained-log entry kinds (the trace verbs of schema 5). */
UENUM(BlueprintType)
enum class EStoryletLogKind : uint8
{
	Deal,
	Peek,
	Evict,
	Play,
	Write,
	Turns,
	Diagnostic
};

/** One card's verdict in a deal or a peek: why it did or did not make the
 *  ask, in availability order (schema 3.1). The trace's per-card row. */
USTRUCT(BlueprintType)
struct FStoryletTraceCard
{
	GENERATED_BODY()

	/** The card's GAMEID (design/engine-server.md 4.4); the other runtimes
	 *  call it `id`, but on a Blueprint pin Id is the internal id. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString GameId;

	/** The verdict's wire name: "dealt", "capped", "cooldown", "deck-gate",
	 *  "tags", "condition", "priority", "claimed", "claimed-elsewhere" or
	 *  "taken", as every other runtime's log and the Live Link spell it. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Verdict;

	/** The card's evaluated priority, where the ask got that far. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	bool bHasPriority = false;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	double Priority = 0;

	/** The card's specificity, where the ask got that far. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	bool bHasSpecificity = false;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	double Specificity = 0;
};

/** One retained-log entry, flattened for Blueprint: the kind, its place in
 *  the flow's time (Seq orders the whole flow, or the whole run on the
 *  engine's log; Turn is the clock of the box the event happened in,
 *  bHasTurn false for diagnostics), the event itself, and the one-line
 *  Summary the examiner's log panel shows (write lines share the state
 *  logger's "path: from -> to" reading).
 *
 *  The event is the other runtimes' trace event as flat fields: only the
 *  fields the Kind names are filled, the rest stay empty. Identity is by
 *  gameId throughout (design/engine-server.md 4.4). A write's value and the
 *  value it replaced cross as JSON text, not as a value struct, for the
 *  reason the property surface is typed only (StoryletEngine.h). */
USTRUCT(BlueprintType)
struct FStoryletLogEntry
{
	GENERATED_BODY()

	/** The flow this happened in. Empty on a flow's own log, where it would
	 *  only repeat the panel's own heading; filled on the ENGINE's run log,
	 *  where it is the whole point (design/shared-scarcity.md 8.2). */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Flow;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	EStoryletLogKind Kind = EStoryletLogKind::Deal;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	int64 Seq = 0;

	/** Play and Turns: also the box's (new) turn, which the other runtimes
	 *  carry on the event as well. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	bool bHasTurn = false;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	double Turn = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Summary;

	/** Deal and Evict: the hand's gameId. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Hand;

	/** Peek and Turns: the box's gameId. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Box;

	/** Evict and Play: the card's gameId. A card the build no longer has
	 *  (Reason "vanished") has no gameId left, so it is named by the id the
	 *  board carried. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Card;

	/** Play: the outcome's gameId; empty for a card with no outcomes, played
	 *  with none. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Outcome;

	/** Evict: a verdict's wire name (see FStoryletTraceCard::Verdict), or
	 *  "hand-condition" or "vanished". */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Reason;

	/** Write: the authored target. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Target;

	/** Write: the resolved store location, in the address grammar
	 *  GetProperty* takes, the owner segment its gameId (a routed @hand write
	 *  shows where it actually went, schema 3.6). */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Path;

	/** Write: the landed value as JSON text (true, 3, "north", ["a","b"]). */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString ValueJson;

	/** Write: the value it replaced as JSON text; empty when there was none. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString PrevJson;

	/** Diagnostic: where the expression failed, and why. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Where;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Message;

	/** Peek: the ask's criteria, tag group to tag. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TMap<FString, FString> Criteria;

	/** Deal and Peek: every card the ask considered, with its verdict, in
	 *  the order the engine reports them. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FStoryletTraceCard> Cards;
};

/** One property-examiner row: path-addressed (GetProperty* / SetProperty*
 *  take the same Path), with the current value and declared default as
 *  display strings plus bIsDefault - Patter's reset-button pattern (the
 *  button disables while the value sits at its default). */
USTRUCT(BlueprintType)
struct FStoryletPropertyView
{
	GENERATED_BODY()

	/** "story.gold", "world.x", "box.village.heat", "value.docks.danger", ...
	 *  The owner segment is the owner's gameId (design change 4.4); its
	 *  internal id is accepted for this release and raises a diagnostic. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Path;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Name;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	EStoryletPropertyType Type = EStoryletPropertyType::Boolean;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Value;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Default;

	/** Enum options (only populated when Type == Enum, or declared flags). */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FString> Values;

	/** A quality's ordered stage ladder: the closed-set twin of Values, and what an
	 *  editor offers instead of free text. The evaluator compares stages by ladder
	 *  POSITION and refuses an unknown one, so this is not decoration. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FString> Stages;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	bool bWritable = true;

	/** True when Value currently equals Default (value equality, not string
	 *  equality: flags compare element-wise, in order). */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	bool bIsDefault = false;
};

// --- the bundle inspector (design/engine-runtimes.md 2, piece 6) -------------
//
// The bundle-level description, flattened for Blueprint. Read-only by
// construction: this is the shape that shipped, not live state, so a value
// struct on a pin carries no mis-set risk (the same call as FStoryletFieldEntry
// on a dealt card, and unlike the engine's and flows' typed-only property accessors).
// Every struct also carries the ready-made display string its view renders, so
// a Blueprint can print a row without switching on anything.

/** What bundle this is: the staleness/identity triple plus the schema tag. */
USTRUCT(BlueprintType)
struct FStoryletBundleIdentity
{
	GENERATED_BODY()

	/** The bundle schema tag ("storylets/bundle@1", or "@0" from before the
	 *  project map). */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Schema;

	/** content.project - the project name a save must agree with. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Project;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Version;

	/** hash32 over the canonical source shards (empty when unhashed). */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Hash;

	/** "full" or "stripped": whether authoring metadata (titles) survived. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Metadata;
};

/** One hole a hand fills from a property rather than with a tag: the hand
 *  MOVES when that property is written (design/engine-server.md 4.6). */
USTRUCT(BlueprintType)
struct FStoryletMovableHole
{
	GENERATED_BODY()

	/** The tag group's gameId. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Group;

	/** The property reference, exactly as authored ("@hand.zone"). */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString From;
};

/** One hand: the Deal() surface. GameId is the name Deal() is called with. */
USTRUCT(BlueprintType)
struct FStoryletHandSummary
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString GameId;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Title;

	/** The owning box's gameId (Peek's first argument for the same stock). */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Box;

	/** The effective slot cap; +infinity for an unbounded hand (read
	 *  SlotsLabel to print it). */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	double Slots = 0;

	/** "unbounded", or the slot count as a JS-stable number. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString SlotsLabel;

	/** The hand template's gameId; empty for a standalone (inline-rule) hand. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Template;

	/** The holes filled from a property; EMPTY when the hand has none, which
	 *  is the ordinary case. Writing that property moves the hand, and
	 *  SetProperty is the whole verb (4.6). */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FStoryletMovableHole> Movable;
};

/** One tag group and its tags, by gameId: the Peek() criteria surface (a
 *  criteria entry is { group gameId: tag gameId }). */
USTRUCT(BlueprintType)
struct FStoryletTagGroupSummary
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString GameId;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FString> Tags;
};

/** Counts: orientation, not inventory (no card lists anywhere). */
USTRUCT(BlueprintType)
struct FStoryletCounts
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	int32 Boxes = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	int32 Decks = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	int32 Cards = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	int32 Hands = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	int32 Templates = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	int32 TagGroups = 0;
};

/** One box: identity, its ranking policy, its tag groups, and counts (Boxes
 *  stays 0 on a per-box Counts - a box does not contain boxes). */
USTRUCT(BlueprintType)
struct FStoryletBoxSummary
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString GameId;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Title;

	/** The box is on the project map (design/project-map-contract.md 3.7): it
	 *  may name the map's group in Peek() criteria beside its own TagGroups,
	 *  which list the box's OWN groups only. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	bool bUsesMap = false;

	/** The only per-box ranking policy (Reboot 2.2). */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	bool bRankingSpecificity = true;

	/** How long one turn of a TIMED box lasts (design/engine-server.md 4.8),
	 *  which is what tells a host how often it must tick this box. Zero on an
	 *  ordinary box, whose turn is a play: the compiler refuses a timed box
	 *  under one second, so zero can only mean "not timed". */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	double TurnSeconds = 0;

	/** How many cards in this box are DURABLE (design/engine-server.md 4.2):
	 *  their `redraw: never` spend outlives the run, so a server has to lift
	 *  and restore it. Zero on the ordinary box. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	int32 DurableCards = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FStoryletTagGroupSummary> TagGroups;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FStoryletCounts Counts;
};

/** One declared property: what expressions read and what a host may set. */
USTRUCT(BlueprintType)
struct FStoryletPropertySummary
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Name;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	EStoryletPropertyType Type = EStoryletPropertyType::Boolean;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FStoryletValue Default;

	/** Enum / flags options, where declared. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FString> Values;

	/** Declared DURABLE (design/engine-server.md 4.2): the value survives a
	 *  run, and a server lifts and restores it across one. False is the
	 *  ordinary run-scoped property. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	bool bDurable = false;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Purpose;

	/** "name: type = default [options]" - the line the inspectors render. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Label;
};

/** The scopes a declaration block can belong to. Tag declarations compose into
 *  @hand for any ask that binds the tag (schema 3.6). */
UENUM(BlueprintType)
enum class EStoryletScopeKind : uint8
{
	World,
	Story,
	Box,
	Deck,
	Hand,
	Tag
};

/** One scope's declared properties. Owner is the owning entity's gameId (empty
 *  for World / Story); Box names its box; Group names a tag's group. A zone of
 *  the project map is a Tag scope with a Group and an empty Box: it belongs to
 *  none. */
USTRUCT(BlueprintType)
struct FStoryletPropertyScope
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	EStoryletScopeKind Scope = EStoryletScopeKind::World;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Owner;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Box;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Group;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FStoryletPropertySummary> Properties;

	/** "world", "box village", "tag docks (zone)" - the section heading the
	 *  inspectors render. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Label;
};

/** How many placed hands one box has standing on the project map: where its
 *  kiosks are (design/engine-server.md 4.3). */
USTRUCT(BlueprintType)
struct FStoryletMapSites
{
	GENERATED_BODY()

	/** The box, by gameId. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Box;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	int32 Sites = 0;
};

/** The project map (design/project-map-contract.md 3.7): its group, which boxes
 *  are on it, and how much geometry the bundle carries. Counts rather than the
 *  geometry: an inspector answers "what is in here", and a host that wants the
 *  polygons reads the parsed bundle directly. The geometry counts are zero when
 *  the build did not ask for geometry; the group is there regardless, because
 *  hands and cards reference it. */
USTRUCT(BlueprintType)
struct FStoryletMapSummary
{
	GENERATED_BODY()

	/** The zone group's gameId: the name an opted-in box's Peek() criteria use. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Group;

	/** Its tags (the zones), by gameId. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FString> Tags;

	/** The opted-in boxes, by gameId, in bundle order. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FString> Boxes;

	/** Drawn zones in the carried geometry. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	int32 Zones = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	int32 Backgrounds = 0;

	/** Placed hands per box, in bundle order; only boxes with a site appear. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FStoryletMapSites> Sites;
};

/** What a bundle offers a host, read from the asset alone: no session, no
 *  state, no game running (design 2, piece 6). Bundle order throughout. */
USTRUCT(BlueprintType)
struct FStoryletBundleDescription
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FStoryletBundleIdentity Identity;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FStoryletCounts Totals;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FStoryletBoxSummary> Boxes;

	/** Every hand in the bundle, box by box: the Deal() surface. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FStoryletHandSummary> Hands;

	/** World, Story, then per box: the box, its decks, its hands, its tags;
	 *  then the project map's zones, once. Scopes that declare nothing are
	 *  omitted (World and Story always show). */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FStoryletPropertyScope> Properties;

	/** True when the bundle has a project map; Map is empty otherwise. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	bool bHasMap = false;

	/** The project map, when bHasMap. */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FStoryletMapSummary Map;
};
