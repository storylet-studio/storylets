// Blueprint-facing types for the Storylet Engine session surface. The pure
// core's std:: views (DealtCard / OutcomeView / BoxView / PropertyView)
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
	Flags
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

/** One retained-log entry, flattened for Blueprint: the kind, its place in
 *  session time (Seq orders the whole session; Turn is the clock of the box
 *  the event happened in, bHasTurn false for diagnostics), and the one-line
 *  Summary the examiner's log panel shows (write lines share the state
 *  logger's "path: from -> to" reading). The typed per-kind payloads stay on
 *  the core's TraceEvent; no generic value crosses a BP pin. */
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

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	bool bHasTurn = false;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	double Turn = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	FString Summary;
};

/** One property-examiner row: path-addressed (GetProperty* / SetProperty*
 *  take the same Path), with the current value and declared default as
 *  display strings plus bIsDefault - Patter's reset-button pattern (the
 *  button disables while the value sits at its default). */
USTRUCT(BlueprintType)
struct FStoryletPropertyView
{
	GENERATED_BODY()

	/** "story.gold", "world.x", "box.b_x.heat", "value.v_docks.danger", ... */
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
// on a dealt card, and unlike the session's typed-only property accessors).
// Every struct also carries the ready-made display string its view renders, so
// a Blueprint can print a row without switching on anything.

/** What bundle this is: the staleness/identity triple plus the schema tag. */
USTRUCT(BlueprintType)
struct FStoryletBundleIdentity
{
	GENERATED_BODY()

	/** The bundle schema tag ("storylets/bundle@0"). */
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

	/** The only per-box ranking policy (Reboot 2.2). */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	bool bRankingSpecificity = true;

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
 *  for World / Story); Box names its box; Group names a tag's group. */
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

	/** World, Story, then per box: the box, its decks, its hands, its tags.
	 *  Scopes that declare nothing are omitted (World and Story always show). */
	UPROPERTY(BlueprintReadOnly, Category = "Storylet Engine")
	TArray<FStoryletPropertyScope> Properties;
};
