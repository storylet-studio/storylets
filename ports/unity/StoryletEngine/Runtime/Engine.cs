// The Engine + Flow: the world + flow manager and the personal playthrough
// (design/flows.md; the shape is Patter's), transliterated from the
// reference runtime (packages/runtime/src/engine.ts) and held to the
// conformance corpus. An Engine owns the bundle, the lookups, the SHARED
// property partitions and the @world resolver (never in SaveGame() - the
// host saves its container); a Flow owns its own PRNG, clocks, cooldowns,
// board, claims, play history and per-flow partitions. Every name is
// shared XOR per-flow by declaration, so a read is a union of two bags and
// a write routes by name. No default flow, no ambient flow: OpenFlow(id)
// is the only way in, an existing id is REPLACED, closed handles are
// INERT, and engine-level reads of per-flow refs throw the teaching error.
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
        /// <summary>The host's @world resolver - the values the game owns.
        /// Null = self-backed from the declared defaults. Engine-level, shared
        /// by all flows, never in SaveGame().</summary>
        public IScopeResolver World = null;
        /// <summary>Diagnostics hook (opt-in, dev only): fired when OpenFlow
        /// REPLACES a flow that still had cards dealt (flow id, count). The
        /// behaviour is unchanged; this makes observable the host that calls
        /// OpenFlow straight after LoadGame and discards the restored hand -
        /// GetFlow is the call. Parity with the JS runtime's onReplacedFlow.
        /// Zero cost when unset.</summary>
        public Action<string, int> OnReplacedFlow = null;
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
        public OrderedMap<string, StoryletValue> Fields;
    }

    public sealed class OutcomeView
    {
        public string Id;
        public string GameId;
        public string Title;
        public string Purpose;
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
        public string Id;
        public TraceVerdict Verdict;
        public double? Priority;
        public double? Specificity;
    }

    /// <summary>One event on the deal/play log. The verb is the event type, so a
    /// peek is distinguishable from a deal when reading a run back.</summary>
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

    public sealed class EvictEvent : TraceEvent
    {
        public string Hand;
        public string Card;
        /// <summary>A verdict wire name, or "hand-condition" / "vanished".</summary>
        public string Reason;
    }

    public sealed class PlayEvent : TraceEvent
    {
        public string Card;
        public string Outcome;
        public double Turn;
    }

    /// <summary>One landed outcome change; Path is the resolved store location (a
    /// routed @hand write shows where it actually went, schema 3.6). Prev is the
    /// value it replaced, so a log can read "0 -> 1".</summary>
    public sealed class WriteEvent : TraceEvent
    {
        public string Target;
        public string Path;
        public StoryletValue Value;
        public StoryletValue Prev;
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
    /// box.&lt;id&gt; / deck.&lt;id&gt; / hand.&lt;id&gt; / value.&lt;id&gt;): the state logger's
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
    /// resolves per-flow throws, naming the fix. @world is never in
    /// SaveGame() - the host saves its container, each engine saves its own
    /// envelope.</summary>
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

        /// <summary>The shared stores. Reassigned wholesale by LoadGame/Reset.</summary>
        internal Partition _shared;
        // @world: the host's resolver (it outlives Reset/LoadGame - the
        // container is the host's), or a self-backed bag.
        private readonly IScopeResolver _hostWorld;
        private PropertyBag _selfWorld;
        internal IScopeSource WorldScope;

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

        private sealed class SelfWorldScope : IScopeSource
        {
            public Engine Owner;
            public StoryletValue Get(string name) => Owner.WorldGet(name);
        }

        public Engine(Bundle bundle, EngineOptions opts = null)
        {
            opts = opts ?? new EngineOptions();
            _bundle = bundle;
            _seed = opts.Seed;
            _onReplacedFlow = opts.OnReplacedFlow;
            if (opts.Log) _logCap = opts.LogCap;
            _hostWorld = opts.World;
            foreach (var box in bundle.Boxes)
            {
                _boxesById.Set(box.Id, box);
                _boxesByGameId.Set(Model.EffectiveGameId(box), box);
                foreach (var group in box.TagGroups)
                {
                    _groupsById.Set(group.Id, (group, box));
                    if (group.Required) requiredGroups.Add(group.Id);
                }
                foreach (var deck in box.Decks)
                {
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
            InitShared();
            WorldScope = new SelfWorldScope { Owner = this };
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

        /// <summary>Build the shared stores and the @world seam.</summary>
        private void InitShared()
        {
            var shared = new Partition { Story = BagFromDecls(Half("story", _bundle.Story.Properties, true), "story.") };
            foreach (var box in _bundle.Boxes)
            {
                shared.Box.Set(box.Id, BagFromDecls(Half("box", box.Properties, true), $"box.{box.Id}."));
                foreach (var deck in box.Decks) shared.Deck.Set(deck.Id, BagFromDecls(Half("deck", deck.Properties, true), $"deck.{deck.Id}."));
                foreach (var hand in box.Hands) shared.Hand.Set(hand.Id, BagFromDecls(Half("hand", HandDecls(hand), true), $"hand.{hand.Id}."));
                foreach (var group in box.TagGroups)
                    foreach (var tag in group.Tags)
                        shared.Value.Set(tag.Id, BagFromDecls(Half("value", tag.Properties ?? new List<PropertyDecl>(), true), $"value.{tag.Id}."));
            }
            _shared = shared;
            if (_hostWorld == null)
            {
                // Standalone: self-backed from the declared defaults. Still
                // FOREIGN in spirit - never in SaveGame(); a host that wants
                // @world to persist saves the container itself.
                _selfWorld = BagFromDecls(_bundle.World.Properties, "world.");
            }
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
            foreach (var pair in _flowDecls.Box) p.Box.Set(pair.Key, BagFromDecls(pair.Value, $"box.{pair.Key}."));
            foreach (var pair in _flowDecls.Deck) p.Deck.Set(pair.Key, BagFromDecls(pair.Value, $"deck.{pair.Key}."));
            foreach (var pair in _flowDecls.Hand) p.Hand.Set(pair.Key, BagFromDecls(pair.Value, $"hand.{pair.Key}."));
            foreach (var pair in _flowDecls.Value) p.Value.Set(pair.Key, BagFromDecls(pair.Value, $"value.{pair.Key}."));
            return p;
        }

        // --- the @world seam ---------------------------------------------------

        internal StoryletValue WorldGet(string name)
        {
            return _hostWorld != null ? _hostWorld.Get(name) : _selfWorld.Get(name);
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

        internal void WorldSet(string name, StoryletValue value)
        {
            if (_hostWorld != null) _hostWorld.Set(name, value);
            else _selfWorld.Set(name, value);
        }

        // --- flow management (Patter's surface, name for name) ------------------

        /// <summary>Open (or REPLACE) the named flow. An existing id's flow is
        /// closed first - re-opening a name is a reset of that name's whole
        /// per-flow state; shared state is untouched. There is no default flow:
        /// "main" is a caller convention, not an engine rule.</summary>
        public Flow OpenFlow(string id, OpenFlowOptions opts = null)
        {
            opts = opts ?? new OpenFlowOptions();
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
        /// and is not touched).</summary>
        public void Reset()
        {
            foreach (var pair in _flows) pair.Value.MarkClosed();
            _flows.Clear();
            _spent.Clear();
            // The log is a run-lifetime utility and is not saved; a reset is a
            // new run.
            _engineLog.Clear();
            InitShared();
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
        /// shared), "box.b_x.heat" (when shared). A ref that resolves PER-FLOW
        /// throws, naming the fix (Patter's teaching rule).</summary>
        public StoryletValue GetProperty(string path)
        {
            var parts = path.Split('.');
            if (parts.Length == 2 && parts[0] == "world")
            {
                var wv = WorldGet(parts[1]);
                if (wv == null) throw new StoryletError($"no property at \"{path}\"");
                return wv;
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
                var sharedKind = KindOf(_shared, parts[0]);
                var flowDecls = FlowDeclsOf(parts[0]);
                var bag = sharedKind.GetOrDefault(parts[1]);
                if (bag != null)
                {
                    var v = bag.Get(parts[2]);
                    if (v != null) return v;
                }
                var decls = flowDecls.GetOrDefault(parts[1]);
                if (decls != null)
                {
                    foreach (var d in decls)
                    {
                        if (d.Name == parts[2]) throw new StoryletError($"\"{path}\" is per-flow state - read it on a Flow, not the Engine");
                    }
                }
                if (bag == null && decls == null) throw new StoryletError($"no {parts[0]} store \"{parts[1]}\"");
                throw new StoryletError($"no property at \"{path}\"");
            }
            throw new StoryletError($"bad property path \"{path}\"");
        }

        public void SetProperty(string path, StoryletValue value)
        {
            var parts = path.Split('.');
            if (parts.Length == 2 && parts[0] == "world")
            {
                if (!WorldCanSet) throw new StoryletError("@world is read-only here: the host bound no write");
                WorldSet(parts[1], value);
                return;
            }
            // Reuse the read-side routing: a per-flow or unknown ref throws the
            // same message before anything is written.
            GetProperty(path);
            PropertyBag bag = parts.Length == 2 ? _shared.Story : KindOf(_shared, parts[0]).GetOrDefault(parts[1]);
            bag.Set(parts[parts.Length - 1], value, silent: true, reason: "host setProperty");
        }

        private static OrderedMap<string, PropertyBag> KindOf(Partition p, string kind)
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
                    Writable = WorldCanSet,
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
            foreach (var pair in _shared.Box) Add($"box.{pair.Key}", pair.Value);
            foreach (var pair in _shared.Deck) Add($"deck.{pair.Key}", pair.Value);
            foreach (var pair in _shared.Hand) Add($"hand.{pair.Key}", pair.Value);
            foreach (var pair in _shared.Value) Add($"value.{pair.Key}", pair.Value);
            return rows;
        }

        /// <summary>The SHARED kernel bags with their store path prefixes (the
        /// state logger's mount surface). The @world container is the host's
        /// own bag - the host mounts it itself.</summary>
        public List<BagMount> ListBags()
        {
            var mounts = new List<BagMount> { new BagMount { Prefix = "story", Bag = _shared.Story } };
            foreach (var pair in _shared.Box) mounts.Add(new BagMount { Prefix = $"box.{pair.Key}", Bag = pair.Value });
            foreach (var pair in _shared.Deck) mounts.Add(new BagMount { Prefix = $"deck.{pair.Key}", Bag = pair.Value });
            foreach (var pair in _shared.Hand) mounts.Add(new BagMount { Prefix = $"hand.{pair.Key}", Bag = pair.Value });
            foreach (var pair in _shared.Value) mounts.Add(new BagMount { Prefix = $"value.{pair.Key}", Bag = pair.Value });
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

        /// <summary>The whole engine, one envelope: the shared partitions once,
        /// then every live flow keyed by its id. @world is NEVER here.</summary>
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
            envelope.Shared.Props.Story = _shared.Story.Save();
            foreach (var pair in _shared.Box) envelope.Shared.Props.Box.Set(pair.Key, pair.Value.Save());
            foreach (var pair in _shared.Deck) envelope.Shared.Props.Deck.Set(pair.Key, pair.Value.Save());
            foreach (var pair in _shared.Hand) envelope.Shared.Props.Hand.Set(pair.Key, pair.Value.Save());
            foreach (var pair in _shared.Value) envelope.Shared.Props.Value.Set(pair.Key, pair.Value.Save());
            envelope.Shared.Spent = SpentIds();
            foreach (var pair in _flows) envelope.Flows.Set(pair.Key, pair.Value.Snapshot());
            return envelope;
        }

        /// <summary>ONE flow's blob, to park a visit that is walking away: the
        /// same shape the envelope carries per flow, and the same shape
        /// OpenFlow's Restore option takes back (design/engine-server.md 4.1).
        /// Saving the whole envelope to park one of four hundred players is
        /// wrong in cost and in meaning. Throws for a name that is not open - a
        /// closed flow has nothing left to save.</summary>
        public FlowSave SaveFlow(string id)
        {
            var flow = _flows.GetOrDefault(id);
            if (flow == null) throw new StoryletError($"unknown flow \"{id}\"");
            return flow.Snapshot();
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
        /// Returns the report PreviewLoad would have given for this envelope:
        /// the drift tolerance that makes a load forgiving is what hides its
        /// cost, so the cost comes back with the load whether or not anybody
        /// looked first.</summary>
        public LoadReport LoadGame(SaveEnvelope envelope)
        {
            AssertSameProject(envelope);
            var plan = PlanLoad(envelope);
            Reset();
            _shared.Story.Load(plan.Shared.Story);
            LoadKind(_shared.Box, plan.Shared.Box);
            LoadKind(_shared.Deck, plan.Shared.Deck);
            LoadKind(_shared.Hand, plan.Shared.Hand);
            LoadKind(_shared.Value, plan.Shared.Value);
            foreach (var id in plan.Spent) _spent.Add(id);
            foreach (var pair in plan.Flows) OpenFlow(pair.Key).Restore(pair.Value);
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

        private static void LoadKind(
            OrderedMap<string, PropertyBag> stores,
            OrderedMap<string, OrderedMap<string, StoryletValue>> saved)
        {
            foreach (var pair in saved)
            {
                stores.GetOrDefault(pair.Key)?.Load(pair.Value);
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
            public PropsPartition Shared = new PropsPartition();
            public List<string> Spent = new List<string>();
            public OrderedMap<string, FlowSave> Flows = new OrderedMap<string, FlowSave>();
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
        private static bool ValueFits(PropertyDecl decl, StoryletValue value)
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
        private static OrderedMap<string, StoryletValue> WalkScope(
            List<PropertyDecl> decls,
            OrderedMap<string, StoryletValue> saved,
            Func<string, string> path,
            string flow,
            ReportDraft draft)
        {
            var byName = new Dictionary<string, PropertyDecl>();
            if (decls != null) foreach (var d in decls) byName[d.Name] = d;
            var clean = new OrderedMap<string, StoryletValue>();
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
            foreach (var kind in new[] { "box", "deck", "hand", "value" })
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
                    var prefix = kind + "." + id + ".";
                    var savedBag = savedKind != null ? savedKind.GetOrDefault(id) : null;
                    target.Set(id, WalkScope(declKind.GetOrDefault(id), savedBag, n => prefix + n, flow, draft));
                }
            }
            return outP;
        }

        private static OrderedMap<string, OrderedMap<string, StoryletValue>> SavedKind(PropsPartition p, string kind)
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
            var draft = new ReportDraft();
            var plan = new LoadPlan();
            plan.Shared = WalkPartition(_sharedDecls, envelope.Shared?.Props, null, draft);
            foreach (var cardId in envelope.Shared?.Spent ?? new List<string>())
            {
                if (_cardsById.ContainsKey(cardId)) plan.Spent.Add(cardId);
                else draft.DroppedSpent.Add(cardId);
            }
            var ids = new List<string>();
            foreach (var pair in envelope.Flows)
            {
                ids.Add(pair.Key);
                plan.Flows.Set(pair.Key, PlanFlowRestore(pair.Key, pair.Value, null, draft));
            }
            plan.Report = FinishReport(_bundle.Content, envelope.Content, ids, draft);
            return plan;
        }

        /// <summary>One flow's walk. otherClaims is the rest of the world's
        /// shared ledger and is present only for a SINGLE-flow restore into a
        /// live engine: a whole-envelope load rebuilds every flow from one
        /// consistent moment, so there is nobody else to compete with.</summary>
        private FlowSave PlanFlowRestore(string id, FlowSave saved, Dictionary<string, int> otherClaims, ReportDraft draft)
        {
            var clean = new FlowSave { Prng = saved.Prng };
            clean.Props = WalkPartition(_flowDecls, saved.Props, id, draft);
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
