// The compiled bundle model + save envelope. Port of @storylet-studio/model
// (packages/model/src/index.ts): the bundle schema "storylets/bundle@1"
// (world/story property decls, boxes with decks/cards/outcomes/tag groups/
// hands/hand templates, ranking, fields, redraw, copies, the home group, the
// project map), SaveEnvelope ("storylets/save@3"), the gameId derivation rules
// (gameIdify / effectiveGameId) and the project map's reading helpers
// (GroupsOfBox / GroupById / AllTagGroups). No behaviour lives here.

using System.Collections.Generic;
using System.Text.RegularExpressions;
using Wildwinter.Expr;

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
        /// <summary>The bundle schema this build of the format writes: @1 since
        /// the project map (design/project-map-contract.md 2.4), the bundle that
        /// can carry Bundle.Map and Box.UsesMap.
        ///
        /// Every runtime READS @0 and @1 and refuses anything else, by name.
        /// Reading @0 is not a compatibility branch: an @0 bundle cannot carry a
        /// map, so it is the same shape with less in it. The check exists so
        /// that from this release on a runtime meeting a schema it does not know
        /// says so, rather than half-working the way an @0 runtime does on a map
        /// bundle (tag matching is by id, so its deals look right while every
        /// zone value is missing).</summary>
        public const string BUNDLE_SCHEMA = "storylets/bundle@1";
        /// <summary>The schema before the project map, still read.</summary>
        public const string BUNDLE_SCHEMA_V0 = "storylets/bundle@0";
        /// <summary>Every bundle schema a runtime accepts.</summary>
        public static readonly IReadOnlyList<string> BUNDLE_SCHEMAS = new[] { BUNDLE_SCHEMA_V0, BUNDLE_SCHEMA };
        /// <summary>The engine's save envelope, version 3 (the hands-on
        /// review, 2026-10, foundation 7): version 2's shape (the one-registry
        /// model: property values are the game's ScopeRegistry's, so the
        /// envelope holds what is NOT a property, plus the registry's values
        /// under Registry when the engine made its own registry), with a
        /// flow's turns, cooldowns and board, and the shared spent cards, keyed
        /// by GAME ID, as the play log always was. A card deleted and made
        /// again under the same Game ID keeps its cooldown and its place as
        /// well as its play count. See SaveEnvelope for the registry
        /// keys.</summary>
        public const string SAVE_SCHEMA = "storylets/save@3";
        /// <summary>Version 2, keyed by internal id: still read, every key
        /// resolved as a Game ID first and an internal id second.</summary>
        public const string SAVE_SCHEMA_V2 = "storylets/save@2";
        /// <summary>The version 1 envelope's schema tag, still read: its
        /// property partitions move into the registry as it loads.</summary>
        public const string SAVE_SCHEMA_V1 = "storylets/save@1";
        /// <summary>The .storyletsave FILE's schema: the HOST's wrapper (the
        /// engine's envelope plus, when the host keeps one, its @world
        /// container - design/flows.md). The engine never reads or writes the
        /// world half.</summary>
        public const string SAVEFILE_SCHEMA = "storylets/savefile@1";
        /// <summary>The schema tag every durable half carries (ruling H,
        /// 2026-10-06), so the shape can change later and a runtime can tell
        /// which one it was given. See DurableSave.</summary>
        public const string DURABLE_SCHEMA = "storylets/durable@1";

        /// <summary>The reserved tag group (schema 2.4): present in every box
        /// without declaration, its tags the box's hand ids. Every hand implicitly
        /// binds it to its own name; a homed card is available only to its hand.</summary>
        public const string PLACE_GROUP = "place";

        // \z, not $: a .NET `$` also matches before a final newline, so
        // "@hand.zone\n" would parse as a reference here and not in JS, whose
        // `$` is the very end. The same holds for every grammar regex below.
        private static readonly Regex HoleRef = new Regex(@"^@(hand|world|story)\.([a-z][a-z0-9_-]*)\z");

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
        private static readonly Regex ValidGameId = new Regex(@"^[a-z0-9]([a-z0-9-]*[a-z0-9])?\z");

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

        /// <summary>Is this key an array index to a JS object: the canonical
        /// text of an integer from 0 to 2^32 - 2 ("7", "42"; not "07", "-1" or
        /// "4294967295")? Such keys come first, ascending, in any JS
        /// object.</summary>
        internal static bool IsJsArrayIndex(string key)
        {
            if (string.IsNullOrEmpty(key) || key.Length > 10) return false;
            if (key.Length > 1 && key[0] == '0') return false;
            foreach (var ch in key) if (ch < '0' || ch > '9') return false;
            return ulong.Parse(key, System.Globalization.CultureInfo.InvariantCulture) <= 4294967294UL;
        }

        /// <summary>Keys in the order a JS object holds them (ruling E,
        /// 2026-10-06): array-index keys first, ascending, then the rest in
        /// insertion order. The contract wherever the reference writes an
        /// object a host or a save reads in order: a save's flows, the
        /// registry section built from them, the order flows reopen after a
        /// load, and the DealMany and Board results. Any JS reading a save
        /// sees it this way anyway, because JSON.parse reorders.</summary>
        internal static List<string> JsKeyOrder(IEnumerable<string> keys)
        {
            var indices = new List<string>();
            var rest = new List<string>();
            foreach (var key in keys) (IsJsArrayIndex(key) ? indices : rest).Add(key);
            indices.Sort((a, b) => ulong.Parse(a, System.Globalization.CultureInfo.InvariantCulture)
                .CompareTo(ulong.Parse(b, System.Globalization.CultureInfo.InvariantCulture)));
            indices.AddRange(rest);
            return indices;
        }

        /// <summary>The same map in JS object order (see JsKeyOrder): a new
        /// map, or this one when it is already in that order.</summary>
        internal static OrderedMap<string, T> InJsKeyOrder<T>(OrderedMap<string, T> map)
        {
            var keys = new List<string>(map.Keys);
            var ordered = JsKeyOrder(keys);
            bool same = true;
            for (int i = 0; i < keys.Count && same; i++) same = keys[i] == ordered[i];
            if (same) return map;
            var output = new OrderedMap<string, T>();
            foreach (var key in ordered) output.Set(key, map.GetOrDefault(key));
            return output;
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

        // --- reading the project map (design/project-map-contract.md 5, Q12) ---
        //
        // The questions every reader of a bundle asks once a group may live
        // outside the box that uses it, answered once here, because the engine,
        // DescribeBundle and the inspector each looked a bound group up in the
        // hand's own box and silently lost the project one. Pure field access.

        /// <summary>The tag groups a box sees, by NAME as well as by id: its own
        /// groups, then the project map's group when the box has opted in. The
        /// engine resolves a group name in a box against exactly this list, own
        /// groups first (a bundle the engine loads never has a box group sharing
        /// the project group's name, so the order decides nothing; it is stated
        /// for determinism).</summary>
        public static List<TagGroup> GroupsOfBox(Bundle bundle, Box box)
        {
            if (!box.UsesMap || bundle?.Map?.Group == null) return box.TagGroups;
            var groups = new List<TagGroup>(box.TagGroups);
            groups.Add(bundle.Map.Group);
            return groups;
        }

        /// <summary>A tag group by internal id, wherever it lives: in a box
        /// (`box` set) or on the project map (`box` null). Ids are
        /// project-unique, so this is bundle-wide; whether the box asking may USE
        /// the group is GroupsOfBox's question. Null when no group has the
        /// id.</summary>
        public static TagGroup GroupById(Bundle bundle, string id, out Box box)
        {
            foreach (var candidate in bundle.Boxes)
            {
                var group = candidate.TagGroups.Find(g => g.Id == id);
                if (group != null) { box = candidate; return group; }
            }
            box = null;
            return bundle.Map?.Group != null && bundle.Map.Group.Id == id ? bundle.Map.Group : null;
        }

        /// <summary>Every tag group in the bundle, each once: the boxes' groups
        /// in bundle order, then the project map's. What a walk over every value
        /// bag wants.</summary>
        public static List<TagGroup> AllTagGroups(Bundle bundle)
        {
            var groups = new List<TagGroup>();
            foreach (var box in bundle.Boxes) groups.AddRange(box.TagGroups);
            if (bundle.Map?.Group != null) groups.Add(bundle.Map.Group);
            return groups;
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
        /// is WITHIN a run, Durable says whether it survives the run at all. A
        /// durable shared property is the installation's memory, a durable
        /// per-flow one the player's pocket. The engine partitions by Shared
        /// alone; this flag only decides what the durable halves carry across a
        /// run boundary: Engine.SaveDurable and LoadDurable for a shared one,
        /// Flow.SaveDurable and OpenFlowOptions.Durable for a per-flow one.
        /// Never valid on a @world declaration (the compiler refuses it).</summary>
        public bool? Durable;
        // Writable (@world only: false is the story's promise not to write it,
        // Reboot.md 10; absent = writable) is the KERNEL's field and is declared
        // once, on ScopeDeclaration. Re-declaring it here HID the base one: the
        // loader filled this copy, PropertyBag.Set read the other, and a
        // read-only declaration refused nothing at all. The compiler said so
        // (CS0108) for as long as the field existed. Deleted 2026-09-05.
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
        /// <summary>Template data, as Card.Fields is: field name -> value,
        /// declared by the box's OutcomeFields, validated at publish, and handed
        /// to the host with the outcome. The engine never reads it: a press can
        /// say one line ("The notice is in your pocket") without spending a card
        /// on it. Null when the outcome carries none.</summary>
        public OrderedMap<string, ExprValue> Fields;
        /// <summary>Storylet extension values: extension id -> field -> value,
        /// raw as authored, any JSON (a neutral tree: OrderedMap / List / bool /
        /// double / string / null). The engine never reads them. Null when the
        /// node has none.</summary>
        public OrderedMap<string, OrderedMap<string, object>> Extensions;
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
        /// (design/engine-server.md 4.2)? Absent takes the deck's flag, set here
        /// it overrides the deck, as Shared does. Only "never" crosses the run
        /// boundary: a finite cooldown is an absolute turn of a box clock, and
        /// the clock restarts with the run. It only decides what the durable
        /// halves carry: a per-flow spend rides the flow's half (its never
        /// cooldown), a shared one the engine's half (its spent set), each by
        /// card gameId.</summary>
        public bool? Durable;
        /// <summary>Card-template data: field name -> value.</summary>
        public OrderedMap<string, ExprValue> Fields;
        /// <summary>Storylet extension values: extension id -> field -> value,
        /// raw as authored, any JSON (a neutral tree: OrderedMap / List / bool /
        /// double / string / null). The engine never reads them. Null when the
        /// node has none.</summary>
        public OrderedMap<string, OrderedMap<string, object>> Extensions;
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
        /// of the run unless the card says otherwise (4.2): see Card.Durable.</summary>
        public bool? Durable;
        public List<PropertyDecl> Properties = new List<PropertyDecl>();
        /// <summary>Storylet extension values: extension id -> field -> value,
        /// raw as authored, any JSON (a neutral tree: OrderedMap / List / bool /
        /// double / string / null). The engine never reads them. Null when the
        /// node has none.</summary>
        public OrderedMap<string, OrderedMap<string, object>> Extensions;
        public List<Card> Cards = new List<Card>();
    }

    public sealed class Tag : IIdentified
    {
        public string Id { get; set; }
        public string GameId { get; set; }
        string IIdentified.Title => null;
        public List<PropertyDecl> Properties;
        /// <summary>Storylet extension values: extension id -> field -> value,
        /// raw as authored, any JSON (a neutral tree: OrderedMap / List / bool /
        /// double / string / null). The engine never reads them. Null when the
        /// node has none.</summary>
        public OrderedMap<string, OrderedMap<string, object>> Extensions;
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
        /// <summary>Storylet extension values: extension id -> field -> value,
        /// raw as authored, any JSON (a neutral tree: OrderedMap / List / bool /
        /// double / string / null). The engine never reads them. Null when the
        /// node has none.</summary>
        public OrderedMap<string, OrderedMap<string, object>> Extensions;
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
        /// <summary>Storylet extension values: extension id -> field -> value,
        /// raw as authored, any JSON (a neutral tree: OrderedMap / List / bool /
        /// double / string / null). The engine never reads them. Null when the
        /// node has none.</summary>
        public OrderedMap<string, OrderedMap<string, object>> Extensions;
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
        /// <summary>Storylet extension values: extension id -> field -> value,
        /// raw as authored, any JSON (a neutral tree: OrderedMap / List / bool /
        /// double / string / null). The engine never reads them. Null when the
        /// node has none.</summary>
        public OrderedMap<string, OrderedMap<string, object>> Extensions;
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
        /// <summary>What every outcome in this box may carry, declared the same
        /// way. Empty when the box declares none, so a bundle without them is
        /// byte for byte what it was.</summary>
        public List<FieldDecl> OutcomeFields = new List<FieldDecl>();
        public List<PropertyDecl> Properties = new List<PropertyDecl>();
        /// <summary>The box has opted in to the PROJECT MAP
        /// (design/project-map-contract.md 1.2, 2.2): its hands may bind the
        /// map's zone group and its cards may be tagged with it, and it sees the
        /// group's name beside its own groups' names. False is "not on the map",
        /// and a box that is not may not reference the group at all: the engine
        /// refuses such a bundle at construction.
        ///
        /// Opting in changes nothing about what the box deals FROM: a hand still
        /// deals only from its own box's decks. What the boxes on the map share
        /// is the zones' values (one bag per zone), never their cards or their
        /// history.</summary>
        public bool UsesMap;
        /// <summary>The box's OWN tag groups. The project map's group is never
        /// here, even in a box that uses it: it is the bundle's, in Bundle.Map
        /// (Model.GroupsOfBox gives the two together).</summary>
        public List<TagGroup> TagGroups = new List<TagGroup>();
        public List<Deck> Decks = new List<Deck>();
        public List<HandTemplate> HandTemplates = new List<HandTemplate>();
        public List<Hand> Hands = new List<Hand>();
        /// <summary>Storylet extension values: extension id -> field -> value,
        /// raw as authored, any JSON (a neutral tree: OrderedMap / List / bool /
        /// double / string / null). The engine never reads them. Null when the
        /// node has none.</summary>
        public OrderedMap<string, OrderedMap<string, object>> Extensions;
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
        /// ("assets/&lt;file&gt;").</summary>
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

    /// <summary>The drawing half of the project map: INERT PAYLOAD, as the
    /// per-box map block before it was. Nothing in the engine reads it, and it
    /// is absent unless the project asked for it (`export.map`), so a shipping
    /// build carries no shapes. GAME IDS throughout, because a host matches
    /// these against the names it passes to Peek().</summary>
    public sealed class MapGeometry
    {
        /// <summary>Drawn zones only, by tag gameId, in group order. A tag with
        /// no polygon is not a place yet and is left out.</summary>
        public List<MapZone> Zones = new List<MapZone>();
        /// <summary>Visible background pictures, back to front.</summary>
        public List<MapBackground> Backgrounds = new List<MapBackground>();
        /// <summary>Box gameId -> where that box's placed hands stand, sorted by
        /// hand gameId. Only opted-in boxes; a box with no site has no key, and
        /// the map is empty when nothing is placed. Sites stay per box because a
        /// hand belongs to one box. The zone a site sits in is NOT repeated: the
        /// hand's own binding is what the runtime deals from.</summary>
        public OrderedMap<string, List<MapSite>> Sites = new OrderedMap<string, List<MapSite>>();
    }

    /// <summary>
    /// The PROJECT MAP (design/project-map-contract.md 2.1): at most one per
    /// project, above the boxes. Two halves, on purpose.
    ///
    /// Group is SEMANTIC and always ships when the project declares a map: the
    /// zone group, compiled exactly as a box's group is (the group's properties
    /// flattened onto each tag), which opted-in boxes' hands bind and cards are
    /// tagged with BY ID, as with any group. It is in no box's TagGroups. Each
    /// zone is one tag and so one value bag, whichever boxes' hands are dealt
    /// to it.
    ///
    /// Geometry is the drawing, and the engine never reads it. Null when the
    /// build did not ask for it.
    /// </summary>
    public sealed class ProjectMap
    {
        /// <summary>The zone group. The engine reads this.</summary>
        public TagGroup Group;
        /// <summary>Drawing data, only under `export.map`; null otherwise.</summary>
        public MapGeometry Geometry;
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
        /// <summary>The project map, when the project declares one; null
        /// otherwise. The per-box map list it replaces is gone, not kept as a
        /// one-element list: zones are no longer a box's.</summary>
        public ProjectMap Map;
        /// <summary>Other engines' game-wide scopes the content names
        /// (`patter`), sorted: the family's shared vocabulary, let through
        /// unchecked by the compiler. The engine reports when the game has not
        /// registered one. Null when the content names none.</summary>
        public List<string> ExternalScopes;
        /// <summary>The Storylet extensions the project takes, by id: each one's
        /// version, its compiled declarations by node kind (every default
        /// resolved) and the project node's own values. A node's values sit on
        /// the node, under Extensions. Null when the project takes none.</summary>
        public OrderedMap<string, BundleExtension> Extensions;
    }

    /// <summary>One Storylet extension as the bundle carries it.</summary>
    public sealed class BundleExtension
    {
        public string Version;
        /// <summary>Compiled declarations by node kind (box, tagGroup, tag,
        /// deck, card, outcome, handTemplate, hand, project).</summary>
        public OrderedMap<string, List<ExtensionFieldDecl>> Fields = new OrderedMap<string, List<ExtensionFieldDecl>>();
        /// <summary>The project node's values, raw; null when it has none.</summary>
        public OrderedMap<string, object> Project;
    }

    /// <summary>A compiled extension field declaration. Default is always
    /// present in a decl and may be any JSON, held as the neutral tree (so a
    /// JSON null default is a null here). Structured types carry their parts:
    /// Fields for a record, Key and Of for a map, Of and IdField for a list, To
    /// for a reference. The engine reads none of it; the helpers read Name and
    /// Default.</summary>
    public sealed class ExtensionFieldDecl
    {
        /// <summary>Null on a map's or list's element declaration (Of).</summary>
        public string Name;
        public string Type;
        public object Default;
        /// <summary>False only on an element declaration (Of) that left its
        /// default out.</summary>
        public bool HasDefault;
        public List<string> Values;
        public List<string> Stages;
        public string To;
        public List<ExtensionFieldDecl> Fields;
        public ExtensionKeyDecl Key;
        public ExtensionFieldDecl Of;
        /// <summary>A list's identity field (the bundle's `id`).</summary>
        public string IdField;
        public double? Min;
        public double? Max;
        public bool? Required;
    }

    /// <summary>A map extension field's key: its type, and what a reference key
    /// points to.</summary>
    public sealed class ExtensionKeyDecl
    {
        public string Type;
        public string To;
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
        public OrderedMap<string, ExprValue> Story = new OrderedMap<string, ExprValue>();
        public OrderedMap<string, OrderedMap<string, ExprValue>> Box = new OrderedMap<string, OrderedMap<string, ExprValue>>();
        public OrderedMap<string, OrderedMap<string, ExprValue>> Deck = new OrderedMap<string, OrderedMap<string, ExprValue>>();
        public OrderedMap<string, OrderedMap<string, ExprValue>> Hand = new OrderedMap<string, OrderedMap<string, ExprValue>>();
        /// <summary>Tag state, keyed by tag id.</summary>
        public OrderedMap<string, OrderedMap<string, ExprValue>> Value = new OrderedMap<string, OrderedMap<string, ExprValue>>();
    }

    /// <summary>One flow's blob inside the envelope (schema 4), and the blob
    /// SaveFlow parks.</summary>
    public sealed class FlowSave
    {
        /// <summary>The per-flow property partitions. Carried by SaveFlow, which
        /// parks one flow whole; null in a version 2 envelope's flows, whose
        /// properties are the registry's. Present in every flow of a version 1
        /// envelope.</summary>
        public PropsPartition Props;
        /// <summary>Per-box turn counters, keyed by box Game ID (schema 3.4; by
        /// box id before version 3) - per flow: there is deliberately no global
        /// turn.</summary>
        public OrderedMap<string, double> Turns = new OrderedMap<string, double>();
        /// <summary>mulberry32 state, uint32 (schema 3.3), per flow.</summary>
        public uint Prng;
        /// <summary>Absolute next-eligible turn (of the card's box's clock) per
        /// card Game ID (card id before version 3); MAX_SAFE_INTEGER =
        /// never.</summary>
        public OrderedMap<string, double> Cooldowns = new OrderedMap<string, double>();
        /// <summary>Hand contents (card Game IDs, in dealt order), keyed by hand
        /// Game ID (internal ids before version 3). The claims ledger is
        /// derived from this (schema 3.5).</summary>
        public OrderedMap<string, List<string>> Board = new OrderedMap<string, List<string>>();
        public List<PlayRecord> PlayLog = new List<PlayRecord>();
    }

    /// <summary>The engine's half of a save: what every flow shares. The cards a
    /// shared redraw:never has taken out of the world for good
    /// (design/shared-scarcity.md), and, in a version 1 envelope only, the
    /// shared property partitions. Claims are NOT here: they are derived from
    /// the live boards, and each flow's board rides its own blob.</summary>
    public sealed class SharedSave
    {
        /// <summary>The shared property partitions: version 1 only (null in a
        /// version 2 envelope, whose properties are the registry's).</summary>
        public PropsPartition Props;
        /// <summary>Card Game IDs (ids before version 3), sorted, so a save is
        /// byte-stable for a diff.</summary>
        public List<string> Spent = new List<string>();
    }

    /// <summary>The whole engine, one envelope: the shared blob once, then
    /// every live flow keyed by its id - Patter's shape (one shared blob + N
    /// flow blobs; multi-flow and save/load are the same feature).
    ///
    /// Version 3 (storylets/save@3) holds what is NOT a property (boards,
    /// clocks, cooldowns, PRNGs, play logs, spent cards), keyed by Game ID,
    /// plus, when the engine made its own registry (a standalone game), that
    /// registry's values under Registry. A game that passed a registry saves it
    /// once itself. Version 2 envelopes (storylets/save@2, the same shape keyed
    /// by internal id) still load, and so do version 1 envelopes
    /// (storylets/save@1): their property partitions move into the
    /// registry.
    ///
    /// Registry keys, identical on every runtime since they are in the save:
    /// `story` for the shared @story; `storylets/&lt;kind&gt;/&lt;id&gt;` for a
    /// shared box, deck, hand, or value bag (kind is box, deck, hand, or value,
    /// id the internal id); `storylets/flow/&lt;flowId&gt;/story` and
    /// `storylets/flow/&lt;flowId&gt;/&lt;kind&gt;/&lt;id&gt;` for a flow's own.
    /// Ids escape `%` as `%25` and `/` as `%2F`. A bag with no declared
    /// properties is not registered. A self-backed @world (no resolver bound)
    /// is a stored property too, under `world`.</summary>
    public sealed class SaveEnvelope
    {
        public string Schema = Model.SAVE_SCHEMA;
        public BundleContent Content = new BundleContent();
        /// <summary>The engine's own registry's values, keyed by registry key:
        /// present only when the engine made the registry itself (a standalone
        /// game). Null when the game passed a registry: the game saves that
        /// once, beside this envelope.</summary>
        public OrderedMap<string, OrderedMap<string, ExprValue>> Registry;
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
    // Identities are GAME IDS. An entity the edit DELETED - a vanished card, a
    // vanished hand - is named by the key the save itself carries, which is its
    // Game ID from save version 3 (an internal id in an older save). There is
    // nothing else to name it by.

    /// <summary>Why a restore refused to put a card back on the board, or a
    /// load dropped one it had put back. The first three are the restore's own.
    /// The rest are a deal's eviction reasons, the same as an EvictEvent's: a
    /// load whose envelope carries the property values checks every held card
    /// as a deal would, once the values are in place, and drops what no longer
    /// qualifies (the hands-on review, 2026-10, foundation 7).</summary>
    public static class EvictionReasons
    {
        public const string Vanished = "vanished";
        public const string HandVanished = "hand-vanished";
        public const string ClaimedElsewhere = "claimed-elsewhere";
        public const string HandCondition = "hand-condition";
        public const string DeckGate = "deck-gate";
        public const string Taken = "taken";
        public const string Cooldown = "cooldown";
        public const string Tags = "tags";
        public const string Condition = "condition";
    }

    /// <summary>One card a restore refused to put back, or a load dropped
    /// (Reason is one of <see cref="EvictionReasons"/>). ClaimedElsewhere is
    /// only ever a single-flow restore into a LIVE engine: the card is shared
    /// and the other open flows already hold every copy the world has.</summary>
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
    /// not to an address. The owner segment is its GAMEID (design change 4.4,
    /// which moved property addresses and trace events to gameIds together, in
    /// all four runtimes); an owner the build no longer has keeps the id the
    /// save arrived with, since there is no gameId left to give it.</summary>
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

    /// <summary>
    /// Copies of the bundle's own maps, for handing to a host. A view's fields
    /// and extension values (and an extension field's structured default) are
    /// the bundle's, shared by every deal and every engine on it, so a game that
    /// changed what it was handed would change it for all of them (the hands-on
    /// review, 2026-10, foundation 6). An ExprValue is immutable, so fields need
    /// only a new map; extension values are a JSON tree, so they copy deep.
    /// Null stays null, so a view with none costs nothing; an empty map is still
    /// a new one, since a host may add to it.
    /// </summary>
    internal static class Handed
    {
        public static OrderedMap<string, ExprValue> Fields(OrderedMap<string, ExprValue> values)
        {
            if (values == null) return null;
            var output = new OrderedMap<string, ExprValue>();
            foreach (var pair in values) output.Set(pair.Key, pair.Value);
            return output;
        }

        public static OrderedMap<string, OrderedMap<string, object>> Extensions(OrderedMap<string, OrderedMap<string, object>> values)
        {
            if (values == null) return null;
            var output = new OrderedMap<string, OrderedMap<string, object>>();
            foreach (var pair in values) output.Set(pair.Key, (OrderedMap<string, object>)Deep(pair.Value));
            return output;
        }

        /// <summary>A JSON tree value copied deep: maps and lists are new, a
        /// scalar (immutable) is itself.</summary>
        public static object Deep(object value)
        {
            switch (value)
            {
                case OrderedMap<string, object> map:
                {
                    var output = new OrderedMap<string, object>();
                    foreach (var pair in map) output.Set(pair.Key, Deep(pair.Value));
                    return output;
                }
                case List<object> list:
                {
                    var output = new List<object>(list.Count);
                    foreach (var item in list) output.Add(Deep(item));
                    return output;
                }
                default:
                    return value;
            }
        }
    }

    /// <summary>
    /// A box's card and outcome fields, and any node's Storylet extension
    /// values, as a host reads them. The engine hands a card's fields (and an
    /// outcome's) over exactly as the bundle wrote them: sparse, so "the card
    /// sets nothing" stays distinct from "the card sets the default". These fill
    /// in the declared defaults when a host wants the whole picture. Patter's
    /// GameDataHelpers by the same rule (patterkit design/family-parity-2026-10.md
    /// item 7); every Storylet Engine runtime carries the same helpers.
    /// ExtensionsOf reads the values of a node no view carries (a deck, a hand,
    /// a tag) by the address a game already uses.
    /// </summary>
    public static class FieldHelpers
    {
        /// <summary>A box's card template, by its gameId (or id). Empty when the
        /// box declares none or is not in the bundle.</summary>
        public static List<FieldDecl> FieldDecls(Bundle bundle, string box) =>
            BoxOf(bundle, box)?.Fields ?? new List<FieldDecl>();

        /// <summary>A box's outcome fields, by its gameId (or id). Empty when it
        /// declares none.</summary>
        public static List<FieldDecl> OutcomeFieldDecls(Bundle bundle, string box) =>
            BoxOf(bundle, box)?.OutcomeFields ?? new List<FieldDecl>();

        /// <summary>One field's effective value: the card's (or outcome's) own
        /// when it sets one, else the declared default; null for a name declared
        /// nowhere and set nowhere.</summary>
        public static ExprValue FieldValue(List<FieldDecl> decls, OrderedMap<string, ExprValue> values, string name)
        {
            if (values != null && values.TryGetValue(name, out var v)) return v;
            foreach (var f in decls) if (f.Name == name) return f.Default;
            return null;
        }

        /// <summary>Every declared field resolved (the value set, else the
        /// default), in declaration order, then any key set with no declaration,
        /// kept as it is.</summary>
        public static OrderedMap<string, ExprValue> EffectiveFields(List<FieldDecl> decls, OrderedMap<string, ExprValue> values)
        {
            var output = new OrderedMap<string, ExprValue>();
            foreach (var f in decls)
            {
                var v = FieldValue(decls, values, f.Name);
                if (v != null) output.Set(f.Name, v);
            }
            if (values != null)
                foreach (var pair in values)
                    if (!output.ContainsKey(pair.Key)) output.Set(pair.Key, pair.Value);
            return output;
        }

        // -- Storylet extension values ------------------------------------------
        //
        // The same rule (patterkit design/proposals/patter-storylet-extensions.md,
        // "At runtime"): values raw on the node, declarations with every default
        // resolved in the bundle, and the same two helpers fill them in, given
        // ExtensionDecls. Values are the neutral JSON tree, so a JSON null is a
        // real value: a field set to null stays null, as a null default does.

        /// <summary>One field's effective value, as the extension helpers read
        /// it: the node's own when it sets one, else the declared default. False
        /// for a name declared nowhere and set nowhere.</summary>
        public static bool TryFieldValue(List<ExtensionFieldDecl> decls, OrderedMap<string, object> values, string name, out object value)
        {
            if (values != null && values.TryGetValue(name, out value)) return true;
            foreach (var f in decls)
            {
                if (f.Name != name) continue;
                // The declaration's default is the bundle's, shared by every
                // node that leaves the field out: a structured one is handed out
                // as a copy (the hands-on review, 2026-10, foundation 6).
                value = Handed.Deep(f.Default);
                return f.HasDefault;
            }
            value = null;
            return false;
        }

        /// <summary>One extension field's effective value, by the rule
        /// FieldValue follows; null for a name declared nowhere and set nowhere
        /// (TryFieldValue tells that from a JSON null).</summary>
        public static object FieldValue(List<ExtensionFieldDecl> decls, OrderedMap<string, object> values, string name) =>
            TryFieldValue(decls, values, name, out var value) ? value : null;

        /// <summary>Every declared extension field resolved (the value set, else
        /// the default), in declaration order, then any key set with no
        /// declaration, kept as it is.</summary>
        public static OrderedMap<string, object> EffectiveFields(List<ExtensionFieldDecl> decls, OrderedMap<string, object> values)
        {
            var output = new OrderedMap<string, object>();
            foreach (var f in decls)
            {
                if (f.Name != null && !output.ContainsKey(f.Name) && TryFieldValue(decls, values, f.Name, out var v)) output.Set(f.Name, v);
            }
            if (values != null)
                foreach (var pair in values)
                    if (!output.ContainsKey(pair.Key)) output.Set(pair.Key, pair.Value);
            return output;
        }

        /// <summary>One extension's declarations for a node kind (card, outcome,
        /// box, deck, tagGroup, tag, handTemplate, hand, project), every default
        /// resolved. Empty when the bundle has no such extension or it declares
        /// nothing for the kind.</summary>
        public static List<ExtensionFieldDecl> ExtensionDecls(Bundle bundle, string extension, string kind)
        {
            if (bundle.Extensions == null || !bundle.Extensions.TryGetValue(extension, out var ext)) return new List<ExtensionFieldDecl>();
            return ext.Fields.TryGetValue(kind, out var decls) && decls != null ? decls : new List<ExtensionFieldDecl>();
        }

        /// <summary>
        /// A node's extension values, by extension id, raw; empty when it has
        /// none or the address names nothing. For the nodes no view carries, by
        /// the names a game already holds: project (no address); box, deck, card
        /// and hand by gameId; handTemplate as "box/template"; outcome as
        /// "card/outcome"; tagGroup and tag as "box/name", or the bare name for
        /// the project map's. The result is a fresh map; the values in it are the
        /// bundle's own.
        /// </summary>
        public static OrderedMap<string, OrderedMap<string, object>> ExtensionsOf(Bundle bundle, string kind, string address = "")
        {
            address = address ?? "";
            var slash = address.IndexOf('/');
            var first = slash < 0 ? address : address.Substring(0, slash);
            var second = slash < 0 ? null : address.Substring(slash + 1);
            switch (kind)
            {
                case "project":
                {
                    var output = new OrderedMap<string, OrderedMap<string, object>>();
                    if (bundle.Extensions != null)
                        foreach (var pair in bundle.Extensions)
                            if (pair.Value.Project != null) output.Set(pair.Key, pair.Value.Project);
                    return output;
                }
                case "box": return Copy(Named(bundle.Boxes, address)?.Extensions);
                case "deck": return Copy(Named(Decks(bundle), address)?.Extensions);
                case "card": return Copy(Named(Cards(bundle), address)?.Extensions);
                case "outcome":
                    return second == null ? Copy(null) : Copy(Named(Named(Cards(bundle), first)?.Outcomes, second)?.Extensions);
                case "hand": return Copy(Named(Hands(bundle), address)?.Extensions);
                case "handTemplate":
                    return second == null ? Copy(null) : Copy(Named(Named(bundle.Boxes, first)?.HandTemplates, second)?.Extensions);
                case "tagGroup":
                    if (second == null)
                        return Copy(bundle.Map?.Group != null && (bundle.Map.Group.GameId ?? bundle.Map.Group.Id) == first ? bundle.Map.Group.Extensions : null);
                    return Copy(Named(Named(bundle.Boxes, first)?.TagGroups, second)?.Extensions);
                case "tag":
                {
                    if (second == null) return Copy(Named(bundle.Map?.Group?.Tags, first)?.Extensions);
                    var tags = new List<Tag>();
                    foreach (var g in Named(bundle.Boxes, first)?.TagGroups ?? new List<TagGroup>()) tags.AddRange(g.Tags);
                    return Copy(Named(tags, second)?.Extensions);
                }
                default: return Copy(null);
            }
        }

        private static OrderedMap<string, OrderedMap<string, object>> Copy(OrderedMap<string, OrderedMap<string, object>> values)
        {
            return values == null ? new OrderedMap<string, OrderedMap<string, object>>() : Handed.Extensions(values);
        }

        /// <summary>The first item whose gameId (or, with none, id) is the name:
        /// the bundle's own gameId, as the JS reference reads it.</summary>
        private static T Named<T>(IEnumerable<T> items, string name) where T : class, IIdentified
        {
            if (items == null) return null;
            foreach (var x in items) if ((x.GameId ?? x.Id) == name) return x;
            return null;
        }

        private static IEnumerable<Deck> Decks(Bundle bundle)
        {
            foreach (var b in bundle.Boxes) foreach (var d in b.Decks) yield return d;
        }

        private static IEnumerable<Card> Cards(Bundle bundle)
        {
            foreach (var d in Decks(bundle)) foreach (var c in d.Cards) yield return c;
        }

        private static IEnumerable<Hand> Hands(Bundle bundle)
        {
            foreach (var b in bundle.Boxes) foreach (var h in b.Hands) yield return h;
        }

        private static Box BoxOf(Bundle bundle, string box)
        {
            foreach (var b in bundle.Boxes) if (b.GameId == box) return b;
            foreach (var b in bundle.Boxes) if (b.Id == box) return b;
            return null;
        }
    }
}
