// The Engine + Flow: the world + flow manager and the personal playthrough
// (design/flows.md; the shape is Patter's), transliterated from the
// reference runtime (packages/runtime/src/engine.ts) and held to the
// conformance corpus. An Engine owns the bundle, the lookups, the SHARED
// property partitions and the @world seam; a Flow owns its own PRNG, clocks,
// cooldowns, board, claims, play history and per-flow partitions. Every name
// is shared XOR per-flow by declaration, so a read is a union of two bags and
// a write routes by name. No default flow, no ambient flow: OpenFlow(id)
// is the only way in, an existing id is REPLACED, closed handles are
// INERT, and engine-level reads of per-flow refs throw the teaching error.
//
// One registry per game (patterkit design/one-registry-handover.md): every
// property bag lives in ONE ScopeRegistry, the game's (EngineOptions.Registry)
// or, when the game passes none, the engine's own, and the engine then acts
// as its own game. The shared @story registers under `story`, every other bag
// that declares something under a key starting `storylets/`, which no
// expression can name. SaveGame() carries what is NOT a property, plus the
// registry's values only when the engine made the registry itself. @world is
// the game's: a resolver it binds (EngineOptions.World, never saved), a scope
// it registers in its registry, or, for a standalone engine, a self-backed
// bag the registry stores and saves.
//
// Key dealing contracts, per flow, in one place:
//   - two verbs: deal(hand) claims, peek(box, criteria) just looks; you can
//     never play a card you only peeked (3.1, look/use rule)
//   - availability order: deck gate -> cooldown -> tags -> hand condition ->
//     card condition -> claims (3.1)
//   - claims are physical WITHIN a flow: a card sits in at most `copies`
//     hands of that flow's board at once, at most once in any one hand; the
//     ledger is derived from the board contents (3.5)
//   - a SHARED card (its deck's flag, or its own overriding it) is scarce
//     across flows too: at most `sharedCopies` hands anywhere, counted over
//     every live flow's board, and a shared `redraw: "never"` is spent for
//     everyone the first time anyone plays it. A finite redraw deliberately
//     does NOT share: a cooldown is an absolute turn of this flow's box clock
//     (design/shared-scarcity.md)
//   - the reserved home group inverts the wildcard: a homed card is
//     available only to an ask binding its home (2.4)
//   - ranking: priority desc -> specificity desc (box toggle) -> seeded
//     shuffle of each maximal tie run (3.2); sorts are STABLE
//   - one PRNG per flow: expression random(), tie shuffles and the batch
//     deal's hand-order shuffle all advance it; state lives in the save (3.3)
//   - each box has its own turn counter; cooldowns are absolute
//     next-eligible turns of the card's box's clock, set at play time from
//     the post-advance turn; "never" is MAX_SAFE_INTEGER, not Infinity (3.4)
//   - @hand composes bound-tag props -> hand props -> chosen tags/criteria
//     (by group name), later shadowing earlier; writes route back to their
//     source; criteria names cannot be written (3.6)
//   - outcome availability is never snapshotted: outcomes() and play()
//     evaluate gates against current state (3.1, 3.7)
//   - a trace event fires after the state it reports has landed, so a
//     handler reading the flow inside it sees the effect (the Live Link's
//     board snapshot depends on this; the shared fixture pins it)

using System;
using System.Collections.Generic;
using System.Linq;
using Wildwinter.Expr;

namespace StoryletStudio.StoryletEngine
{
    internal sealed class CardEntry
    {
        public Card Card;
        public Deck Deck;
        public Box Box;
    }

    internal sealed class HandInBox
    {
        public Hand Hand;
        public Box Box;
    }

    /// <summary>One side's five declaration lists, keyed by owner id where the
    /// scope has owners. The bags are built from these; so is the load report's
    /// answer to "what does this build declare that the save does not
    /// carry".</summary>
    internal sealed class DeclSet
    {
        public List<PropertyDecl> Story = new List<PropertyDecl>();
        public OrderedMap<string, List<PropertyDecl>> Box = new OrderedMap<string, List<PropertyDecl>>();
        public OrderedMap<string, List<PropertyDecl>> Deck = new OrderedMap<string, List<PropertyDecl>>();
        public OrderedMap<string, List<PropertyDecl>> Hand = new OrderedMap<string, List<PropertyDecl>>();
        public OrderedMap<string, List<PropertyDecl>> Value = new OrderedMap<string, List<PropertyDecl>>();

        public OrderedMap<string, List<PropertyDecl>> Kind(string kind)
        {
            switch (kind)
            {
                case "box": return Box;
                case "deck": return Deck;
                case "hand": return Hand;
                default: return Value;
            }
        }
    }

    /// <summary>The owner segment of a property address, both ways round
    /// (design/engine-server.md 4.4).
    ///
    /// GameId is the id the ADDRESS uses; Id is the internal id everything
    /// inside the engine is keyed by - the bags, the save envelope, the
    /// ladders. Both maps are built in bundle order and a repeated gameId does
    /// NOT overwrite the first: box, hand and card gameIds are unique
    /// bundle-wide, but a TAG's is unique only within its group, and a group's
    /// only within its box, so two boxes may each name a tag "docks".
    /// "value.docks" names the first of the two, and the second stays reachable
    /// by its internal id - which is the one part of the internal-id form that
    /// cannot be retired on the same timetable as the rest.</summary>
    internal sealed class OwnerIndex
    {
        /// <summary>Internal id -> the owner segment an address prints.</summary>
        public readonly Dictionary<string, string> GameId = new Dictionary<string, string>();
        /// <summary>Owner segment -> internal id; first in bundle order wins.</summary>
        public readonly Dictionary<string, string> Id = new Dictionary<string, string>();
        /// <summary>A short form more than one owner answers to -> the
        /// qualified candidates, in bundle order. Only the value scope can
        /// have one (a tag's gameId is unique within its group alone), and it
        /// is REFUSED rather than resolved to the first.</summary>
        public readonly Dictionary<string, List<string>> Repeated = new Dictionary<string, List<string>>();

        public void Add(string id, string gameId)
        {
            GameId[id] = gameId;
            if (!Id.ContainsKey(gameId)) Id[gameId] = id;
        }
    }

    // One side's five stores (shared on the engine, per-flow on each flow).
    internal sealed class Partition
    {
        public PropertyBag Story;
        public OrderedMap<string, PropertyBag> Box = new OrderedMap<string, PropertyBag>();
        public OrderedMap<string, PropertyBag> Deck = new OrderedMap<string, PropertyBag>();
        public OrderedMap<string, PropertyBag> Hand = new OrderedMap<string, PropertyBag>();
        public OrderedMap<string, PropertyBag> Value = new OrderedMap<string, PropertyBag>();
    }

    public sealed class EngineOptions
    {
        /// <summary>Default seed for each flow's PRNG; override per flow in
        /// OpenFlow (cross-runtime determinism, schema 3.3). Default 0.</summary>
        public double Seed = 0;
        /// <summary>Retain each flow's event log for introspection: every trace
        /// event, sequence-stamped and turn-stamped where the event has a box
        /// context. Off by default; SubscribeTrace stays the zero-retention stream.</summary>
        public bool Log = false;
        /// <summary>Retained log cap (oldest dropped first) when Log is on.</summary>
        public int LogCap = 1000;
        /// <summary>The host's @world resolver - the values the game owns and
        /// the story reads (and, where CanSet, writes). Engine-level, shared by
        /// all flows, never saved: the game keeps these values. Null and no
        /// Registry = a standalone engine self-backs @world from the declared
        /// defaults, as a property its registry stores and saves. A game
        /// running several engines registers @world in its registry itself
        /// instead.</summary>
        public IScopeResolver World = null;
        /// <summary>The game's registry: ONE per game, holding every engine's
        /// properties except those the game keeps itself, saved once. Given
        /// one, the engine registers its own scopes in it (@story under
        /// `story`, every other bag under a key starting `storylets/`, and
        /// @world if World is set), reads every other scope from it, and
        /// SaveGame() leaves the property values to the game. @world is then
        /// the game's to register: owned if the registry should store it,
        /// foreign if the game keeps it. Null = the engine makes its own
        /// registry and acts as its own game: it self-backs @world, and
        /// SaveGame() carries the registry's values too.</summary>
        public ScopeRegistry Registry = null;
        /// <summary>Diagnostics hook (opt-in, dev only): fired when OpenFlow
        /// REPLACES a flow that still had cards dealt (flow id, count). The
        /// behaviour is unchanged; this makes observable the host that calls
        /// OpenFlow straight after LoadGame and discards the restored hand -
        /// GetFlow is the call. Parity with the JS runtime's onReplacedFlow.
        /// Zero cost when unset.</summary>
        public Action<string, int> OnReplacedFlow = null;

        /// <summary>A copy, for a HotSwap replacement: the engine keeps the
        /// options it was built with, and a caller that changes its own
        /// EngineOptions afterwards changes nothing here.</summary>
        internal EngineOptions Copy() => (EngineOptions)MemberwiseClone();
    }

    /// <summary>What Engine.HotSwap produced: the replacement engine, and the
    /// report its load gave (the properties the edit dropped, defaulted or
    /// retyped, the cards it evicted, and the drift between the two
    /// builds).</summary>
    public sealed class HotSwapResult
    {
        public Engine Engine;
        public LoadReport Report;
    }

    public sealed class OpenFlowOptions
    {
        /// <summary>Seed for this flow's PRNG (null = the engine's Seed).</summary>
        public double? Seed = null;
        /// <summary>Open this flow AS IT WAS: a blob from SaveFlow, applied to
        /// the freshly opened (or replaced) flow before the handle comes back
        /// (design/engine-server.md 4.1).
        ///
        /// An option on OpenFlow rather than a Flow.Restore verb on purpose:
        /// restoring INTO a running flow is the trap hosts keep falling into
        /// (OpenFlow REPLACES), and "open this flow as it was" is one act.
        /// Drift is tolerated exactly as LoadGame tolerates it, with one
        /// addition, because this restore lands in a LIVE engine: a shared card
        /// whose world copies are all held by the OTHER open flows is not put
        /// back, and is reported as claimed-elsewhere. Ask PreviewFlowRestore
        /// first to see that coming.</summary>
        public FlowSave Restore = null;
        /// <summary>Handed the Restore's LoadReport as it happens - the same
        /// report PreviewFlowRestore returns for the same blob. Ignored without
        /// Restore; the report has nowhere else to go, since OpenFlow returns
        /// the handle.</summary>
        public Action<LoadReport> OnRestoreReport = null;
    }

    /// <summary>A card view in a dealt hand or a peeked list. Carries NO outcome
    /// availability - ask Outcomes() for current truth (schema 5).</summary>
    public sealed class DealtCard
    {
        public string Id;
        public string GameId;
        public string Title;
        public string Purpose;
        public OrderedMap<string, ExprValue> Fields;
    }

    public sealed class OutcomeView
    {
        public string Id;
        public string GameId;
        public string Title;
        public string Purpose;
        /// <summary>The outcome's fields, exactly as the bundle carries them:
        /// game data declared by the box's OutcomeFields, never read by the
        /// engine.</summary>
        public OrderedMap<string, ExprValue> Fields;
        /// <summary>Evaluated against CURRENT state at the moment of the ask.</summary>
        public bool Available;
    }

    /// <summary>What a peek returns: the top of the stock, looked at and put
    /// back. The engine has no pick policy (Reboot 2.1).</summary>
    public sealed class RankedList
    {
        public string Box;
        public List<DealtCard> Cards = new List<DealtCard>();
    }

    public sealed class PlayOptions
    {
        /// <summary>Turn advance override; default Settings.PlayAdvancesTurns.</summary>
        public double? AdvanceTurns;
    }

    // --- the trace (schema 5): the deal/play log for tooling ------------------

    /// <summary>Why a card did or did not make an ask, in availability order (schema 3.1).</summary>
    public enum TraceVerdict
    {
        Dealt,          // in the hand / the returned list
        Capped,         // eligible, ranked below the size cap
        Cooldown,       // schema 3.1 step 1
        DeckGate,       // step 2
        Tags,           // step 3 (incl. the home group's inverted default)
        Condition,      // steps 4-5 (a failing or erroring condition)
        Priority,       // a priority expression errored or was not a number
        Claimed,        // step 6: no free copy on YOUR board
        ClaimedElsewhere, // step 6: another flow holds the world's copies
        Taken,          // a shared redraw:never was spent, by anyone, for everyone
    }

    public sealed class TraceCard
    {
        /// <summary>The card's GAMEID (design/engine-server.md 4.4).</summary>
        public string Id;
        public TraceVerdict Verdict;
        public double? Priority;
        public double? Specificity;
    }

    /// <summary>One event on the deal/play log. The verb is the event type, so a
    /// peek is distinguishable from a deal when reading a run back.
    ///
    /// IDENTITY IS BY GAMEID throughout (design/engine-server.md 4.4). It was
    /// mixed until then: DealEvent.Hand and PeekEvent.Box were gameIds while
    /// EvictEvent's pair, PlayEvent.Card and every TraceCard.Id were internal
    /// ids, so every consumer outside the engine - the Board, the four
    /// examiners, the Live Link, a wire a kiosk reads - mapped one to the
    /// other itself.</summary>
    public abstract class TraceEvent { }

    public sealed class DealEvent : TraceEvent
    {
        /// <summary>Hand gameId.</summary>
        public string Hand;
        public List<TraceCard> Cards;
    }

    public sealed class PeekEvent : TraceEvent
    {
        /// <summary>Box gameId.</summary>
        public string Box;
        public OrderedMap<string, string> Criteria;
        public List<TraceCard> Cards;
    }

    /// <summary>Hand and card gameIds. A card the build no longer has (Reason
    /// "vanished") has no gameId left and is named by the id the board
    /// carried.</summary>
    public sealed class EvictEvent : TraceEvent
    {
        public string Hand;
        public string Card;
        /// <summary>A verdict wire name, or "hand-condition" / "vanished".</summary>
        public string Reason;
    }

    /// <summary>Card and outcome gameIds.</summary>
    public sealed class PlayEvent : TraceEvent
    {
        public string Card;
        public string Outcome;
        public double Turn;
    }

    /// <summary>One landed outcome change; Path is the resolved store location,
    /// in the address grammar GetProperty takes - the owner segment is its
    /// gameId (a routed @hand write shows where it actually went, schema 3.6).
    /// Prev is the value it replaced, so a log can read "0 -> 1".</summary>
    public sealed class WriteEvent : TraceEvent
    {
        public string Target;
        public string Path;
        public ExprValue Value;
        public ExprValue Prev;
    }

    /// <summary>An explicit clock advance via AdvanceTurns (schema 3.4); Turn is
    /// the box's new value. Plays stamp their own turn on the play event.</summary>
    public sealed class TurnsEvent : TraceEvent
    {
        public string Box;
        public double Turn;
    }

    /// <summary>An expression eval error: never a silent pass (schema 3.1),
    /// always a visible diagnostic.</summary>
    public sealed class DiagnosticEvent : TraceEvent
    {
        public string Where;
        public string Message;
    }

    /// <summary>A retained log entry: the trace event plus its place in the
    /// flow's time. Seq orders the whole flow (monotonic; survives ClearLog). Turn is
    /// the clock of the box the event happened in when it fired. Diagnostics
    /// carry no turn.</summary>
    public sealed class LogEntry
    {
        public TraceEvent Event;
        public long Seq;
        public double? Turn;
    }

    /// <summary>One entry on the ENGINE's log: the same event, plus the flow it
    /// happened in. A run is several flows over shared state, so "what happened
    /// in this run" is only answerable in one ordered stream, and only if each
    /// line says who (design/shared-scarcity.md 8.2).</summary>
    public sealed class EngineLogEntry
    {
        public TraceEvent Event;
        public string Flow;
        public long Seq;
        public double? Turn;
    }

    // PropertyView is gone. It was PropertyRow plus a `Path`, and Patterplay had forked
    // the same row for the same reason in its own runtimes; `Path` moved onto the shared
    // PropertyRow on 2026-09-02, so there was nothing left to hold. ListProperties returns
    // the shared row itself - C# has no type alias to keep the old name alive with, and an
    // empty subclass would be a type a bag's own row could never satisfy.

    /// <summary>One kernel bag with its store path prefix (world / story /
    /// box.&lt;gameId&gt; / deck.&lt;gameId&gt; / hand.&lt;gameId&gt; /
    /// value.&lt;gameId&gt;): the state logger's
    /// mount surface (design/engine-runtimes.md 3.4 - the logger builds on
    /// the PropertyBag audit hook, so it needs the bags themselves, not just
    /// their rows). Load() replaces the flow's bags, so re-enumerate after
    /// a load.</summary>
    public sealed class BagMount
    {
        public string Prefix;
        public PropertyBag Bag;
    }

    /// <summary>One box on the enumeration surface (examiners, hosts):
    /// identity plus its clock.</summary>
    public sealed class BoxView
    {
        public string Id;
        public string GameId;
        /// <summary>Null when the box has no title.</summary>
        public string Title;
        public double Turn;
    }

    /// <summary>The world + flow manager (design/flows.md; the shape is
    /// Patter's): owns the bundle, every lookup built from it, the SHARED
    /// property partitions and the @world resolver; ALL play happens on a
    /// Flow handle from OpenFlow(id). There is no default flow and no ambient
    /// current flow; re-opening an id REPLACES it; closed handles are inert;
    /// GetProperty serves world.* and shared refs only, and a ref that
    /// resolves per-flow throws, naming the fix. Every property bag lives in
    /// the game's one ScopeRegistry (EngineOptions.Registry), or in the
    /// engine's own when it is standalone.</summary>
    public sealed class Engine
    {
        internal readonly Bundle _bundle;
        private readonly double _seed;
        private readonly Action<string, int> _onReplacedFlow;
        internal readonly int? _logCap;

        // Lookups (bundle is immutable; built once). Shared with every flow.
        internal readonly OrderedMap<string, CardEntry> _cardsById = new OrderedMap<string, CardEntry>();
        /// <summary>Does ANY deck or card in the bundle opt into shared
        /// scarcity? False for the overwhelming majority of projects, and when
        /// it is false the two claim-ledger walks in dealing are skipped
        /// entirely: a bundle that does not use a feature must not pay for
        /// it.</summary>
        internal bool _hasShared;
        internal readonly OrderedMap<string, CardEntry> _cardsByGameId = new OrderedMap<string, CardEntry>();
        internal readonly OrderedMap<string, Box> _boxesByGameId = new OrderedMap<string, Box>();
        internal readonly OrderedMap<string, Box> _boxesById = new OrderedMap<string, Box>();
        internal readonly OrderedMap<string, HandInBox> _handsById = new OrderedMap<string, HandInBox>();
        internal readonly OrderedMap<string, HandInBox> _handsByGameId = new OrderedMap<string, HandInBox>();
        internal readonly OrderedMap<string, HandTemplate> _templatesById = new OrderedMap<string, HandTemplate>();
        internal readonly OrderedMap<string, (TagGroup Group, Box Box)> _groupsById = new OrderedMap<string, (TagGroup, Box)>();
        internal readonly HashSet<string> requiredGroups = new HashSet<string>();

        /// <summary>The owner segment of a property address, both ways round,
        /// for the four OWNED scopes: the ones whose address carries an owner
        /// segment (design/engine-server.md 4.4). "story" has no owner and
        /// "world" is the host's.</summary>
        private readonly OwnerIndex _boxOwners = new OwnerIndex();
        private readonly OwnerIndex _deckOwners = new OwnerIndex();
        private readonly OwnerIndex _handOwners = new OwnerIndex();
        private readonly OwnerIndex _valueOwners = new OwnerIndex();

        /// <summary>The four owned scopes, in the order every walk over them
        /// takes.</summary>
        internal static readonly string[] OwnedScopes = { "box", "deck", "hand", "value" };

        private OwnerIndex Owners(string kind)
        {
            switch (kind)
            {
                case "box": return _boxOwners;
                case "deck": return _deckOwners;
                case "hand": return _handOwners;
                default: return _valueOwners;
            }
        }

        /// <summary>One owned property owner's ADDRESS, owner segment and all:
        /// "box.village". The stores, the save envelope and the ladders stay
        /// keyed by internal id - a save must survive a rename, which is the
        /// whole reason ids exist - so this is the one place the two
        /// vocabularies meet, and it is a formatter, never a lookup key. An
        /// owner the build no longer has (a save that outlived an edit) keeps
        /// the id it arrived with: there is no gameId left to give it, which is
        /// the rule a load report's evictions have always used.</summary>
        internal string AddressOf(string kind, string id)
        {
            return Owners(kind).GameId.TryGetValue(id, out var gameId) ? $"{kind}.{gameId}" : $"{kind}.{id}";
        }

        /// <summary>Resolve a property address's owner segment to the internal
        /// id the stores are keyed by. `legacy` says the caller used the pre-4.4
        /// form - an internal id where a gameId belongs - which resolves for
        /// THIS release and earns a diagnostic; the next lockstep release
        /// refuses it, in every scope including "value". False when the segment
        /// names no owner at all, which is the caller's "no &lt;kind&gt; store"
        /// error, and false too for an ambiguous short form, which is
        /// deliberately not in the Id map: see OwnerOrThrow.</summary>
        internal bool TryResolveOwner(string kind, string segment, out string id, out bool legacy)
        {
            var owners = Owners(kind);
            if (owners.Id.TryGetValue(segment, out id)) { legacy = false; return true; }
            // A gameId that equals its id took the branch above, so anything
            // reaching here and known as an id is genuinely the old spelling.
            if (owners.GameId.ContainsKey(segment)) { id = segment; legacy = true; return true; }
            id = null;
            legacy = false;
            return false;
        }

        /// <summary>Resolve or refuse: the two refusals every property address
        /// shares, in one place, so the engine's own surface and a flow's
        /// answer with the same words.</summary>
        internal string OwnerOrThrow(string kind, string segment, string name, out bool legacy)
        {
            List<string> candidates;
            if (Owners(kind).Repeated.TryGetValue(segment, out candidates))
            {
                throw new StoryletError(AmbiguousAddressMessage(segment, name, candidates));
            }
            string id;
            if (!TryResolveOwner(kind, segment, out id, out legacy))
            {
                throw new StoryletError($"no {kind} store \"{segment}\"");
            }
            return id;
        }

        /// <summary>What an ambiguous short-form value address is told: the
        /// candidates, in full, because "that names two tags" without them
        /// leaves a host reading a bundle it did not write to find out which
        /// boxes.</summary>
        internal string AmbiguousAddressMessage(string segment, string name, List<string> candidates)
        {
            var forms = new List<string>();
            foreach (var q in candidates) forms.Add($"\"value.{q}.{name}\"");
            var list = forms.Count <= 1
                ? (forms.Count == 1 ? forms[0] : "")
                : string.Join(", ", forms.GetRange(0, forms.Count - 1).ToArray()) + " or " + forms[forms.Count - 1];
            return $"\"value.{segment}.{name}\" names a tag in {candidates.Count} boxes; write {list}";
        }

        /// <summary>The value scope's index, whole: the segment each tag
        /// PRINTS, every segment an address ACCEPTS, and the gameIds that need
        /// qualifying.
        ///
        /// Every other owned scope names its owner with a gameId that is unique
        /// across the bundle. A TAG's is unique only within its group, and a
        /// group's only within its box, so two boxes may each name a tag
        /// "docks" - as ordinary as two boxes each having a "zone" group - and
        /// "value.docks.danger" then names two stores. The address is
        /// "value.&lt;boxGameId&gt;/&lt;tagGameId&gt;.&lt;name&gt;" wherever that
        /// happens, with the slash INSIDE the owner segment so the address
        /// still splits into three on the dot. The qualified form is always
        /// accepted; the short form is accepted while one tag carries the
        /// gameId and refused when more do. Built from the whole bundle rather
        /// than tag by tag, because whether a tag's own gameId is enough is a
        /// question about the OTHER boxes.</summary>
        private void IndexValueOwners(Bundle bundle)
        {
            var ids = new List<string>();
            var gameIds = new List<string>();
            var qualified = new List<string>();
            foreach (var box in bundle.Boxes)
            {
                var boxGameId = Model.EffectiveGameId(box);
                foreach (var group in box.TagGroups)
                {
                    foreach (var tag in group.Tags)
                    {
                        var gameId = Model.EffectiveGameId(tag);
                        ids.Add(tag.Id);
                        gameIds.Add(gameId);
                        qualified.Add(boxGameId + "/" + gameId);
                    }
                }
            }
            // Distinct qualified forms per gameId. Distinct rather than a
            // count: two groups in ONE box may also name a tag the same way,
            // and a refusal that offered the same address twice would be no
            // help at all. That last case is closing at the source rather than
            // here (question 16, ruled 2026-09-06): the compiler warns that a
            // tag gameId must be unique within its box, across all of that
            // box's groups, and refuses it from the next release. Until then
            // the first in bundle order answers, as it always did.
            var forms = new Dictionary<string, List<string>>();
            for (var i = 0; i < ids.Count; i++)
            {
                List<string> list;
                if (!forms.TryGetValue(gameIds[i], out list))
                {
                    list = new List<string>();
                    forms[gameIds[i]] = list;
                }
                if (!list.Contains(qualified[i])) list.Add(qualified[i]);
            }
            for (var i = 0; i < ids.Count; i++)
            {
                var candidates = forms[gameIds[i]];
                var ambiguous = candidates.Count > 1;
                _valueOwners.GameId[ids[i]] = ambiguous ? qualified[i] : gameIds[i];
                if (!_valueOwners.Id.ContainsKey(qualified[i])) _valueOwners.Id[qualified[i]] = ids[i];
                if (!ambiguous && !_valueOwners.Id.ContainsKey(gameIds[i])) _valueOwners.Id[gameIds[i]] = ids[i];
                if (ambiguous) _valueOwners.Repeated[gameIds[i]] = candidates;
            }
        }

        /// <summary>What a legacy address is told. It NAMES the address to move
        /// to, because "that form is deprecated" without the replacement leaves
        /// a host grepping a bundle for ids it never chose.</summary>
        internal string LegacyAddressMessage(string kind, string segment, string name)
        {
            return $"\"{kind}.{segment}.{name}\" names the {kind} by its internal id; "
                + $"write \"{AddressOf(kind, segment)}.{name}\". "
                + "The internal-id form is refused after the next release.";
        }

        // Quality ladders (quality.md), declaration-level so partition-blind.
        internal readonly Dictionary<string, List<string>> _worldLadders = new Dictionary<string, List<string>>();
        internal readonly Dictionary<string, List<string>> _storyLadders = new Dictionary<string, List<string>>();
        internal readonly Dictionary<string, Dictionary<string, List<string>>> _boxLadders = new Dictionary<string, Dictionary<string, List<string>>>();
        internal readonly Dictionary<string, Dictionary<string, List<string>>> _deckLadders = new Dictionary<string, Dictionary<string, List<string>>>();
        internal readonly Dictionary<string, Dictionary<string, List<string>>> _valueLadders = new Dictionary<string, Dictionary<string, List<string>>>();
        internal readonly Dictionary<string, Dictionary<string, List<string>>> _handLadders = new Dictionary<string, Dictionary<string, List<string>>>();
        internal bool _hasQualities;

        /// <summary>The per-flow halves of every declaration list, precomputed
        /// once: each OpenFlow builds its bags from these.</summary>
        private readonly DeclSet _flowDecls = new DeclSet();
        /// <summary>The shared halves, the same way. Not used to build anything -
        /// the shared bags are built straight from the bundle - but a load report
        /// has to say what the shared side WOULD hold without building a bag,
        /// which is what makes PreviewLoad pure.</summary>
        private readonly DeclSet _sharedDecls = new DeclSet();

        /// <summary>The shared stores, registered in the registry for the
        /// engine's life. Reseeded in place by Reset and by a load that carries
        /// values.</summary>
        internal Partition _shared;
        // @world: the host's resolver (it outlives Reset/LoadGame - the
        // container is the host's), a scope the game registered, or a
        // self-backed scope in the engine's own registry. Read and written
        // through the registry in every case.
        private readonly IScopeResolver _hostWorld;
        /// <summary>True when the engine self-backed @world (standalone, no
        /// resolver bound).</summary>
        private bool _selfWorld;
        internal IScopeSource WorldScope;

        /// <summary>The owner label on everything this engine registers: named
        /// in a clash error and carried on the registry's examiner rows.</summary>
        internal const string OwnerLabel = "Storylet Engine";

        /// <summary>Identity: storylets property names are case-significant as
        /// authored.</summary>
        private static readonly Func<string, string> Identity = n => n;

        /// <summary>The game's one registry (or the engine's own, when it is
        /// standalone).</summary>
        internal readonly ScopeRegistry _registry;
        /// <summary>True when the engine made the registry: SaveGame() then
        /// carries its values.</summary>
        private readonly bool _ownsRegistry;

        // --- registry keys ------------------------------------------------------
        //
        // The keys this engine's bags live under. An id is escaped (`%` and `/`)
        // so no two keys can meet. Every runtime writes the same keys: they are
        // in the save. Owners are keyed by INTERNAL id, as the save always was,
        // so a save survives a rename.

        internal static string Esc(string id) => id.Replace("%", "%25").Replace("/", "%2F");
        internal static string Unesc(string id) => id.Replace("%2F", "/").Replace("%25", "%");
        internal static string SharedKey(string kind, string id) => $"storylets/{kind}/{Esc(id)}";
        internal static string FlowPrefix(string flowId) => $"storylets/flow/{Esc(flowId)}/";
        internal static string FlowKey(string flowId, string kind, string id = null)
        {
            return kind == "story" ? FlowPrefix(flowId) + "story" : $"{FlowPrefix(flowId)}{kind}/{Esc(id)}";
        }

        /// <summary>Every OTHER scope in the registry, as an eval context sees it
        /// (instance keys left out), and the registry's quality channel. Rebuilt
        /// only when the registry's set of scopes moves (its Revision): the
        /// values the sources read stay live.</summary>
        internal sealed class RegistryScopes
        {
            public readonly Dictionary<string, IScopeSource> Scopes = new Dictionary<string, IScopeSource>();
            public Func<string, string, List<string>> Qualities;
        }

        private int _viewRevision = -1;
        private RegistryScopes _view = new RegistryScopes();

        internal RegistryScopes RegistryView()
        {
            if (_registry.Revision != _viewRevision)
            {
                var ctx = _registry.ToEvalContext();
                var view = new RegistryScopes { Qualities = ctx.Qualities };
                // An instance key (`storylets/deck/x`, another engine's) is no
                // expression token.
                foreach (var pair in ctx.Scopes)
                {
                    if (!pair.Key.Contains("/")) view.Scopes[pair.Key] = pair.Value;
                }
                _view = view;
                _viewRevision = _registry.Revision;
            }
            return _view;
        }

        /// <summary>The options this engine was built with: HotSwap builds its
        /// replacement from them.</summary>
        private readonly EngineOptions _creationOptions;

        /// <summary>How to register one shared scope again.</summary>
        private sealed class SharedMount
        {
            public string Key;
            public Action Mount;
        }

        /// <summary>Every shared scope this engine registered, in registration
        /// order, and how: a failed HotSwap puts this engine back exactly as it
        /// was.</summary>
        private readonly List<SharedMount> _sharedMounts = new List<SharedMount>();

        private readonly OrderedMap<string, Flow> _flows = new OrderedMap<string, Flow>();
        private readonly List<Action<string, TraceEvent>> _engineTraceHandlers = new List<Action<string, TraceEvent>>();

        /// <summary>The sharing default per scope (design/flows.md): @story
        /// shared, the narrower geographic scopes per-flow. A declaration's
        /// Shared flag overrides.</summary>
        internal static bool IsShared(string scope, PropertyDecl d)
        {
            if (d.Shared != null) return d.Shared.Value;
            return scope == "story";
        }

        private static List<PropertyDecl> Half(string scope, List<PropertyDecl> decls, bool shared)
        {
            var outList = new List<PropertyDecl>();
            if (decls != null)
            {
                foreach (var d in decls) if (IsShared(scope, d) == shared) outList.Add(d);
            }
            return outList;
        }

        // pathPrefix carries its own separator, so a bag composes its rows' addresses itself
        // ("story.gold", "deck.tavern.drawn") instead of every caller pasting a prefix on.
        private static PropertyBag BagFromDecls(IEnumerable<PropertyDecl> decls, string pathPrefix)
        {
            return new PropertyBag(decls, n => n, pathPrefix);
        }

        /// <summary>@world as an expression reads it: through the registry, by
        /// the names as authored.</summary>
        private sealed class WorldSource : IScopeSource
        {
            public Engine Owner;
            public ExprValue Get(string name) => Owner.WorldGet(name);
        }

        public Engine(Bundle bundle, EngineOptions opts = null)
        {
            opts = opts ?? new EngineOptions();
            _creationOptions = opts.Copy();
            _bundle = bundle;
            _seed = opts.Seed;
            _onReplacedFlow = opts.OnReplacedFlow;
            if (opts.Log) _logCap = opts.LogCap;
            _hostWorld = opts.World;
            _registry = opts.Registry ?? new ScopeRegistry();
            _ownsRegistry = opts.Registry == null;
            // The value scope's segments come off the whole bundle at once (a
            // tag gameId is only unique within its group), so they are built
            // before the walk rather than tag by tag inside it.
            IndexValueOwners(bundle);
            foreach (var box in bundle.Boxes)
            {
                _boxesById.Set(box.Id, box);
                _boxesByGameId.Set(Model.EffectiveGameId(box), box);
                _boxOwners.Add(box.Id, Model.EffectiveGameId(box));
                foreach (var group in box.TagGroups)
                {
                    _groupsById.Set(group.Id, (group, box));
                    if (group.Required) requiredGroups.Add(group.Id);
                }
                foreach (var deck in box.Decks)
                {
                    _deckOwners.Add(deck.Id, Model.EffectiveGameId(deck));
                    if (deck.Shared == true) _hasShared = true;
                    foreach (var card in deck.Cards)
                    {
                        var entry = new CardEntry { Card = card, Deck = deck, Box = box };
                        _cardsById.Set(card.Id, entry);
                        _cardsByGameId.Set(Model.EffectiveGameId(card), entry);
                        if (card.Shared == true) _hasShared = true;
                    }
                }
                foreach (var template in box.HandTemplates) _templatesById.Set(template.Id, template);
                foreach (var hand in box.Hands)
                {
                    var entry = new HandInBox { Hand = hand, Box = box };
                    _handsById.Set(hand.Id, entry);
                    _handsByGameId.Set(Model.EffectiveGameId(hand), entry);
                    _handOwners.Add(hand.Id, Model.EffectiveGameId(hand));
                }
            }
            InitLadders();
            // Both halves, precomputed once (a bundle's declarations never
            // change): each OpenFlow builds its bags from the per-flow half, and
            // a load report asks either half what it declares without building
            // anything at all.
            _flowDecls.Story = Half("story", bundle.Story.Properties, false);
            _sharedDecls.Story = Half("story", bundle.Story.Properties, true);
            foreach (var box in bundle.Boxes)
            {
                _flowDecls.Box.Set(box.Id, Half("box", box.Properties, false));
                _sharedDecls.Box.Set(box.Id, Half("box", box.Properties, true));
                foreach (var deck in box.Decks)
                {
                    _flowDecls.Deck.Set(deck.Id, Half("deck", deck.Properties, false));
                    _sharedDecls.Deck.Set(deck.Id, Half("deck", deck.Properties, true));
                }
                foreach (var hand in box.Hands)
                {
                    _flowDecls.Hand.Set(hand.Id, Half("hand", HandDecls(hand), false));
                    _sharedDecls.Hand.Set(hand.Id, Half("hand", HandDecls(hand), true));
                }
                foreach (var group in box.TagGroups)
                {
                    foreach (var tag in group.Tags)
                    {
                        _flowDecls.Value.Set(tag.Id, Half("value", tag.Properties ?? new List<PropertyDecl>(), false));
                        _sharedDecls.Value.Set(tag.Id, Half("value", tag.Properties ?? new List<PropertyDecl>(), true));
                    }
                }
            }
            WorldScope = new WorldSource { Owner = this };
            InitShared();
        }

        internal List<PropertyDecl> HandDecls(Hand hand)
        {
            if (hand.Template != null)
            {
                var known = _templatesById.GetOrDefault(hand.Template);
                if (known != null) return known.Properties ?? new List<PropertyDecl>();
                foreach (var box in _bundle.Boxes)
                    foreach (var t in box.HandTemplates)
                        if (t.Id == hand.Template) return t.Properties ?? new List<PropertyDecl>();
                return new List<PropertyDecl>();
            }
            return hand.Properties ?? new List<PropertyDecl>();
        }

        /// <summary>Build the shared stores and register them and @world. Once,
        /// for the engine's life: Reset and loads reseed the bags in place, so
        /// the registry never sees them come and go. The bags are KEYED by
        /// internal id and ADDRESSED by gameId; see AddressOf.</summary>
        private void InitShared()
        {
            var shared = new Partition { Story = BagFromDecls(_sharedDecls.Story, "story.") };
            string At(string kind, string id) => AddressOf(kind, id) + ".";
            foreach (var pair in _sharedDecls.Box) shared.Box.Set(pair.Key, BagFromDecls(pair.Value, At("box", pair.Key)));
            foreach (var pair in _sharedDecls.Deck) shared.Deck.Set(pair.Key, BagFromDecls(pair.Value, At("deck", pair.Key)));
            foreach (var pair in _sharedDecls.Hand) shared.Hand.Set(pair.Key, BagFromDecls(pair.Value, At("hand", pair.Key)));
            foreach (var pair in _sharedDecls.Value) shared.Value.Set(pair.Key, BagFromDecls(pair.Value, At("value", pair.Key)));
            _shared = shared;

            var reg = _registry;
            var registered = new List<string>();
            // Register now, and remember how, so a failed HotSwap can register again.
            void Mount(string key, Action register)
            {
                register();
                registered.Add(key);
                _sharedMounts.Add(new SharedMount { Key = key, Mount = register });
            }
            try
            {
                // `story` is this engine's token whether or not the bundle
                // declares a shared @story property: registering it is what
                // makes a clash show at once. Claims values the game loaded
                // first.
                Mount("story", () => reg.MountOwned("story", shared.Story, OwnerLabel));
                foreach (var kind in OwnedScopes)
                {
                    foreach (var pair in KindOf(shared, kind))
                    {
                        if (pair.Value.Declarations().Count == 0) continue; // holds nothing: not registered
                        var key = SharedKey(kind, pair.Key);
                        var bag = pair.Value;
                        Mount(key, () => reg.MountOwned(key, bag, OwnerLabel));
                    }
                }
                if (_hostWorld != null)
                {
                    // The game keeps these values: an external scope, never saved.
                    var world = _hostWorld;
                    var decls = _bundle.World.Properties;
                    Mount("world", () => reg.DefineForeign("world", world, decls,
                        new ForeignScopeOptions { Normalise = Identity, Owner = OwnerLabel }));
                }
                else if (_ownsRegistry && !reg.Has("world"))
                {
                    // Standalone: self-backed from the declared defaults,
                    // DECLARATIONS AND ALL, as a property the registry stores and
                    // SAVES (only a resolver the game binds is external). The bag
                    // keeps Writable == false so an examiner still reads it there,
                    // and the kernel lets a host write past it, which is what the
                    // game's own surface passes.
                    reg.DefineOwned("world", _bundle.World.Properties,
                        new OwnedScopeOptions { Normalise = Identity, PathPrefix = "world.", Owner = OwnerLabel });
                    var worldBag = reg.OwnedBag("world");
                    registered.Add("world");
                    _sharedMounts.Add(new SharedMount { Key = "world", Mount = () => reg.MountOwned("world", worldBag, OwnerLabel) });
                    _selfWorld = true;
                }
                // Given the game's registry and no resolver, @world is the game's
                // to register: this engine registers nothing for it.
            }
            catch (Exception e)
            {
                // A clash leaves the game's registry as it was.
                foreach (var key in registered) reg.Remove(key, keep: true);
                if (KernelErrors.Is(e)) throw KernelErrors.As(e);
                throw;
            }
        }

        /// <summary>Every shared bag back to its declared defaults, in place (the
        /// registry keeps them registered), the self-backed @world
        /// included.</summary>
        private void ReseedShared()
        {
            _shared.Story.Reseed(_sharedDecls.Story);
            foreach (var kind in OwnedScopes)
            {
                var decls = _sharedDecls.Kind(kind);
                foreach (var pair in KindOf(_shared, kind))
                {
                    pair.Value.Reseed(decls.GetOrDefault(pair.Key) ?? new List<PropertyDecl>());
                }
            }
            if (_selfWorld) _registry.ReseedOwned("world", _bundle.World.Properties ?? new List<PropertyDecl>());
        }

        private void InitLadders()
        {
            Dictionary<string, List<string>> Grab(List<PropertyDecl> decls)
            {
                var m = new Dictionary<string, List<string>>();
                if (decls != null)
                {
                    foreach (var d in decls)
                    {
                        if (d.Type == PropertyTypes.Quality && d.Stages != null) m[d.Name] = d.Stages;
                    }
                }
                if (m.Count > 0) _hasQualities = true;
                return m;
            }
            foreach (var pair in Grab(_bundle.World.Properties)) _worldLadders[pair.Key] = pair.Value;
            foreach (var pair in Grab(_bundle.Story.Properties)) _storyLadders[pair.Key] = pair.Value;
            foreach (var box in _bundle.Boxes)
            {
                _boxLadders[box.Id] = Grab(box.Properties);
                foreach (var deck in box.Decks) _deckLadders[deck.Id] = Grab(deck.Properties);
                foreach (var group in box.TagGroups)
                {
                    foreach (var tag in group.Tags) _valueLadders[tag.Id] = Grab(tag.Properties);
                }
                foreach (var hand in box.Hands) _handLadders[hand.Id] = Grab(HandDecls(hand));
            }
        }

        internal Partition BuildFlowPartition()
        {
            var p = new Partition { Story = BagFromDecls(_flowDecls.Story, "story.") };
            foreach (var pair in _flowDecls.Box) p.Box.Set(pair.Key, BagFromDecls(pair.Value, AddressOf("box", pair.Key) + "."));
            foreach (var pair in _flowDecls.Deck) p.Deck.Set(pair.Key, BagFromDecls(pair.Value, AddressOf("deck", pair.Key) + "."));
            foreach (var pair in _flowDecls.Hand) p.Hand.Set(pair.Key, BagFromDecls(pair.Value, AddressOf("hand", pair.Key) + "."));
            foreach (var pair in _flowDecls.Value) p.Value.Set(pair.Key, BagFromDecls(pair.Value, AddressOf("value", pair.Key) + "."));
            return p;
        }

        // --- the @world seam ---------------------------------------------------

        /// <summary>@world, read through the registry by name (the scope's own
        /// normalisation), so a @world the game registered folded to lower case
        /// still answers the names as authored. Null when nothing answers,
        /// including a game's registry with no @world registered.</summary>
        internal ExprValue WorldGet(string name)
        {
            return _registry.Get("world", name);
        }

        /// <summary>The story's promise about a @world value (Writable == false on its
        /// declaration), kept at runtime as the compiler keeps it at publish. Asked by a
        /// flow's outcome write; the host's own SetProperty never asks.</summary>
        internal bool WorldReadOnly(string name)
        {
            if (_bundle.World.Properties == null) return false;
            foreach (var d in _bundle.World.Properties) if (d.Name == name) return d.Writable == false;
            return false;
        }

        internal bool WorldCanSet => _hostWorld != null ? _hostWorld.CanSet : true;

        /// <summary>The @world WRITE seam, through the registry. host: true says the
        /// caller is the GAME's own surface - SetProperty and the tooling built on
        /// it - which the shared kernel lets past a Writable == false (scoperegistry
        /// 0.6.0): that flag is the story's promise, not the game's. The story's
        /// refusal is WorldReadOnly, asked before this seam is reached. A BOUND
        /// resolver is opaque - it takes a name and a value and keeps whatever rule
        /// the game has - so a write to it always passes host, and the flag only
        /// ever matters to a stored @world (self-backed, or the game's own).</summary>
        internal void WorldSet(string name, ExprValue value, bool host = false)
        {
            try { _registry.Set("world", name, value, host: _hostWorld != null || host); }
            catch (Exception e) when (KernelErrors.Is(e)) { throw KernelErrors.As(e); }
        }

        // --- flow management (Patter's surface, name for name) ------------------

        /// <summary>Open (or REPLACE) the named flow. An existing id's flow is
        /// closed first - re-opening a name is a reset of that name's whole
        /// per-flow state; shared state is untouched. There is no default flow:
        /// "main" is a caller convention, not an engine rule.</summary>
        public Flow OpenFlow(string id, OpenFlowOptions opts = null)
        {
            return Open(id, opts ?? new OpenFlowOptions(), false);
        }

        /// <summary>OpenFlow, and LoadGame's rebuild. `claim` says the new flow's
        /// bags take the values the registry holds for them (a load); a fresh
        /// open is a reset of that name, so anything waiting for it is discarded
        /// first.</summary>
        private Flow Open(string id, OpenFlowOptions opts, bool claim)
        {
            AssertExternalScopes();
            // The world's claims as they stand WITHOUT this name, taken before
            // the replace: a resume competes with the other flows, never with
            // the flow it is replacing (which is about to release everything).
            var otherClaims = opts.Restore != null ? SharedClaimsExcept(id) : null;
            var existing = _flows.GetOrDefault(id);
            if (existing != null)
            {
                // Say so BEFORE the old flow goes inert, while its board is readable.
                int dealt = 0;
                foreach (var _ in existing.HeldCardIds()) dealt++;
                if (dealt > 0) _onReplacedFlow?.Invoke(id, dealt);
                existing.MarkClosed();
            }
            if (!claim) _registry.DiscardParked(FlowPrefix(id));
            var flow = new Flow(this, id, opts.Seed ?? _seed);
            _flows.Set(id, flow);
            if (opts.Restore != null)
            {
                var draft = new ReportDraft();
                var clean = PlanFlowRestore(id, opts.Restore, otherClaims, draft);
                flow.Restore(clean);
                if (opts.OnRestoreReport != null)
                {
                    opts.OnRestoreReport(FinishReport(_bundle.Content, _bundle.Content, new List<string> { id }, draft));
                }
            }
            return flow;
        }

        public Flow GetFlow(string id)
        {
            return _flows.GetOrDefault(id);
        }

        /// <summary>Every live flow, open order.</summary>
        public List<Flow> Flows()
        {
            var outList = new List<Flow>();
            foreach (var pair in _flows) outList.Add(pair.Value);
            return outList;
        }

        /// <summary>Close the named flow: its handle goes INERT (every verb
        /// throws). A dropped-but-held flow must not keep writing shared state
        /// (Patter's stale-handle lesson). Unknown ids are a quiet no-op.</summary>
        public void CloseFlow(string id)
        {
            var flow = _flows.GetOrDefault(id);
            if (flow == null) return;
            _flows.Remove(id);
            flow.MarkClosed();
        }

        internal void DropFlow(string id, Flow flow)
        {
            if (_flows.GetOrDefault(id) == flow) _flows.Remove(id);
        }

        /// <summary>Close every flow and reseed the shared state to its defaults
        /// (the self-backed @world included; a host-bound @world is the host's
        /// and is not touched, and so is one the game registered).</summary>
        public void Reset()
        {
            DropRun(null);
            ReseedShared();
            // Values loaded for bags nobody has claimed yet are the old run's
            // too: a flow opened after the reset must not pick them up. Other
            // engines' stay.
            _registry.DiscardParked("storylets/");
        }

        /// <summary>End the run: clear the log, close every flow, forget spent
        /// cards. Each flow's bags leave the registry; `keepFlows` names the
        /// flows whose values are kept there for the flow that replaces them (a
        /// load into the game's registry).</summary>
        private void DropRun(HashSet<string> keepFlows)
        {
            // The log is a run-lifetime utility and is not saved; a reset is a
            // new run.
            _engineLog.Clear();
            foreach (var pair in _flows)
            {
                pair.Value.ReleaseBags(keepFlows != null && keepFlows.Contains(pair.Key));
                pair.Value.MarkClosed();
            }
            _flows.Clear();
            _spent.Clear();
        }

        // --- shared scarcity (design/shared-scarcity.md) --------------------------

        /// <summary>Cards a shared redraw:never has taken out of the world, by
        /// card id. The claim ledger is DERIVED from live boards and needs no
        /// storage; this one is durable, so it rides the save.</summary>
        private readonly HashSet<string> _spent = new HashSet<string>();

        // --- the run's log (design/shared-scarcity.md 8.2) ------------------------

        /// <summary>Every flow's events in one ordered stream, each tagged with
        /// its flow. Opt in with the same Log option the flow logs use; capped
        /// the same way.
        ///
        /// This exists because a flow's own log cannot answer the question a run
        /// raises: when a story action in ANOTHER flow moves shared state, your
        /// flow's log says nothing and your value simply changes.</summary>
        private List<EngineLogEntry> _engineLog = new List<EngineLogEntry>();
        private int _engineSeq;

        public IReadOnlyList<EngineLogEntry> Log() { return _engineLog; }

        public void ClearLog() { _engineLog.Clear(); }

        internal bool IsTaken(string cardId) { return _spent.Contains(cardId); }

        internal void MarkTaken(string cardId) { _spent.Add(cardId); }

        private List<string> SpentIds()
        {
            var ids = new List<string>(_spent);
            ids.Sort(StringComparer.Ordinal);
            return ids;
        }

        /// <summary>Shared claims across every LIVE flow, card id -> holders.
        /// Derived, which is what makes CloseFlow and the OpenFlow replace
        /// release what a flow was holding: its board leaves the map with
        /// it.</summary>
        internal Dictionary<string, int> SharedClaims()
        {
            var counts = new Dictionary<string, int>();
            foreach (var pair in _flows)
            {
                foreach (var id in pair.Value.HeldCardIds())
                {
                    counts.TryGetValue(id, out var n);
                    counts[id] = n + 1;
                }
            }
            return counts;
        }

        /// <summary>The same ledger with one name left out: what the REST of the
        /// world holds, which is the question a resume under that name has to
        /// ask.</summary>
        private Dictionary<string, int> SharedClaimsExcept(string id)
        {
            var counts = new Dictionary<string, int>();
            foreach (var pair in _flows)
            {
                if (pair.Key == id) continue;
                foreach (var cardId in pair.Value.HeldCardIds())
                {
                    counts.TryGetValue(cardId, out var n);
                    counts[cardId] = n + 1;
                }
            }
            return counts;
        }

        // --- engine-level state access -------------------------------------------

        /// <summary>Read shared state by path: "world.x", "story.gold" (when
        /// shared), "box.village.heat" (when shared) - the owner segment is its
        /// GAMEID (design/engine-server.md 4.4). A ref that resolves PER-FLOW
        /// throws, naming the fix (Patter's teaching rule).</summary>
        public ExprValue GetProperty(string path)
        {
            var parts = path.Split('.');
            if (parts.Length == 2 && parts[0] == "world")
            {
                var wv = WorldGet(parts[1]);
                if (wv == null) throw new StoryletError($"no property at \"{path}\"");
                return wv;
            }
            // Another engine's game-wide scope (`patter.gold`): every engine
            // reads every scope.
            if (IsOtherScope(parts))
            {
                var ov = _registry.Get(parts[0], parts[1]);
                if (ov == null) throw new StoryletError($"no property at \"{path}\"");
                return ov;
            }
            if (parts.Length == 2 && parts[0] == "story")
            {
                var sv = _shared.Story.Get(parts[1]);
                if (sv != null) return sv;
                foreach (var d in _flowDecls.Story)
                {
                    if (d.Name == parts[1]) throw new StoryletError($"\"{path}\" is per-flow state - read it on a Flow, not the Engine");
                }
                throw new StoryletError($"no property at \"{path}\"");
            }
            if (parts.Length == 3 && (parts[0] == "box" || parts[0] == "deck" || parts[0] == "hand" || parts[0] == "value"))
            {
                var kind = parts[0];
                var segment = parts[1];
                var name = parts[2];
                var id = OwnerOrThrow(kind, segment, name, out var legacy);
                if (legacy) Diagnose(LegacyAddressMessage(kind, segment, name));
                var sharedKind = KindOf(_shared, kind);
                var flowDecls = FlowDeclsOf(kind);
                var bag = sharedKind.GetOrDefault(id);
                if (bag != null)
                {
                    var v = bag.Get(name);
                    if (v != null) return v;
                }
                var decls = flowDecls.GetOrDefault(id);
                if (decls != null)
                {
                    foreach (var d in decls)
                    {
                        if (d.Name == name) throw new StoryletError($"\"{path}\" is per-flow state - read it on a Flow, not the Engine");
                    }
                }
                if (bag == null && decls == null) throw new StoryletError($"no {kind} store \"{segment}\"");
                throw new StoryletError($"no property at \"{path}\"");
            }
            throw new StoryletError($"bad property path \"{path}\"");
        }

        /// <summary>Other engines' scopes the content names (Bundle.ExternalScopes),
        /// in listed order: the first one the registry does not hold refuses the
        /// open or the load, before anything changes. Content that names another
        /// engine's scope needs that engine on this registry; without it every
        /// read of the scope would answer false and every write would fail, so
        /// the engine says so where the game starts playing, not partway through
        /// a run.</summary>
        private void AssertExternalScopes()
        {
            if (_bundle.ExternalScopes == null) return;
            foreach (var token in _bundle.ExternalScopes)
            {
                if (!_registry.Has(token))
                    throw new StoryletError($"this content names @{token}, which no engine on this registry registered: "
                        + "give every engine the game's one registry");
            }
        }

        /// <summary>The engine's own surface has no flow, so an engine-level
        /// diagnostic carries the EMPTY flow id - the same way a LoadReport's
        /// shared half carries no flow. It reaches the run log and the engine
        /// tap; there is nowhere else for it to go, and it fires only on a
        /// legacy address.</summary>
        private void Diagnose(string message)
        {
            EmitEngine("", new DiagnosticEvent { Where = "property address", Message = message }, null);
        }

        public void SetProperty(string path, ExprValue value)
        {
            var parts = path.Split('.');
            if (parts.Length == 2 && parts[0] == "world")
            {
                if (!WorldCanSet) throw new StoryletError("@world is read-only here: the host bound no write");
                WorldSet(parts[1], value, host: true);
                return;
            }
            if (IsOtherScope(parts))
            {
                try { _registry.Set(parts[0], parts[1], value, host: true); }
                catch (Exception e) when (KernelErrors.Is(e)) { throw KernelErrors.As(e); }
                return;
            }
            // Reuse the read-side routing: a per-flow or unknown ref throws the
            // same message before anything is written, and a legacy address says
            // so exactly once - the read did the diagnosing, so this second
            // resolve is silent.
            GetProperty(path);
            PropertyBag bag;
            if (parts.Length == 2)
            {
                bag = _shared.Story;
            }
            else
            {
                TryResolveOwner(parts[0], parts[1], out var id, out _);
                bag = KindOf(_shared, parts[0]).GetOrDefault(id);
            }
            // A HOST write, in any scope: silent under the firing rule, visible to the
            // audit hook, and never refused by a Writable == false - that flag is the
            // story's promise about its own outcomes, and this is the game speaking.
            bag.Set(parts[parts.Length - 1], value, silent: true, reason: "host setProperty", host: true);
        }

        /// <summary>A two-part path whose token is a scope another engine (or the
        /// game) registered: `patter.gold`. @world and @story are this engine's
        /// own and route as they always did.</summary>
        internal bool IsOtherScope(string[] parts)
        {
            return parts.Length == 2 && parts[0] != "world" && parts[0] != "story" && _registry.Has(parts[0]);
        }

        internal static OrderedMap<string, PropertyBag> KindOf(Partition p, string kind)
        {
            switch (kind)
            {
                case "box": return p.Box;
                case "deck": return p.Deck;
                case "hand": return p.Hand;
                default: return p.Value;
            }
        }

        private OrderedMap<string, List<PropertyDecl>> FlowDeclsOf(string kind)
        {
            return _flowDecls.Kind(kind);
        }

        internal void AddWorldRows(List<PropertyRow> rows)
        {
            if (_bundle.World.Properties == null) return;
            foreach (var d in _bundle.World.Properties)
            {
                rows.Add(new PropertyRow
                {
                    Path = $"world.{d.Name}",
                    Name = d.Name,
                    Type = d.Type,
                    Value = WorldGet(d.Name) ?? d.Default,
                    Default = d.Default,
                    Values = d.Values,
                    Stages = d.Stages,
                    // Whether the resolver can be written at all AND what the
                    // declaration says, which is the kernel's own rule for a foreign
                    // scope. A row is where Writable == false is meant to SHOW: it
                    // tells a state panel this is the game's value, not the story's.
                    // It does not stop the panel editing it - SetProperty is a host
                    // write and passes.
                    Writable = WorldCanSet && !WorldReadOnly(d.Name),
                });
            }
        }

        /// <summary>The shared surface as examiner rows: @world (read through
        /// the resolver) then the shared partitions. Per-flow rows live on each
        /// Flow.</summary>
        public List<PropertyRow> ListProperties()
        {
            var rows = new List<PropertyRow>();
            AddWorldRows(rows);
            // The bag composes each row's address from its own PathPrefix, so this copies
            // nothing: the row arrives addressed. `prefix` stays as the caller's label for
            // the mount, which is what the state logger enumerates by.
            void Add(string prefix, PropertyBag bag)
            {
                foreach (var row in bag.Rows())
                {
                    rows.Add(row);
                }
            }
            Add("story", _shared.Story);
            foreach (var kind in OwnedScopes)
            {
                foreach (var pair in KindOf(_shared, kind)) Add(AddressOf(kind, pair.Key), pair.Value);
            }
            return rows;
        }

        /// <summary>The SHARED kernel bags with their store path prefixes (the
        /// state logger's mount surface). The @world container is the host's
        /// own bag - the host mounts it itself.</summary>
        public List<BagMount> ListBags()
        {
            var mounts = new List<BagMount> { new BagMount { Prefix = "story", Bag = _shared.Story } };
            foreach (var kind in OwnedScopes)
            {
                foreach (var pair in KindOf(_shared, kind))
                {
                    mounts.Add(new BagMount { Prefix = AddressOf(kind, pair.Key), Bag = pair.Value });
                }
            }
            return mounts;
        }

        /// <summary>Every flow's trace, one stream, each event tagged with its
        /// flow id - the tools' one stream. Returns the unsubscribe.</summary>
        public Action SubscribeTrace(Action<string, TraceEvent> handler)
        {
            _engineTraceHandlers.Add(handler);
            return () => _engineTraceHandlers.Remove(handler);
        }

        internal bool EngineTracing => _engineTraceHandlers.Count > 0;

        internal void EmitEngine(string flowId, TraceEvent evt, double? turn)
        {
            // Retain first, then notify: the run's log is the record,
            // subscribers are the live view, and a handler that reads Log()
            // should see its own event.
            if (_logCap.HasValue)
            {
                _engineLog.Add(new EngineLogEntry { Event = evt, Flow = flowId, Seq = _engineSeq++, Turn = turn });
                if (_engineLog.Count > _logCap.Value)
                {
                    _engineLog.RemoveRange(0, _engineLog.Count - _logCap.Value);
                }
            }
            foreach (var handler in _engineTraceHandlers.ToArray()) handler(flowId, evt);
        }

        // --- persistence (schema 4) ----------------------------------------------

        /// <summary>Live bundle refresh: rebuild on an edited bundle with the whole
        /// run carried over, and return the replacement with the report its load
        /// produced.
        ///
        /// Standalone, that is a save and a load into a new engine, and this one
        /// is left untouched (discard it). With the game's registry the two
        /// cannot both hold the same keys, so this engine is spent afterwards
        /// (its flows closed, the replacement holding everything on the same
        /// registry): it carries its own values into the snapshot, steps out of
        /// the registry, and the replacement loads them the way a standalone save
        /// loads, so the report covers the properties the edit dropped,
        /// defaulted, or retyped, and a dropped property is dropped rather than
        /// kept. Values the game loaded that were still waiting for a flow of
        /// this engine carry across as they were, and nothing belonging to any
        /// other engine is touched. A save for another project is refused before
        /// anything moves; if the rebuild fails for any other reason, this engine
        /// takes its registrations back and is left exactly as it was.
        ///
        /// The replacement is built with a copy of the options this engine was
        /// built with, which <paramref name="change"/> (when given) edits first,
        /// so only what it sets differs: <c>HotSwap(b, o => o.Log = true)</c>
        /// keeps the Seed, the World resolver, and the rest. Registry is
        /// ignored: the replacement is on this engine's registry, or its own
        /// when this engine made its own. Re-take every flow handle from the
        /// replacement.</summary>
        public HotSwapResult HotSwap(Bundle bundle, Action<EngineOptions> change = null)
        {
            if (bundle.Content.Project != _bundle.Content.Project)
            {
                throw new StoryletError(
                    $"save is for project \"{_bundle.Content.Project}\", bundle is \"{bundle.Content.Project}\"");
            }
            var options = _creationOptions.Copy();
            change?.Invoke(options);
            var snapshot = SaveGame();
            var reg = _registry;
            if (_ownsRegistry)
            {
                // Its own registry: a save and a load into a new engine, as it
                // always was, and this engine is left untouched.
                options.Registry = null;
                var fresh = new Engine(bundle, options);
                return new HotSwapResult { Engine = fresh, Report = fresh.LoadGame(snapshot) };
            }
            // This engine's own values, registered or still waiting for a flow.
            var mine = new OrderedMap<string, OrderedMap<string, ExprValue>>();
            foreach (var pair in reg.Save())
            {
                if (pair.Key == "story" || pair.Key.StartsWith("storylets/", StringComparison.Ordinal)) mine.Set(pair.Key, pair.Value);
            }
            var registeredKeys = new HashSet<string>(_sharedMounts.Select(m => m.Key));
            foreach (var pair in _flows) registeredKeys.UnionWith(pair.Value.RegisteredKeys());
            var waiting = new OrderedMap<string, OrderedMap<string, ExprValue>>();
            foreach (var pair in mine)
            {
                if (!registeredKeys.Contains(pair.Key)) waiting.Set(pair.Key, pair.Value);
            }
            // Step out of the registry. The bags keep their values, so stepping
            // back in is exact.
            foreach (var m in _sharedMounts)
            {
                if (reg.Has(m.Key)) reg.Remove(m.Key);
            }
            foreach (var pair in _flows) pair.Value.ReleaseBags(false);
            Engine next = null;
            try
            {
                options.Registry = reg;
                next = new Engine(bundle, options);
                snapshot.Registry = mine;
                var report = next.LoadGame(snapshot);
                // Values that were waiting for a flow wait on, for the
                // replacement's flow of that name.
                var stillWaiting = new OrderedMap<string, OrderedMap<string, ExprValue>>();
                foreach (var pair in waiting)
                {
                    if (!reg.Has(pair.Key)) stillWaiting.Set(pair.Key, pair.Value);
                }
                if (stillWaiting.Count > 0) reg.Load(stillWaiting, keepParked: true);
                DropRun(null);
                return new HotSwapResult { Engine = next, Report = report };
            }
            catch (Exception)
            {
                // Back as it was. The replacement's registrations go; a
                // constructor that failed part way parked what it had claimed, so
                // this engine's keys are cleared of anything waiting, registered
                // again, and its own values laid back over them (the waiting ones
                // parked again).
                if (next != null)
                {
                    next.DropRun(null);
                    foreach (var m in next._sharedMounts)
                    {
                        if (reg.Has(m.Key)) reg.Remove(m.Key);
                    }
                }
                reg.DiscardParked("storylets/");
                foreach (var m in _sharedMounts) m.Mount();
                foreach (var pair in _flows) pair.Value.MountBags();
                // `story` may have claimed what the failed replacement parked
                // there: back to its declarations, then this engine's own values
                // over it.
                ReseedShared();
                reg.Load(mine, keepParked: true);
                throw;
            }
        }

        /// <summary>The whole engine's NON-property state, one envelope: the
        /// spent cards once, then every live flow (board, clocks, cooldowns,
        /// PRNG, play log) keyed by its id. The property values are the
        /// registry's: a standalone engine (one that made its own registry)
        /// carries them here under Registry, self-backed @world included; a game
        /// that passed a registry saves it once itself, beside each engine's
        /// envelope.</summary>
        public SaveEnvelope SaveGame()
        {
            var envelope = new SaveEnvelope
            {
                Schema = Model.SAVE_SCHEMA,
                Content = new BundleContent
                {
                    Project = _bundle.Content.Project,
                    Version = _bundle.Content.Version,
                    Hash = _bundle.Content.Hash,
                },
            };
            if (_ownsRegistry) envelope.Registry = _registry.Save();
            envelope.Shared.Spent = SpentIds();
            foreach (var pair in _flows) envelope.Flows.Set(pair.Key, pair.Value.Snapshot(false));
            return envelope;
        }

        /// <summary>ONE flow's blob, to park a visit that is walking away: the
        /// same shape the envelope carries per flow, and the same shape
        /// OpenFlow's Restore option takes back (design/engine-server.md 4.1).
        /// Saving the whole envelope to park one of four hundred players is
        /// wrong in cost and in meaning. Throws for a name that is not open - a
        /// closed flow has nothing left to save.
        ///
        /// Parked whole, properties included: a parked flow's bags leave the
        /// registry when it closes, so its values have to travel with it.</summary>
        public FlowSave SaveFlow(string id)
        {
            var flow = _flows.GetOrDefault(id);
            if (flow == null) throw new StoryletError($"unknown flow \"{id}\"");
            return flow.Snapshot(true);
        }

        /// <summary>What LoadGame(envelope) would do that is not a plain
        /// restore, without doing any of it (design/engine-server.md 4.9). Pure:
        /// nothing on this engine moves. A project mismatch is refused here
        /// exactly as LoadGame refuses it - it is the one thing neither call
        /// will tolerate.</summary>
        public LoadReport PreviewLoad(SaveEnvelope envelope)
        {
            AssertSameProject(envelope);
            return PlanLoad(envelope).Report;
        }

        /// <summary>What OpenFlow(id, { Restore = saved }) would do to a flow of
        /// that name, without doing it: the same report shape, since a visit
        /// parked under one build and resumed under the next raises the same
        /// questions. Pure.</summary>
        public LoadReport PreviewFlowRestore(string id, FlowSave saved)
        {
            var draft = new ReportDraft();
            PlanFlowRestore(id, saved, SharedClaimsExcept(id), draft);
            return FinishReport(_bundle.Content, _bundle.Content, new List<string> { id }, draft);
        }

        /// <summary>Restore: shared state once, then every flow REBUILT from
        /// its blob. Handles held from before the load are closed and inert
        /// (Patter's rule); take fresh ones from GetFlow()/Flows().
        ///
        /// Takes storylets/save@2 and storylets/save@1 envelopes. Property
        /// values come from the registry. An envelope that carries them (a
        /// standalone engine's, or a version 1 envelope) has them walked,
        /// cleaned, and moved into the registry here, over fresh defaults.
        /// Otherwise the game loads its registry itself, before or after this
        /// call: each flow's bags are handed back to the registry with their
        /// values, and the restored flows claim them. The report then covers
        /// only what this envelope holds; the registry's own load rule applies
        /// to the values.
        ///
        /// Returns the report PreviewLoad would have given for this envelope:
        /// the drift tolerance that makes a load forgiving is what hides its
        /// cost, so the cost comes back with the load whether or not anybody
        /// looked first.</summary>
        public LoadReport LoadGame(SaveEnvelope envelope)
        {
            AssertSameProject(envelope);
            AssertExternalScopes();
            var plan = PlanLoad(envelope);
            if (plan.Sections != null)
            {
                // The envelope carries the values: every bag of this engine back
                // to its defaults, then the cleaned values over them.
                Reset();
                // The engine's own registry takes the save wholesale. A game's
                // registry may hold values the game loaded for other engines,
                // still waiting: add to those, never replace them.
                _registry.Load(plan.Sections, keepParked: !_ownsRegistry);
            }
            else
            {
                var keep = new HashSet<string>();
                foreach (var pair in plan.Flows) keep.Add(pair.Key);
                DropRun(keep);
            }
            foreach (var id in plan.Spent) _spent.Add(id);
            foreach (var pair in plan.Flows) Open(pair.Key, new OpenFlowOptions(), true).Restore(pair.Value);
            return plan.Report;
        }

        private void AssertSameProject(SaveEnvelope envelope)
        {
            if (envelope.Content.Project != _bundle.Content.Project)
            {
                throw new StoryletError(
                    $"save is for project \"{envelope.Content.Project}\", bundle is \"{_bundle.Content.Project}\"");
            }
        }

        // --- the load report (design/engine-server.md 4.9) ---------------------
        //
        // One walk, two entry points. PreviewLoad runs it and returns the
        // report; LoadGame runs it, returns the same report and then applies the
        // CLEANED blob the walk produced. Two implementations of "what does this
        // save cost" would drift the first time one of them was fixed, so there
        // is one, and the apply half consumes its output rather than repeating
        // its decisions.

        /// <summary>The report under construction: unsorted, until FinishReport
        /// orders it.</summary>
        private sealed class ReportDraft
        {
            public readonly List<LoadEviction> Evicted = new List<LoadEviction>();
            public readonly List<LoadCooldown> DroppedCooldowns = new List<LoadCooldown>();
            public readonly List<string> DroppedSpent = new List<string>();
            public readonly List<LoadProperty> DroppedProperties = new List<LoadProperty>();
            public readonly List<LoadProperty> DefaultedProperties = new List<LoadProperty>();
            public readonly List<LoadProperty> RetypedProperties = new List<LoadProperty>();
        }

        private sealed class LoadPlan
        {
            public LoadReport Report;
            /// <summary>The cleaned property values to move into the registry,
            /// when the envelope carries any; null when it does not.</summary>
            public OrderedMap<string, OrderedMap<string, ExprValue>> Sections;
            public List<string> Spent = new List<string>();
            public OrderedMap<string, FlowSave> Flows = new OrderedMap<string, FlowSave>();
        }

        /// <summary>A registry save's sections sorted back into partitions, for
        /// the load walk: the shared ones, each flow's (only the flows the save
        /// restores; the rest are dropped), and everything that is not this
        /// engine's, passed through.</summary>
        private sealed class MovedValues
        {
            public PropsPartition Shared = new PropsPartition();
            public Dictionary<string, PropsPartition> Flows = new Dictionary<string, PropsPartition>();
            public OrderedMap<string, OrderedMap<string, ExprValue>> Rest =
                new OrderedMap<string, OrderedMap<string, ExprValue>>();
        }

        private static bool IsOwnedKind(string kind)
        {
            return kind == "box" || kind == "deck" || kind == "hand" || kind == "value";
        }

        private static MovedValues PartitionsFromSections(
            OrderedMap<string, OrderedMap<string, ExprValue>> sections, HashSet<string> flowIds)
        {
            var moved = new MovedValues();
            PropsPartition FlowOf(string escaped)
            {
                var id = Unesc(escaped);
                if (!flowIds.Contains(id)) return null;
                if (!moved.Flows.TryGetValue(id, out var p))
                {
                    p = new PropsPartition();
                    moved.Flows[id] = p;
                }
                return p;
            }
            foreach (var pair in sections)
            {
                var key = pair.Key;
                if (key == "story")
                {
                    moved.Shared.Story = pair.Value;
                    continue;
                }
                if (!key.StartsWith("storylets/", StringComparison.Ordinal))
                {
                    moved.Rest.Set(key, pair.Value);
                    continue;
                }
                // Split on "/" exactly as the JS reference's anchored patterns
                // match: no segment may be empty or hold a "/" (an id's own "/" is
                // escaped).
                var seg = key.Split('/');
                if (Array.IndexOf(seg, "") >= 0) continue;
                if (seg.Length == 3 && IsOwnedKind(seg[1]))
                {
                    SavedKind(moved.Shared, seg[1]).Set(Unesc(seg[2]), pair.Value);
                }
                else if (seg.Length == 4 && seg[1] == "flow" && seg[3] == "story")
                {
                    var p = FlowOf(seg[2]);
                    if (p != null) p.Story = pair.Value;
                }
                else if (seg.Length == 5 && seg[1] == "flow" && IsOwnedKind(seg[3]))
                {
                    var p = FlowOf(seg[2]);
                    if (p != null) SavedKind(p, seg[3]).Set(Unesc(seg[4]), pair.Value);
                }
                // Any other `storylets/` key is not a bag this engine has: dropped.
            }
            return moved;
        }

        /// <summary>A cleaned partition as registry sections, keyed the way its
        /// bags register. Empty sections are left out: they would load nothing,
        /// and a section for a bag that never registers would wait in the
        /// registry for ever.</summary>
        private static void SectionsOf(PropsPartition p, Func<string, string, string> keyOf,
                                       OrderedMap<string, OrderedMap<string, ExprValue>> outSections)
        {
            if (p.Story.Count > 0) outSections.Set(keyOf("story", null), p.Story);
            foreach (var kind in OwnedScopes)
            {
                foreach (var pair in SavedKind(p, kind))
                {
                    if (pair.Value.Count > 0) outSections.Set(keyOf(kind, pair.Key), pair.Value);
                }
            }
        }

        /// <summary>The sort key separator: a UNIT SEPARATOR, because it cannot
        /// occur in an id, a gameId or a property name.</summary>
        private const string SortSep = "\u001f";

        /// <summary>Does a saved value still fit its declaration?
        ///
        /// The type first, then the declaration's own vocabulary: an enum value
        /// or a quality stage the edit struck out is still a string of the right
        /// type and still no longer a legal value. A declaration with no
        /// vocabulary constrains nothing, so anything of the right type
        /// fits.</summary>
        private static bool ValueFits(PropertyDecl decl, ExprValue value)
        {
            if (value == null) return false;
            switch (decl.Type)
            {
                case PropertyTypes.Boolean: return value.IsBool;
                case PropertyTypes.Number: return value.IsNumber;
                case PropertyTypes.String: return value.IsString;
                case PropertyTypes.Enum:
                    return value.IsString && (decl.Values == null || decl.Values.Contains(value.AsString));
                case PropertyTypes.Quality:
                    return value.IsString && (decl.Stages == null || decl.Stages.Contains(value.AsString));
                case PropertyTypes.Flags:
                    if (!value.IsFlags) return false;
                    if (decl.Values == null) return true;
                    foreach (var f in value.AsFlags) if (!decl.Values.Contains(f)) return false;
                    return true;
                default: return true;
            }
        }

        /// <summary>Walk one bag's worth of saved values against one bag's worth
        /// of declarations: report the orphans, the newcomers and the misfits,
        /// and return the values that survive.</summary>
        private static OrderedMap<string, ExprValue> WalkScope(
            List<PropertyDecl> decls,
            OrderedMap<string, ExprValue> saved,
            Func<string, string> path,
            string flow,
            ReportDraft draft)
        {
            var byName = new Dictionary<string, PropertyDecl>();
            if (decls != null) foreach (var d in decls) byName[d.Name] = d;
            var clean = new OrderedMap<string, ExprValue>();
            if (saved != null)
            {
                foreach (var pair in saved)
                {
                    if (!byName.TryGetValue(pair.Key, out var decl))
                    {
                        draft.DroppedProperties.Add(new LoadProperty { Flow = flow, Path = path(pair.Key) });
                        continue;
                    }
                    if (!ValueFits(decl, pair.Value))
                    {
                        draft.RetypedProperties.Add(new LoadProperty { Flow = flow, Path = path(pair.Key) });
                        continue;
                    }
                    clean.Set(pair.Key, pair.Value);
                }
            }
            if (decls != null)
            {
                foreach (var d in decls)
                {
                    if (saved == null || !saved.ContainsKey(d.Name))
                    {
                        draft.DefaultedProperties.Add(new LoadProperty { Flow = flow, Path = path(d.Name) });
                    }
                }
            }
            return clean;
        }

        /// <summary>The same walk over all five scopes of one partition. An
        /// owner the save carries and the build no longer has drops whole (its
        /// bag is gone, so its values have nowhere to land); an owner the build
        /// has and the save lacks keeps every default.</summary>
        private PropsPartition WalkPartition(DeclSet decls, PropsPartition values, string flow, ReportDraft draft)
        {
            var outP = new PropsPartition();
            outP.Story = WalkScope(decls.Story, values?.Story, n => "story." + n, flow, draft);
            foreach (var kind in OwnedScopes)
            {
                var declKind = decls.Kind(kind);
                var savedKind = SavedKind(values, kind);
                var ids = new List<string>();
                var seen = new HashSet<string>();
                foreach (var key in declKind.Keys) if (seen.Add(key)) ids.Add(key);
                if (savedKind != null) foreach (var key in savedKind.Keys) if (seen.Add(key)) ids.Add(key);
                ids.Sort(StringComparer.Ordinal);
                var target = SavedKind(outP, kind);
                foreach (var id in ids)
                {
                    // The report's Path is exactly what ListProperties() prints
                    // and what SetProperty takes: one grammar, so an operator
                    // reading a hot-swap report can paste the address straight
                    // back in (4.4).
                    var prefix = AddressOf(kind, id) + ".";
                    var savedBag = savedKind != null ? savedKind.GetOrDefault(id) : null;
                    target.Set(id, WalkScope(declKind.GetOrDefault(id), savedBag, n => prefix + n, flow, draft));
                }
            }
            return outP;
        }

        private static OrderedMap<string, OrderedMap<string, ExprValue>> SavedKind(PropsPartition p, string kind)
        {
            if (p == null) return null;
            switch (kind)
            {
                case "box": return p.Box;
                case "deck": return p.Deck;
                case "hand": return p.Hand;
                default: return p.Value;
            }
        }

        /// <summary>The whole-envelope walk: the report, and the cleaned state
        /// the apply half writes. Nothing here touches the engine, which is what
        /// lets PreviewLoad and LoadGame share it.</summary>
        private LoadPlan PlanLoad(SaveEnvelope envelope)
        {
            var schema = envelope.Schema;
            if (schema != Model.SAVE_SCHEMA && schema != Model.SAVE_SCHEMA_V1)
            {
                throw new StoryletError($"unsupported save schema: {schema ?? "undefined"}");
            }
            var draft = new ReportDraft();
            var plan = new LoadPlan();
            var envelopeFlows = envelope.Flows ?? new OrderedMap<string, FlowSave>();
            // Where the property values are, if this envelope has them: a
            // version 1 envelope's partitions, or a standalone engine's registry
            // sections.
            var flowIds = new HashSet<string>(envelopeFlows.Keys);
            MovedValues moved = null;
            if (schema == Model.SAVE_SCHEMA_V1)
            {
                moved = new MovedValues { Shared = envelope.Shared?.Props ?? new PropsPartition() };
                foreach (var pair in envelopeFlows) moved.Flows[pair.Key] = pair.Value.Props ?? new PropsPartition();
            }
            else if (envelope.Registry != null)
            {
                moved = PartitionsFromSections(envelope.Registry, flowIds);
            }
            var shared = moved != null ? WalkPartition(_sharedDecls, moved.Shared, null, draft) : null;
            foreach (var cardId in envelope.Shared?.Spent ?? new List<string>())
            {
                if (_cardsById.ContainsKey(cardId)) plan.Spent.Add(cardId);
                else draft.DroppedSpent.Add(cardId);
            }
            OrderedMap<string, OrderedMap<string, ExprValue>> sections = null;
            if (moved != null)
            {
                sections = new OrderedMap<string, OrderedMap<string, ExprValue>>();
                foreach (var pair in moved.Rest) sections.Set(pair.Key, pair.Value);
                SectionsOf(shared, (kind, id) => kind == "story" ? "story" : SharedKey(kind, id), sections);
            }
            var ids = new List<string>();
            foreach (var pair in envelopeFlows)
            {
                ids.Add(pair.Key);
                var saved = pair.Value;
                if (moved != null)
                {
                    // The walk sees this flow's values wherever they came from;
                    // the caller's blob is left as it was (PreviewLoad is pure).
                    moved.Flows.TryGetValue(pair.Key, out var props);
                    saved = WithProps(saved, props ?? new PropsPartition());
                }
                var clean = PlanFlowRestore(pair.Key, saved, null, draft);
                if (sections != null && clean.Props != null)
                {
                    // The flow's values go into the registry, where its bags claim
                    // them; the restored flow itself carries none.
                    var flowId = pair.Key;
                    SectionsOf(clean.Props, (kind, owner) => FlowKey(flowId, kind, owner), sections);
                    clean.Props = null;
                }
                plan.Flows.Set(pair.Key, clean);
            }
            plan.Sections = sections;
            plan.Report = FinishReport(_bundle.Content, envelope.Content, ids, draft);
            return plan;
        }

        /// <summary>A shallow copy of a flow blob with other property
        /// partitions: the walk reads the blob and never writes it.</summary>
        private static FlowSave WithProps(FlowSave saved, PropsPartition props)
        {
            return new FlowSave
            {
                Props = props,
                Turns = saved.Turns,
                Prng = saved.Prng,
                Cooldowns = saved.Cooldowns,
                Board = saved.Board,
                PlayLog = saved.PlayLog,
            };
        }

        /// <summary>One flow's walk. otherClaims is the rest of the world's
        /// shared ledger and is present only for a SINGLE-flow restore into a
        /// live engine: a whole-envelope load rebuilds every flow from one
        /// consistent moment, so there is nobody else to compete with.</summary>
        private FlowSave PlanFlowRestore(string id, FlowSave saved, Dictionary<string, int> otherClaims, ReportDraft draft)
        {
            var clean = new FlowSave { Prng = saved.Prng };
            // A flow blob without properties (a version 2 envelope's: the
            // registry has them) has nothing to walk.
            clean.Props = saved.Props != null ? WalkPartition(_flowDecls, saved.Props, id, draft) : null;
            foreach (var pair in saved.Turns) clean.Turns.Set(pair.Key, pair.Value);
            foreach (var record in saved.PlayLog)
            {
                clean.PlayLog.Add(new PlayRecord { Card = record.Card, Outcome = record.Outcome, Turn = record.Turn });
            }
            foreach (var pair in saved.Cooldowns)
            {
                if (_cardsById.ContainsKey(pair.Key)) clean.Cooldowns.Set(pair.Key, pair.Value);
                else draft.DroppedCooldowns.Add(new LoadCooldown { Flow = id, Card = pair.Key });
            }
            // A deleted entity has no gameId left, so it is named by the id the
            // save carries; everything the build still knows is named by its
            // gameId.
            Func<string, string> cardName = cardId =>
            {
                var known = _cardsById.GetOrDefault(cardId);
                return known != null ? Model.EffectiveGameId(known.Card) : cardId;
            };
            var restored = new Dictionary<string, int>();
            foreach (var pair in saved.Board)
            {
                var known = _handsById.GetOrDefault(pair.Key);
                if (known == null)
                {
                    foreach (var cardId in pair.Value)
                    {
                        draft.Evicted.Add(new LoadEviction
                        {
                            Flow = id, Hand = pair.Key, Card = cardName(cardId),
                            Reason = EvictionReasons.HandVanished,
                        });
                    }
                    continue;
                }
                var hand = Model.EffectiveGameId(known.Hand);
                var kept = new List<string>();
                foreach (var cardId in pair.Value)
                {
                    var entry = _cardsById.GetOrDefault(cardId);
                    if (entry == null)
                    {
                        draft.Evicted.Add(new LoadEviction
                        {
                            Flow = id, Hand = hand, Card = cardId, Reason = EvictionReasons.Vanished,
                        });
                        continue;
                    }
                    if (otherClaims != null && Flow.CardIsShared(entry.Card, entry.Deck.Shared ?? false))
                    {
                        otherClaims.TryGetValue(cardId, out var elsewhere);
                        restored.TryGetValue(cardId, out var here);
                        if (elsewhere + here >= Flow.SharedCap(entry.Card))
                        {
                            draft.Evicted.Add(new LoadEviction
                            {
                                Flow = id, Hand = hand, Card = Model.EffectiveGameId(entry.Card),
                                Reason = EvictionReasons.ClaimedElsewhere,
                            });
                            continue;
                        }
                        restored[cardId] = here + 1;
                    }
                    kept.Add(cardId);
                }
                clean.Board.Set(pair.Key, kept);
            }
            return clean;
        }

        /// <summary>Order the draft and answer the identity questions. `saved` is
        /// the content block the save carries; for a single-flow restore there is
        /// none, so the caller passes the bundle's own and no drift is
        /// reported.</summary>
        private static LoadReport FinishReport(BundleContent bundle, BundleContent saved, List<string> flows, ReportDraft draft)
        {
            draft.Evicted.Sort((a, b) => string.CompareOrdinal(
                string.Join(SortSep, a.Flow, a.Hand, a.Card, a.Reason),
                string.Join(SortSep, b.Flow, b.Hand, b.Card, b.Reason)));
            draft.DroppedCooldowns.Sort((a, b) => string.CompareOrdinal(
                string.Join(SortSep, a.Flow, a.Card), string.Join(SortSep, b.Flow, b.Card)));
            draft.DroppedSpent.Sort(StringComparer.Ordinal);
            Comparison<LoadProperty> byPath = (a, b) => string.CompareOrdinal(
                string.Join(SortSep, a.Flow ?? "", a.Path), string.Join(SortSep, b.Flow ?? "", b.Path));
            draft.DroppedProperties.Sort(byPath);
            draft.DefaultedProperties.Sort(byPath);
            draft.RetypedProperties.Sort(byPath);
            var drift = saved.Version != bundle.Version || saved.Hash != bundle.Hash;
            return new LoadReport
            {
                // Flows is what the load restores, not something it had to
                // change, so it never makes a report inexact.
                Exact = !drift && draft.Evicted.Count == 0 && draft.DroppedCooldowns.Count == 0
                    && draft.DroppedSpent.Count == 0 && draft.DroppedProperties.Count == 0
                    && draft.DefaultedProperties.Count == 0 && draft.RetypedProperties.Count == 0,
                Project = bundle.Project,
                Version = new LoadIdentity { Saved = saved.Version, Bundle = bundle.Version },
                Hash = new LoadIdentity { Saved = saved.Hash, Bundle = bundle.Hash },
                Flows = flows,
                Evicted = draft.Evicted,
                DroppedCooldowns = draft.DroppedCooldowns,
                DroppedSpent = draft.DroppedSpent,
                DroppedProperties = draft.DroppedProperties,
                DefaultedProperties = draft.DefaultedProperties,
                RetypedProperties = draft.RetypedProperties,
            };
        }
    }
}
