// The compiled bundle model + save envelope. Port of @storylet-studio/model
// (packages/model/src/index.ts): the bundle schema "storylets/bundle@0"
// (world/story property decls, boxes with decks/cards/outcomes/tag groups/
// hands/hand templates, ranking, fields, redraw, copies, the home group),
// SaveEnvelope ("storylets/save@1"), and the gameId derivation rules
// (gameIdify / effectiveGameId). No behaviour lives here.

using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace StoryletStudio.StoryletEngine
{
    /// <summary>An entity addressable by effectiveGameId: a pinned gameId, else
    /// derived from the title, else the immutable id.</summary>
    public interface IIdentified
    {
        string Id { get; }
        string GameId { get; }
        string Title { get; }
    }

    public static class Model
    {
        public const string BUNDLE_SCHEMA = "storylets/bundle@0";
        public const string SAVE_SCHEMA = "storylets/save@1";
        /// <summary>The .storyletsave FILE's schema: the HOST's wrapper (the
        /// engine's envelope plus, when the host keeps one, its @world
        /// container - design/flows.md). The engine never reads or writes the
        /// world half.</summary>
        public const string SAVEFILE_SCHEMA = "storylets/savefile@1";

        /// <summary>The reserved tag group (schema 2.4): present in every box
        /// without declaration, its tags the box's hand ids. Every hand implicitly
        /// binds it to its own name; a homed card is available only to its hand.</summary>
        public const string PLACE_GROUP = "place";

        private static readonly Regex HoleRef = new Regex(@"^@(hand|world|story)\.([a-z][a-z0-9_-]*)$");

        /// <summary>Is this `chosen` / binding value MEANT as a property
        /// reference rather than a tag id (design/engine-server.md 4.6)? The
        /// leading "@" alone, deliberately: a value that starts with one and
        /// does not parse is a mistyped reference, not an odd tag id.</summary>
        public static bool IsHoleRef(string value)
        {
            return value != null && value.StartsWith("@", System.StringComparison.Ordinal);
        }

        /// <summary>Parse a hole reference into scope and name; returns false
        /// when the value is not one. The on-disk form stays a plain string.</summary>
        public static bool TryParseHoleRef(string value, out string scope, out string name)
        {
            scope = null;
            name = null;
            if (value == null) return false;
            var m = HoleRef.Match(value);
            if (!m.Success) return false;
            scope = m.Groups[1].Value;
            name = m.Groups[2].Value;
            return true;
        }

        /// <summary>JS Number.MAX_SAFE_INTEGER: the "never" cooldown (deliberately
        /// not Infinity, which JSON-serialises to null).</summary>
        public const double MAX_SAFE_INTEGER = 9007199254740991d;

        private static readonly Regex Apostrophes = new Regex("['’]");
        private static readonly Regex NonSlug = new Regex("[^a-z0-9-]+");
        private static readonly Regex DashRuns = new Regex("-+");
        private static readonly Regex EdgeDashes = new Regex("^-+|-+$");
        private static readonly Regex ValidGameId = new Regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?$");

        /// <summary>Slugify a human label into a filename- / address-safe gameId.</summary>
        public static string GameIdify(string text)
        {
            var s = (text ?? "").ToLowerInvariant();
            s = Apostrophes.Replace(s, "");
            s = NonSlug.Replace(s, "-");
            s = DashRuns.Replace(s, "-");
            s = EdgeDashes.Replace(s, "");
            return s;
        }

        public static bool IsValidGameId(string gameId)
        {
            return gameId != null && ValidGameId.IsMatch(gameId);
        }

        /// <summary>The effective address: a pinned gameId, else derived from the
        /// title, else the immutable id (so there is always something addressable).</summary>
        public static string EffectiveGameId(IIdentified entity)
        {
            var pinned = entity.GameId?.Trim();
            if (!string.IsNullOrEmpty(pinned)) return pinned;
            var fromTitle = entity.Title != null ? GameIdify(entity.Title) : "";
            return fromTitle != "" ? fromTitle : entity.Id;
        }
    }

    /// <summary>A property declaration: @world / @story / @box / @deck / tag /
    /// hand state. A declared property always has a value (default required in
    /// the compiled bundle); referencing an undeclared property is a
    /// publish-time error. Extends the kernel's ScopeDeclaration exactly the way
    /// the TS types line up structurally.</summary>
    public sealed class PropertyDecl : ScopeDeclaration
    {
        /// <summary>The sharing axis (design/flows.md): one value across all
        /// flows, or a copy per flow. Null = the scope default (@story shared;
        /// box, deck, hand and tag properties per-flow). Never valid on a
        /// @world declaration (the compiler refuses it).</summary>
        public bool? Shared;
        /// <summary>The durability axis (design/engine-server.md 4.2), valid
        /// wherever Shared is and orthogonal to it: Shared says whose value this
        /// is WITHIN a run, Durable says whether it survives the run at all.
        /// INERT here - the engine partitions by Shared alone and never reads
        /// this; a server lifts and restores durable values across a run
        /// boundary through GetProperty / SetProperty. Never valid on a @world
        /// declaration (the compiler refuses it).</summary>
        public bool? Durable;
        /// <summary>@world only: false is the story's promise not to write it
        /// (Reboot.md 10). Absent = writable. Mirrors Patter's HostScopeDecl.Writable.</summary>
        public bool? Writable;
        public string Purpose;
    }

    /// <summary>A card-template field (box-defined). Data for the host; the
    /// engine never interprets fields and they are not addressable from
    /// expressions.</summary>
    public sealed class FieldDecl : ScopeDeclaration
    {
        public string Purpose;
    }

    /// <summary>Cooldown policy, in turns (schema 3.4): "always" | "never" | N.</summary>
    public sealed class RedrawPolicy
    {
        public static readonly RedrawPolicy Always = new RedrawPolicy();
        public static readonly RedrawPolicy Never = new RedrawPolicy { IsNever = true };
        public static RedrawPolicy After(double turns) => new RedrawPolicy { Turns = turns };

        public bool IsNever { get; private set; }
        /// <summary>Set for the numeric policy; null for always/never.</summary>
        public double? Turns { get; private set; }
    }

    public sealed class Outcome : IIdentified
    {
        public string Id { get; set; }
        public string GameId { get; set; }
        public string Title { get; set; }
        public string Purpose;
        /// <summary>Gating; availability is always evaluated against current state.</summary>
        public Expression Condition;
        /// <summary>Target ("@scope.name") -> expression; all right-hand sides
        /// evaluate against pre-play state (schema 3.7).</summary>
        public OrderedMap<string, Expression> Changes = new OrderedMap<string, Expression>();
    }

    public sealed class Card : IIdentified
    {
        public string Id { get; set; }
        public string GameId { get; set; }
        public string Title { get; set; }
        public string Purpose;
        public Expression Condition;
        /// <summary>Priority: a number, or an expression that must evaluate to a
        /// number (exactly one of the two is set; default number 0).</summary>
        public double? PriorityNumber;
        public Expression PriorityExpr;
        public RedrawPolicy Redraw = RedrawPolicy.Always;
        /// <summary>Tags: tag group id -> tag ids. An absent group is a wildcard,
        /// except the reserved home group, whose default inverts (schema 2.4).</summary>
        public OrderedMap<string, List<string>> Tags;
        /// <summary>How many hands may hold this card at once (schema 3.5):
        /// integer >= 1, default 1.</summary>
        public double? Copies;
        /// <summary>Scarce across flows (design/shared-scarcity.md); absent
        /// takes the deck's flag, set here it overrides the deck.</summary>
        public bool? Shared;
        /// <summary>How many hands ACROSS EVERY FLOW may hold this at once.
        /// Read only when shared; defaults to Copies.</summary>
        public double? SharedCopies;
        /// <summary>Does this card's redraw:never spend survive the run
        /// (design/engine-server.md 4.2)? Absent takes the deck's flag. INERT
        /// here: the server lifts the durable spends at a run boundary and puts
        /// them back through OpenFlow(id, restore) and MarkTaken.</summary>
        public bool? Durable;
        /// <summary>Card-template data: field name -> value.</summary>
        public OrderedMap<string, StoryletValue> Fields;
        public List<Outcome> Outcomes = new List<Outcome>();
    }

    public sealed class Deck : IIdentified
    {
        public string Id { get; set; }
        public string GameId { get; set; }
        public string Title { get; set; }
        public string Purpose;
        /// <summary>The deck gate, evaluated once per draw in the draw's environment.</summary>
        public Expression Condition;
        /// <summary>This pile is scarce across flows: every card in it is
        /// shared unless the card says otherwise (design/shared-scarcity.md).</summary>
        public bool? Shared;
        /// <summary>Every redraw:never card in this pile is spent past the end
        /// of the run unless the card says otherwise (4.2). Inert here.</summary>
        public bool? Durable;
        public List<PropertyDecl> Properties = new List<PropertyDecl>();
        public List<Card> Cards = new List<Card>();
    }

    public sealed class Tag : IIdentified
    {
        public string Id { get; set; }
        public string GameId { get; set; }
        string IIdentified.Title => null;
        public List<PropertyDecl> Properties;
    }

    /// <summary>A named axis for cross-cutting cards (schema 2.4). Tags are
    /// declared, not freeform.</summary>
    public sealed class TagGroup : IIdentified
    {
        public string Id { get; set; }
        public string GameId { get; set; }
        string IIdentified.Title => null;
        public string Purpose;
        /// <summary>A @world or @story property reference whose value names a tag
        /// in this group by gameId: the group binds itself from state at every ask
        /// (design/where-and-selectors.md Part B). Null for an ordinary group.</summary>
        public string BoundBy;
        /// <summary>True: a card that omits this group is unavailable wherever the
        /// group is bound, instead of wildcarding in.</summary>
        public bool Required;
        public List<Tag> Tags = new List<Tag>();
    }

    /// <summary>A declared kind of hand (schema 2.6): live-inherited, author-side
    /// only, never called from game code. One condition governs every instance.</summary>
    public sealed class HandTemplate : IIdentified
    {
        public string Id { get; set; }
        public string GameId { get; set; }
        public string Title { get; set; }
        public string Purpose;
        /// <summary>Fixed tag bindings: tag group id -> tag id.</summary>
        public OrderedMap<string, string> Bindings;
        /// <summary>The holes: tag group ids each instance fills (one tag each).</summary>
        public List<string> Chooses;
        /// <summary>Shared availability condition, ANDed in; evaluated per instance
        /// against that instance's composed @hand.</summary>
        public Expression Condition;
        /// <summary>Default slot cap; PositiveInfinity for "unbounded", null when absent.</summary>
        public double? Slots;
        /// <summary>Declared @hand state every instance carries.</summary>
        public List<PropertyDecl> Properties = new List<PropertyDecl>();
    }

    /// <summary>A standalone hand's inline rule (schema 2.6): owned by the hand.</summary>
    public sealed class HandRule
    {
        public OrderedMap<string, string> Bindings;
        public Expression Condition;
        /// <summary>PositiveInfinity for "unbounded", null when absent.</summary>
        public double? Slots;
    }

    /// <summary>A hand (schema 2.6): a template instance (template + chosen) or a
    /// standalone hand (rule). Exactly one of Template / Rule. Fully concrete:
    /// deal is name-only.</summary>
    public sealed class Hand : IIdentified
    {
        public string Id { get; set; }
        /// <summary>The name deal() is called with; a rename is a breaking change.</summary>
        public string GameId { get; set; }
        public string Title { get; set; }
        public string Purpose;
        /// <summary>Hand template id (not gameId).</summary>
        public string Template;
        /// <summary>Template instances: tag group id -> tag id, one per hole.</summary>
        public OrderedMap<string, string> Chosen;
        /// <summary>Standalone hands: the inline rule.</summary>
        public HandRule Rule;
        /// <summary>Override; defaults to the template's / rule's slots. The ONLY
        /// template field an instance may override.</summary>
        public double? Slots;
        /// <summary>Standalone hands' own @hand state (template instances inherit
        /// the template's declarations).</summary>
        public List<PropertyDecl> Properties;
    }

    public sealed class RankingPolicy
    {
        /// <summary>The only per-box ranking policy (Reboot 2.2).</summary>
        public bool Specificity = true;
    }

    /// <summary>How long one turn of a timed box lasts (design/engine-server.md 4.8).</summary>
    public sealed class TurnUnit
    {
        public double Seconds;
    }

    public sealed class Box : IIdentified
    {
        public string Id { get; set; }
        public string GameId { get; set; }
        public string Title { get; set; }
        public string Purpose;
        public RankingPolicy Ranking = new RankingPolicy();
        /// <summary>Non-null on a TIMED box: its clock counts real time, one turn
        /// every Seconds of the run (design/engine-server.md 4.8). A play in such
        /// a box advances nothing by default; the host ticks it with AdvanceTurns,
        /// and a card's redraw of N reads as N x Seconds. Null is the ordinary
        /// box, whose turn is a play. The number is inert to the runtime.</summary>
        public TurnUnit Turn;
        /// <summary>The card template: what every card in this box carries.</summary>
        public List<FieldDecl> Fields = new List<FieldDecl>();
        public List<PropertyDecl> Properties = new List<PropertyDecl>();
        public List<TagGroup> TagGroups = new List<TagGroup>();
        public List<Deck> Decks = new List<Deck>();
        public List<HandTemplate> HandTemplates = new List<HandTemplate>();
        public List<Hand> Hands = new List<Hand>();
    }

    /// <summary>Binds bundles to shards (staleness gate) and saves to bundles.</summary>
    public sealed class BundleContent
    {
        public string Project;
        public string Version;
        /// <summary>hash32 over the canonical source shards (schema 2.8).</summary>
        public string Hash;
    }

    public sealed class BundleSettings
    {
        public double PlayAdvancesTurns = 1;
    }

    public sealed class WorldSection
    {
        public List<PropertyDecl> Properties = new List<PropertyDecl>();
        // The optional ScopeRegistrySpec (owned/foreign split) is host territory;
        // the runtime ignores it at this stage.
    }

    public sealed class StorySection
    {
        public List<PropertyDecl> Properties = new List<PropertyDecl>();
    }

    /// <summary>A point in a map's own coordinate space (no units: a map is to
    /// its own scale).</summary>
    public struct MapPoint
    {
        public double X;
        public double Y;
    }

    /// <summary>One background picture behind a map, as a bundle-relative path.
    /// Draw order is list order.</summary>
    public sealed class MapBackground
    {
        /// <summary>Where the file sits relative to the bundle
        /// ("assets/&lt;box&gt;/&lt;file&gt;").</summary>
        public string File;
        public double X;
        public double Y;
        public double Width;
        public double Height;
        /// <summary>0 to 1; 1 when the bundle did not say.</summary>
        public double Opacity = 1;
    }

    /// <summary>One zone: a tag's outline, by the same gameId peek() takes.</summary>
    public sealed class MapZone
    {
        public string Tag;
        public List<MapPoint> Polygon = new List<MapPoint>();
    }

    /// <summary>Where a placed hand stands on a map, by hand gameId
    /// (design/engine-server.md 4.3). Sorted by that gameId in the bundle.</summary>
    public sealed class MapSite
    {
        /// <summary>The hand standing here, by gameId.</summary>
        public string Hand;
        public double X;
        public double Y;
    }

    /// <summary>
    /// A map the build was asked to carry: one spatial tag group's geometry
    /// (design/graphical-views.md 2, "The map MAY ship with a bundle").
    ///
    /// INERT PAYLOAD. Nothing in the engine reads this, and nothing will: the
    /// runtime deals in tag names. It is parsed and handed over so a host that
    /// wants to draw an in-game map does not have to re-parse the asset itself,
    /// which is the whole reason the export option exists.
    /// </summary>
    public sealed class BundleMap
    {
        /// <summary>The owning box, by gameId.</summary>
        public string Box;
        /// <summary>The tag group this is a map of, by gameId.</summary>
        public string Group;
        public List<MapZone> Zones = new List<MapZone>();
        public List<MapBackground> Backgrounds = new List<MapBackground>();
        /// <summary>Where the placed hands stand: empty when nobody put a hand
        /// on this map.</summary>
        public List<MapSite> Sites = new List<MapSite>();
    }

    public sealed class Bundle
    {
        public string Schema = Model.BUNDLE_SCHEMA;
        public BundleContent Content = new BundleContent();
        public string Metadata = "full";                 // "full" | "stripped"
        public BundleSettings Settings = new BundleSettings();
        public WorldSection World = new WorldSection();
        public StorySection Story = new StorySection();
        public List<Box> Boxes = new List<Box>();
        /// <summary>Maps, when the build carried them. Empty is the normal
        /// state and costs nothing.</summary>
        public List<BundleMap> Maps = new List<BundleMap>();
    }

    // --- the save envelope ----------------------------------------------------

    public sealed class PlayRecord
    {
        /// <summary>Card and outcome by gameId (feeds the play-history functions).</summary>
        public string Card;
        public string Outcome;
        public double Turn;
    }

    /// <summary>The per-scope property partitions one side of the sharing
    /// flag holds: a save carries one for the shared values and one per flow
    /// (design/flows.md). NO World member, in either: @world is the game's
    /// own state, resolved through the world resolver and saved by whoever
    /// owns it.</summary>
    public sealed class PropsPartition
    {
        public OrderedMap<string, StoryletValue> Story = new OrderedMap<string, StoryletValue>();
        public OrderedMap<string, OrderedMap<string, StoryletValue>> Box = new OrderedMap<string, OrderedMap<string, StoryletValue>>();
        public OrderedMap<string, OrderedMap<string, StoryletValue>> Deck = new OrderedMap<string, OrderedMap<string, StoryletValue>>();
        public OrderedMap<string, OrderedMap<string, StoryletValue>> Hand = new OrderedMap<string, OrderedMap<string, StoryletValue>>();
        /// <summary>Tag state, keyed by tag id.</summary>
        public OrderedMap<string, OrderedMap<string, StoryletValue>> Value = new OrderedMap<string, OrderedMap<string, StoryletValue>>();
    }

    /// <summary>One flow's blob inside the envelope (schema 4).</summary>
    public sealed class FlowSave
    {
        public PropsPartition Props = new PropsPartition();
        /// <summary>Per-box turn counters, keyed by box id (schema 3.4) - per
        /// flow: there is deliberately no global turn.</summary>
        public OrderedMap<string, double> Turns = new OrderedMap<string, double>();
        /// <summary>mulberry32 state, uint32 (schema 3.3), per flow.</summary>
        public uint Prng;
        /// <summary>Absolute next-eligible turn (of the card's box's clock) per
        /// card id; MAX_SAFE_INTEGER = never.</summary>
        public OrderedMap<string, double> Cooldowns = new OrderedMap<string, double>();
        /// <summary>Hand contents (card ids, in dealt order), keyed by hand id.
        /// The claims ledger is derived from this (schema 3.5).</summary>
        public OrderedMap<string, List<string>> Board = new OrderedMap<string, List<string>>();
        public List<PlayRecord> PlayLog = new List<PlayRecord>();
    }

    /// <summary>The whole engine, one envelope: the shared partitions once,
    /// then every live flow keyed by its id - Patter's shape (one shared blob
    /// + N flow blobs; multi-flow and save/load are the same feature).</summary>
    /// <summary>The engine's half of a save: what every flow shares. Properties,
    /// and the cards a shared redraw:never has taken out of the world for good
    /// (design/shared-scarcity.md). Claims are NOT here: they are derived from
    /// the live boards, and each flow's board rides its own blob.</summary>
    public sealed class SharedSave
    {
        public PropsPartition Props = new PropsPartition();
        /// <summary>Card ids, sorted, so a save is byte-stable for a diff.</summary>
        public List<string> Spent = new List<string>();
    }

    public sealed class SaveEnvelope
    {
        public string Schema = Model.SAVE_SCHEMA;
        public BundleContent Content = new BundleContent();
        public SharedSave Shared = new SharedSave();
        public OrderedMap<string, FlowSave> Flows = new OrderedMap<string, FlowSave>();
    }

    // --- the load report (design/engine-server.md 4.9) -------------------------
    //
    // LoadGame is forgiving by design: a card the bundle no longer has drops off
    // the board, a property the save does not carry keeps its default, and a
    // version two builds newer loads without a word. That forgiveness is what
    // makes a save survive an edit, and it is also what hides the cost of a
    // content update from whoever is about to apply one. The report is the same
    // walk, itemised: PreviewLoad computes it and changes nothing, LoadGame
    // computes it and applies it, and PreviewFlowRestore answers the same
    // questions for one flow.
    //
    // Identities are GAME IDS. The one exception is an entity the edit DELETED -
    // a vanished card, a vanished hand - which has no gameId left to give, so
    // the report carries the id the save itself carries.

    /// <summary>Why a restore refused to put a card back on the board.</summary>
    public static class EvictionReasons
    {
        public const string Vanished = "vanished";
        public const string HandVanished = "hand-vanished";
        public const string ClaimedElsewhere = "claimed-elsewhere";
    }

    /// <summary>One card a restore refused to put back. ClaimedElsewhere is only
    /// ever a single-flow restore into a LIVE engine: the card is shared and the
    /// other open flows already hold every copy the world has.</summary>
    public sealed class LoadEviction
    {
        public string Flow;
        public string Hand;
        public string Card;
        public string Reason;
    }

    /// <summary>One property the restore could not put back as it was. Flow names
    /// the flow whose half it belongs to; null is the shared half.
    ///
    /// Path is the engine's property address, spelled exactly as ListProperties()
    /// prints it and exactly as GetProperty and SetProperty accept it:
    /// "story.name" for the story scope, "scope.owner.name" for the box, deck,
    /// hand and tag scopes. No "@", which belongs to the expression language and
    /// not to an address. The owner segment is the engine's own id today, the
    /// same gap every other address in the API has; design change 4.4 moves
    /// property addresses and trace events to gameIds together, in all four
    /// runtimes.</summary>
    public sealed class LoadProperty
    {
        public string Flow;
        public string Path;
    }

    /// <summary>What a load or a flow restore would do that is not a plain
    /// restore. Lists are sorted, so two runtimes given the same save and bundle
    /// produce the same answer; Flows alone keeps the envelope's own order,
    /// because a caller re-takes its handles in it.</summary>
    public sealed class LoadReport
    {
        /// <summary>No drift and nothing dropped, defaulted or retyped. Flows is
        /// not a divergence and does not count.</summary>
        public bool Exact;
        public string Project;
        /// <summary>Drift when the two differ; reported, never refused.</summary>
        public LoadIdentity Version = new LoadIdentity();
        /// <summary>Drift when the two differ; reported, never refused.</summary>
        public LoadIdentity Hash = new LoadIdentity();
        /// <summary>The flows this restores, in the order it restores them.</summary>
        public List<string> Flows = new List<string>();
        public List<LoadEviction> Evicted = new List<LoadEviction>();
        /// <summary>Cooldowns held for cards the bundle no longer has.</summary>
        public List<LoadCooldown> DroppedCooldowns = new List<LoadCooldown>();
        /// <summary>Shared redraw:never entries for cards the bundle no longer has.</summary>
        public List<string> DroppedSpent = new List<string>();
        /// <summary>In the save, not declared any more.</summary>
        public List<LoadProperty> DroppedProperties = new List<LoadProperty>();
        /// <summary>Declared, not in the save: it takes the declaration's default.</summary>
        public List<LoadProperty> DefaultedProperties = new List<LoadProperty>();
        /// <summary>In the save, still declared, but the saved value no longer
        /// fits the declaration (its type changed, or an enum value / quality
        /// stage was edited away). It takes the declaration's default.</summary>
        public List<LoadProperty> RetypedProperties = new List<LoadProperty>();
    }

    /// <summary>One cooldown the restore forgot, because its card is gone.</summary>
    public sealed class LoadCooldown
    {
        public string Flow;
        public string Card;
    }

    /// <summary>What the save said against what this build says. Equal means no
    /// drift on that axis.</summary>
    public sealed class LoadIdentity
    {
        public string Saved = "";
        public string Bundle = "";
    }
}
