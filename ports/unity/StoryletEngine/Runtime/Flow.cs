// One playthrough over an Engine's world (design/flows.md; the shape is
// Patter's, whose ports/unity/Patterplay/Runtime/Flow.cs is this file's
// opposite number): a Flow owns its own PRNG, per-box clocks, cooldowns,
// board, claims, play history and per-flow property partitions, and carries
// every play verb. The Engine next door owns the bundle, the shared halves
// and @world. Built by Engine.OpenFlow only; a closed flow is inert.
//
// Key dealing contracts, per flow, in one place (round-2 model):
//   - two verbs: deal(hand) claims, peek(box, criteria) just looks; you can
//     never play a card you only peeked (3.1, look/use rule)
//   - availability order: hand condition -> deck gate -> taken -> cooldown ->
//     tags -> card condition -> claims -> priority (3.1), the order an ask
//     reaches its verdicts in
//   - claims are physical WITHIN a flow: a card sits in at most `copies`
//     hands of that flow's board at once, at most once in any one hand
//   - the reserved home group inverts the wildcard: a homed card is
//     available only to an ask binding its home (2.4)
//   - ranking: priority desc -> specificity desc (box toggle) -> seeded
//     shuffle of each maximal tie run (3.2); sorts are STABLE
//   - one PRNG per flow: expression random(), tie shuffles and the batch
//     deal's hand-order shuffle all advance it; state lives in the save (3.3)
//   - each box has its own turn counter PER FLOW; cooldowns are absolute
//     next-eligible turns of the card's box's clock (3.4)
//   - @hand composes bound-tag props -> hand props -> chosen tags/criteria
//     (by group name), later shadowing earlier; writes route back to their
//     source; criteria names cannot be written (3.6)
//   - outcome availability is never snapshotted: Outcomes() and Play()
//     evaluate gates against current state (3.1, 3.7)
//   - a trace event fires after the state it reports has landed, so a
//     handler reading the flow inside it sees the effect

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Wildwinter.Expr;

namespace StoryletStudio.StoryletEngine
{
    public sealed class Flow
    {
        // --- internals ---------------------------------------------------------

        private sealed class HandSource
        {
            public string Kind;     // "value" | "hand" | "criteria"
            public string Id;
        }

        /// <summary>The composed @hand for one ask: the read bag, plus where each
        /// name routes on write (schema 3.6).</summary>
        private sealed class HandEnv
        {
            public OrderedMap<string, ExprValue> Bag;
            public Dictionary<string, HandSource> Sources;
            /// <summary>tag group id -> bound tag id (home included, its "tag" a hand id).</summary>
            public OrderedMap<string, string> BoundTags;
            /// <summary>Bag as an expression scope, made with the env so every
            /// context of one ask shares it.</summary>
            public BagScope Scope;
        }

        /// <summary>One ask, resolved: a deal (hand present, condition from its
        /// template or rule) or a peek (criteria only, no condition - schema 3.1).</summary>
        private sealed class AskDescriptor
        {
            public Box Box;
            public Hand Hand;
            public Expression Condition;
            /// <summary>tag group id -> tag id, everything the ask binds (fixed +
            /// chosen + criteria; for deals also home -> the hand's own id).</summary>
            public OrderedMap<string, string> BoundTags;
            /// <summary>Chosen tags / criteria surfaced into @hand by group gameId,
            /// the tag's gameId as the value (schema 3.6).</summary>
            public OrderedMap<string, string> AskNames;
        }

        /// <summary>A merged read scope: the flow's own bag first, the shared
        /// bag behind it. Names are disjoint (shared XOR per-flow by
        /// declaration), so "first" is routing, not shadowing.</summary>
        private sealed class PairScope : IScopeSource
        {
            public PropertyBag Own;
            public PropertyBag Shared;
            public ExprValue Get(string name)
            {
                return Own?.Get(name) ?? Shared?.Get(name);
            }
        }

        /// <summary>One eligible card of an ask, as ranked. A struct, so an ask
        /// allocates nothing per card for it; Index is the scored order, the
        /// sort's last key, which is what makes List.Sort stable.</summary>
        private struct Scored
        {
            public Card Card;
            public double Priority;
            public double Spec;
            public int Index;
        }

        /// <summary>Ranking order: priority desc, specificity desc, then scored
        /// order, so equal cards keep the order they were scored in (the stable
        /// sort LINQ's OrderByDescending gave). CompareTo is the comparison that
        /// sort used.</summary>
        private static readonly Comparison<Scored> ByRank = (a, b) =>
        {
            int c = b.Priority.CompareTo(a.Priority);
            if (c != 0) return c;
            c = b.Spec.CompareTo(a.Spec);
            return c != 0 ? c : a.Index.CompareTo(b.Index);
        };

        /// <summary>One cached evaluation context of a deal: built once per box
        /// (the hand condition) or per deck and pointed at each ask's @hand as
        /// it is fetched, so a deal stops building a context, its scopes map and
        /// its quality closure per deck per ask (about half of what a deal
        /// allocated). HandEnv is the ask it serves now; the quality channel and
        /// the "hand" scope read it. View is the registry view it was built
        /// over: a changed registry builds it again.</summary>
        private sealed class DealCtx
        {
            public EvalContext Ctx;
            public Engine.RegistryScopes View;
            public HandEnv HandEnv;
            /// <summary>The specificity scorer's per-node test against Ctx,
            /// made once rather than as a closure per card.</summary>
            public EvalTruthy Matches;
        }

        /// <summary>What a deal or a peek reuses from the last one: the cached
        /// contexts and the working lists and maps, cleared rather than rebuilt.
        /// Held for the whole verb, so it is never shared with a deal a trace
        /// handler or OnError starts inside it: that one finds none idle and
        /// makes its own (<see cref="TakeScratch"/>).</summary>
        private sealed class DealScratch
        {
            public readonly Dictionary<string, DealCtx> BoxCtx = new Dictionary<string, DealCtx>();
            public readonly Dictionary<string, DealCtx> DeckCtx = new Dictionary<string, DealCtx>();
            /// <summary>RunAsk's deck gates, by the deck's place in its box.</summary>
            public readonly List<bool> Gates = new List<bool>();
            /// <summary>EvictUnavailable's gates and contexts, by deck id.</summary>
            public readonly Dictionary<string, bool> GateById = new Dictionary<string, bool>();
            public readonly Dictionary<string, DealCtx> CtxById = new Dictionary<string, DealCtx>();
            public readonly List<Scored> Scored = new List<Scored>();
            public readonly List<HandInBox> Dealt = new List<HandInBox>();
            public readonly Dictionary<string, int> Claims = new Dictionary<string, int>();
            public readonly Dictionary<string, int> World = new Dictionary<string, int>();
            public readonly Dictionary<string, int> Own = new Dictionary<string, int>();
            public readonly Dictionary<string, int> Want = new Dictionary<string, int>();
            /// <summary>A deal's ask and its @hand, one at a time: an ask is
            /// done with before the next is made.</summary>
            public readonly AskDescriptor Ask = new AskDescriptor();
            public readonly OrderedMap<string, string> AskTags = new OrderedMap<string, string>();
            public readonly OrderedMap<string, string> AskNames = new OrderedMap<string, string>();
            public readonly HandEnv HandEnv;

            public DealScratch()
            {
                var bag = new OrderedMap<string, ExprValue>();
                HandEnv = new HandEnv { Bag = bag, Sources = new Dictionary<string, HandSource>(), Scope = new BagScope(bag) };
            }
        }

        private DealScratch _idleScratch = new DealScratch();

        private DealScratch TakeScratch()
        {
            var scratch = _idleScratch ?? new DealScratch();
            _idleScratch = null;
            return scratch;
        }

        private void ReleaseScratch(DealScratch scratch)
        {
            _idleScratch = scratch;
        }

        /// <summary>One outcome change, resolved and checked but not yet landed
        /// (ruling B). Path is the store location the trace reports, in the
        /// address grammar.</summary>
        private sealed class WritePlan
        {
            public string Kind;     // "host" | "bag" | "scope"
            public string Name;
            public string Path;
            public Engine.HostScopeState Host; // Kind "host"
            public PropertyBag Bag; // Kind "bag"
            public string Scope;    // Kind "scope": another engine's token
        }

        /// <summary>Truthiness for a bare condition. One line, because the rule is
        /// on the SHARED value type: the two families disagreed about it until
        /// 2026-09-01, and they share a property registry, so the same value read
        /// from the same registry must answer the same question.</summary>
        private static bool ConditionPasses(ExprValue v) => v.Truthy;

        internal static string VerdictWire(TraceVerdict v)
        {
            switch (v)
            {
                case TraceVerdict.Dealt: return "dealt";
                case TraceVerdict.Capped: return "capped";
                case TraceVerdict.Cooldown: return "cooldown";
                case TraceVerdict.DeckGate: return "deck-gate";
                case TraceVerdict.Tags: return "tags";
                case TraceVerdict.Condition: return "condition";
                case TraceVerdict.Priority: return "priority";
                case TraceVerdict.ClaimedElsewhere: return "claimed-elsewhere";
                case TraceVerdict.Taken: return "taken";
                default: return "claimed";
            }
        }

        // \z rather than $ in both grammars: a .NET `$` also matches before a
        // final newline, which JS's does not, so "@story.gold\n" was a target
        // here and a refusal there (engine review 2026-10).
        private static readonly Regex ChangeTarget = new Regex(@"^@([a-z][a-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_-]*)\z");
        private static readonly Regex BoundByRef = new Regex(@"^@(world|story)\.([a-z][a-z0-9_-]*)\z");

        private readonly Engine _engine;
        /// <summary>The flow's name - the address the host opened it under.</summary>
        public readonly string Id;
        private bool _closed;

        private Mulberry32 _prng;
        /// <summary>OrderRun's working list, kept so a deal allocates nothing to
        /// order its tie runs.</summary>
        private readonly List<Scored> _runScratch = new List<Scored>();
        /// <summary>Per-box turn counters, keyed by box id (schema 3.4), PER FLOW.</summary>
        private OrderedMap<string, double> _turnCounts = new OrderedMap<string, double>();
        private OrderedMap<string, double> _cooldowns = new OrderedMap<string, double>();
        /// <summary>The board: hand contents (card ids, dealt order), keyed by hand id.</summary>
        private OrderedMap<string, List<string>> _boardContents = new OrderedMap<string, List<string>>();
        private List<PlayRecord> _playLog = new List<PlayRecord>();
        // --- play-history indexes ------------------------------------------
        // A pure summary of _playLog, maintained where it is appended and
        // rebuilt where it is replaced. The four history host functions used
        // to SCAN the whole log on every call, once per candidate card per
        // ask, so dealing was O(candidates x play log) and a shipped game got
        // slower the longer somebody played it. Measured in the JS reference
        // (2000 cards): count_played went 0.8ms -> 27.9ms as the log reached
        // 4000 plays, and 0.8ms flat afterwards. In C# the old shape also
        // allocated a delegate and boxed an enumerator per call. Not saved:
        // the log is the record, this is derived.
        //
        // The tag keys are the played card's OWN (group id, tag id) pairs,
        // which keeps the box-local rule: a group NAME resolves inside the
        // asking box, so a card from another box carries different ids and
        // cannot match, exactly as the old per-record InTag decided.
        private Dictionary<string, int> _playCount = new Dictionary<string, int>();
        private Dictionary<string, PlayRecord> _lastPlayOf = new Dictionary<string, PlayRecord>();
        private Dictionary<string, int> _tagPlayCount = new Dictionary<string, int>();
        private Dictionary<string, PlayRecord> _lastPlayInTag = new Dictionary<string, PlayRecord>();

        /// <summary>The per-flow property partitions (the not-shared halves),
        /// each bag that declares something registered under this flow's
        /// keys.</summary>
        private Partition _stores;
        private readonly List<string> _registered = new List<string>();
        /// <summary>This flow's bags that declare something, under their
        /// registry keys.</summary>
        private readonly List<KeyValuePair<string, PropertyBag>> _bagKeys = new List<KeyValuePair<string, PropertyBag>>();

        private readonly List<Action<TraceEvent>> _traceHandlers = new List<Action<TraceEvent>>();
        private List<LogEntry> _logEntries = new List<LogEntry>();
        private long _logSeq;

        internal Flow(Engine engine, string id, double seed)
        {
            _engine = engine;
            Id = id;
            _prng = new Mulberry32(seed);
            _stores = engine.BuildFlowPartition();
            // Register the bags: each claims whatever the registry holds for its
            // key (a load); OpenFlow discarded that first for a fresh flow.
            void Put(string key, PropertyBag bag)
            {
                if (bag.Declarations().Count == 0) return; // holds nothing: not registered
                _bagKeys.Add(new KeyValuePair<string, PropertyBag>(key, bag));
            }
            Put(Engine.FlowKey(id, "story"), _stores.Story);
            foreach (var kind in Engine.OwnedScopes)
            {
                foreach (var pair in Engine.KindOf(_stores, kind)) Put(Engine.FlowKey(id, kind, pair.Key), pair.Value);
            }
            MountBags();
            foreach (var box in engine._bundle.Boxes)
            {
                _turnCounts.Set(box.Id, 0);
                foreach (var hand in box.Hands) _boardContents.Set(hand.Id, new List<string>());
            }
        }

        public bool IsClosed => _closed;

        /// <summary>Close this flow: the handle goes inert, every verb throws.</summary>
        public void Close()
        {
            if (_closed) return;
            _engine.DropFlow(Id, this);
            MarkClosed();
        }

        internal void MarkClosed()
        {
            ReleaseBags(false);
            // A closed flow never emits again, so it lets go of its handlers, as
            // every runtime does (in C++ and GDScript a handler holding the flow
            // would otherwise keep it alive).
            _traceHandlers.Clear();
            _closed = true;
        }

        /// <summary>Take this flow's bags out of the registry; with keep, their
        /// values wait there for the flow that replaces this one (a load into
        /// the game's registry). Idempotent.</summary>
        internal void ReleaseBags(bool keep)
        {
            foreach (var key in _registered) _engine._registry.Remove(key, keep);
            _registered.Clear();
        }

        /// <summary>The registry keys this flow holds right now.</summary>
        internal List<string> RegisteredKeys()
        {
            return new List<string>(_registered);
        }

        /// <summary>Register this flow's bags (again): at construction, and when a
        /// failed HotSwap hands them back. Each claims what the registry holds
        /// for it.</summary>
        internal void MountBags()
        {
            foreach (var pair in _bagKeys)
            {
                try { _engine._registry.MountOwned(pair.Key, pair.Value, Engine.OwnerLabel); }
                catch (Exception e) when (KernelErrors.Is(e)) { throw KernelErrors.As(e); }
                _registered.Add(pair.Key);
            }
        }

        private void AssertOpen()
        {
            if (_closed) throw new StoryletError($"flow \"{Id}\" is closed");
        }

        /// <summary>A box's current turn (schema 3.4), on THIS flow's clock.</summary>
        public double Turn(string boxRef)
        {
            AssertOpen();
            var box = ResolveBox(boxRef);
            return _turnCounts.GetOrDefault(box.Id);
        }

        /// <summary>Subscribe to the deal/play trace (schema 5). Returns the
        /// unsubscribe. With no subscribers the flow does no trace work at all.</summary>
        public Action SubscribeTrace(Action<TraceEvent> handler)
        {
            // Once per handler (ruling F): the same handler subscribed twice is
            // registered once, as JS's Set has it, and either unsubscribe
            // removes it. Emit delivers from a copy, so a subscribe or an
            // unsubscribe inside a handler takes effect from the next event.
            if (!_traceHandlers.Contains(handler)) _traceHandlers.Add(handler);
            return () => _traceHandlers.Remove(handler);
        }

        private bool Tracing => _traceHandlers.Count > 0 || _engine._logCap != null || _engine.EngineTracing;

        private void Emit(TraceEvent evt, double? turn = null)
        {
            if (_engine._logCap != null)
            {
                _logEntries.Add(new LogEntry { Event = evt, Seq = _logSeq++, Turn = turn });
                if (_logEntries.Count > _engine._logCap.Value)
                {
                    _logEntries.RemoveRange(0, _logEntries.Count - _engine._logCap.Value);
                }
            }
            foreach (var handler in _traceHandlers.ToArray()) handler(evt);
            _engine.EmitEngine(Id, evt, turn);
        }

        /// <summary>The retained flow log (opt-in via EngineOptions.Log),
        /// oldest first, capped. The introspection seam for hosts and tools; the
        /// durable play history in a save stays the play log (schema 4) - the log
        /// is a flow-lifetime utility and is NOT saved.</summary>
        public IReadOnlyList<LogEntry> Log()
        {
            return _logEntries;
        }

        /// <summary>Empty the retained log; Seq keeps counting, so ordering across
        /// a clear stays meaningful.</summary>
        public void ClearLog()
        {
            _logEntries = new List<LogEntry>();
        }

        // --- expression plumbing -------------------------------------------------

        // The TS flow caches deserialised nodes per { src, ast } envelope; here
        // the loader deserialises once, so Node(expr) is a plain read.
        private static ExprNode Node(Expression expr)
        {
            return expr.Ast;
        }

        /// <summary>Tag group names are box-scoped: two boxes may name a group
        /// the same way (schema 1 - boxes namespace their groups), so a name is
        /// only ever resolved inside the box being asked, never bundle-wide.
        /// Ids are project-unique and accepted here too, still confined to the
        /// box.
        ///
        /// A box on the project map sees ONE namespace: its own groups, then
        /// the map's group (design/project-map-contract.md 3.1). A box that has
        /// not opted in does not see the map's name at all, so a peek naming it
        /// there is the ordinary unknown-group refusal. Own groups first is
        /// stated for determinism only: a bundle that loads never has the two
        /// share a name.</summary>
        private TagGroup GroupInBox(Box box, string reference)
        {
            var groups = Model.GroupsOfBox(_engine._bundle, box);
            return groups.Find(g => Model.EffectiveGameId(g) == reference)
                ?? groups.Find(g => g.Id == reference);
        }

        /// <summary>A count out of one of the play indexes, 0 when absent.
        /// (OrderedMap has GetOrDefault; a plain Dictionary does not.)</summary>
        private static int CountAt(Dictionary<string, int> map, string key)
        {
            int n;
            return map.TryGetValue(key, out n) ? n : 0;
        }

        /// <summary>The play-history indexes' key for one (box, group, tag)
        /// triple.
        ///
        /// The BOX is in it because play history is box-specific
        /// (design/project-map-contract.md 3.7, D7, ruled 2026-10-01):
        /// count_played_in asks about the asking box's own plays. A box group
        /// was already box-unique, so its key never needed the box; a
        /// project-map zone is one tag every opted-in box tags its cards with,
        /// and without the box a play of a newspaper at the quay in one box
        /// would count as an encounter at the quay in another.
        ///
        /// A unit separator (U+001F) joins them: ids are letters, digits and
        /// underscores, so a control character cannot occur in one and two
        /// triples can never collide into one key.</summary>
        private static string TagKey(string boxId, string groupId, string tagId) =>
            boxId + "\u001f" + groupId + "\u001f" + tagId;

        /// <summary>Fold one play into the indexes. O(the card's tags), not
        /// O(the log).</summary>
        private void IndexPlay(PlayRecord record)
        {
            _playCount[record.Card] = CountAt(_playCount, record.Card) + 1;
            _lastPlayOf[record.Card] = record;
            var entry = _engine._cardsByGameId.GetOrDefault(record.Card);
            if (entry == null || entry.Card.Tags == null) return;
            foreach (var pair in entry.Card.Tags)
            {
                foreach (var tagId in pair.Value)
                {
                    // Keyed by the PLAYED card's box: history is box-specific (D7).
                    var key = TagKey(entry.Box.Id, pair.Key, tagId);
                    _tagPlayCount[key] = CountAt(_tagPlayCount, key) + 1;
                    _lastPlayInTag[key] = record;
                }
            }
        }

        /// <summary>Rebuild from the log, wherever it is REPLACED rather than
        /// appended to.</summary>
        private void RebuildPlayIndex()
        {
            _playCount.Clear();
            _lastPlayOf.Clear();
            _tagPlayCount.Clear();
            _lastPlayInTag.Clear();
            foreach (var record in _playLog) IndexPlay(record);
        }

        /// <summary>One host per box, built once. The delegates below read
        /// _playCount, _turnCounts and the rest LIVE, so a cached host answers
        /// with current state - which is what makes caching safe rather than a
        /// snapshot bug. Unreal did this from the start and the other three
        /// rebuilt a host, and its closure display class, on every EvalCtx:
        /// once per deck per ask, and once per surviving card in the eviction
        /// pass. Copied here 2026-08-29, lazily, so unvisited boxes cost
        /// nothing.</summary>
        private readonly Dictionary<string, StoryletsHost> _hostsByBox = new Dictionary<string, StoryletsHost>();

        private StoryletsHost Host(Box box)
        {
            StoryletsHost cached;
            if (_hostsByBox.TryGetValue(box.Id, out cached)) return cached;
            var made = MakeHost(box);
            _hostsByBox[box.Id] = made;
            return made;
        }

        /// <summary><paramref name="box"/> is the box whose ask is being
        /// evaluated: the play-history functions take a bare group name, so it
        /// resolves there, and they count only that box's own plays (the box is
        /// in the index key). That was automatic while every group was a box's;
        /// a project-map zone is shared, and its history is still not
        /// (design/project-map-contract.md 3.7, D7).</summary>
        private StoryletsHost MakeHost(Box box)
        {
            // A group NAME and tag name resolved in THIS box, as the index's
            // key, with this box in it: a zone's plays in another box are not
            // this box's history. Null when either is unknown here, which is the old
            // per-record `false` and reads as "never".
            //
            // Memoised per (group, tag) for the host's life, null answers
            // included. The answer depends only on the bundle, which a flow never
            // outlives (a hot swap builds new flows), and the lookup was a walk
            // of the box's groups and then of a group's tags, run once per
            // candidate card per ask for every count_played_in or
            // turns_since_played_in the card's condition calls.
            var keys = new Dictionary<(string, string), string>();
            string KeyOf(string group, string tag)
            {
                if (keys.TryGetValue((group, tag), out var known)) return known;
                var found = GroupInBox(box, group);
                var t = found?.Tags.Find(v => v.GameId == tag);
                var key = found == null || t == null ? null : TagKey(box.Id, found.Id, t.Id);
                keys[(group, tag)] = key;
                return key;
            }
            // Turns-since is measured on the played card's box's clock (3.4).
            double Since(PlayRecord record)
            {
                var entry = _engine._cardsByGameId.GetOrDefault(record.Card);
                if (entry == null) return StoryletsDialect.NEVER_PLAYED;
                return _turnCounts.GetOrDefault(entry.Box.Id) - record.Turn;
            }
            return new StoryletsHost
            {
                NextRandom = () => _prng.Next(),
                CountPlayed = card => CountAt(_playCount, card),
                TurnsSincePlayed = card =>
                {
                    PlayRecord last;
                    return _lastPlayOf.TryGetValue(card, out last) ? Since(last) : StoryletsDialect.NEVER_PLAYED;
                },
                CountPlayedIn = (group, tag) =>
                {
                    var key = KeyOf(group, tag);
                    return key == null ? 0 : CountAt(_tagPlayCount, key);
                },
                TurnsSincePlayedIn = (group, tag) =>
                {
                    var key = KeyOf(group, tag);
                    PlayRecord last = null;
                    if (key != null) _lastPlayInTag.TryGetValue(key, out last);
                    return last != null ? Since(last) : StoryletsDialect.NEVER_PLAYED;
                },
            };
        }

        /// <summary>@deck in a hand-condition context: an empty bag, so any
        /// reference is an eval error (missing-policy throw). It holds nothing
        /// and is never written, so one serves every flow.</summary>
        private static readonly BagScope EmptyDeckScope = new BagScope(new OrderedMap<string, ExprValue>());

        // The merged read views, built once per flow rather than once per EvalCtx
        // (the JS Flow's storyReader / boxReaders / deckReaders). EvalCtx runs
        // once per deck per ask and once more per deck in the eviction pass, and
        // each call used to allocate a PairScope per scope. Safe to hold: the
        // flow's own partition is built in the constructor and never replaced,
        // and the engine's shared partition is built once for the engine's life
        // (InitShared; a reset or a load reseeds those bags in place), so a view
        // always reads the same bags a fresh one would. Lazily per box and deck,
        // as the hosts are, so unvisited boxes cost nothing.
        private PairScope _storyScope;
        private readonly Dictionary<string, PairScope> _boxScopes = new Dictionary<string, PairScope>();
        private readonly Dictionary<string, PairScope> _deckScopes = new Dictionary<string, PairScope>();

        private PairScope StoryScope()
        {
            return _storyScope ?? (_storyScope = new PairScope { Own = _stores.Story, Shared = _engine._shared.Story });
        }

        private PairScope BoxScope(Box box)
        {
            if (_boxScopes.TryGetValue(box.Id, out var scope)) return scope;
            scope = new PairScope { Own = _stores.Box.GetOrDefault(box.Id), Shared = _engine._shared.Box.GetOrDefault(box.Id) };
            _boxScopes[box.Id] = scope;
            return scope;
        }

        private PairScope DeckScope(Deck deck)
        {
            if (_deckScopes.TryGetValue(deck.Id, out var scope)) return scope;
            scope = new PairScope { Own = _stores.Deck.GetOrDefault(deck.Id), Shared = _engine._shared.Deck.GetOrDefault(deck.Id) };
            _deckScopes[deck.Id] = scope;
            return scope;
        }

        /// <summary>The ladder behind one composed @hand name, or null when the
        /// name is not a quality (or came from criteria, which are tag names).
        /// Ladders live on the engine (declaration-level, partition-blind).</summary>
        private List<string> HandLadder(HandEnv handEnv, string name)
        {
            if (handEnv == null || !handEnv.Sources.TryGetValue(name, out var source)) return null;
            List<string> ladder = null;
            if (source.Kind == "value" && _engine._valueLadders.TryGetValue(source.Id, out var vm)) vm.TryGetValue(name, out ladder);
            else if (source.Kind == "hand" && _engine._handLadders.TryGetValue(source.Id, out var hm)) hm.TryGetValue(name, out ladder);
            return ladder;
        }

        /// <summary>The evaluation environment (schema 3.1/6.2): @box/@deck resolve
        /// to the card under evaluation; in hand-condition contexts @deck is an
        /// empty bag, so any reference is an eval error (missing-policy throw).</summary>
        private EvalContext EvalCtx(Box box, Deck deck, HandEnv handEnv)
        {
            return BuildCtx(box, deck, new DealCtx { HandEnv = handEnv }, _engine.RegistryView()).Ctx;
        }

        /// <summary>A deal's context for this box (deck null: the hand
        /// condition's) or deck, from the scratch's cache, now reading
        /// <paramref name="handEnv"/>. The same as a fresh EvalCtx: box and
        /// deck fix everything else it holds, and the registry view is checked
        /// on every fetch.</summary>
        private DealCtx CachedCtx(DealScratch scratch, Box box, Deck deck, HandEnv handEnv)
        {
            var cache = deck == null ? scratch.BoxCtx : scratch.DeckCtx;
            var key = deck == null ? box.Id : deck.Id;
            var others = _engine.RegistryView();
            if (!cache.TryGetValue(key, out var held) || held.View != others)
            {
                held = BuildCtx(box, deck, new DealCtx(), others);
                var ctx = held.Ctx;
                held.Matches = n =>
                {
                    try
                    {
                        return ConditionPasses(Expr.Evaluate(n, ctx, StoryletsDialect.Instance));
                    }
                    catch (Exception)
                    {
                        return false;
                    }
                };
                cache[key] = held;
            }
            held.HandEnv = handEnv;
            held.Ctx.Scopes["hand"] = handEnv.Scope;
            return held;
        }

        private DealCtx BuildCtx(Box box, Deck deck, DealCtx held, Engine.RegistryScopes others)
        {
            var ctx = new EvalContext { Host = Host(box) };
            held.Ctx = ctx;
            held.View = others;
            if (_engine._hasQualities || others.Qualities != null)
            {
                // The quality channel, answering for THIS ask's box and deck, and
                // for every other registered scope through the registry's own.
                var otherLadders = others.Qualities;
                ctx.Qualities = (scope, name) =>
                {
                    List<string> ladder = null;
                    if (scope == "story")
                    {
                        _engine._storyLadders.TryGetValue(name, out ladder);
                        return ladder;
                    }
                    if (scope == "box")
                    {
                        if (_engine._boxLadders.TryGetValue(box.Id, out var bm)) bm.TryGetValue(name, out ladder);
                        return ladder;
                    }
                    if (scope == "deck" && deck != null)
                    {
                        if (_engine._deckLadders.TryGetValue(deck.Id, out var dm)) dm.TryGetValue(name, out ladder);
                        return ladder;
                    }
                    if (scope == "hand") return HandLadder(held.HandEnv, name);
                    // A host scope's (@world, @player, ...), by token.
                    if (_engine._hostLadders.TryGetValue(scope, out var hm)) hm.TryGetValue(name, out ladder);
                    return ladder ?? otherLadders?.Invoke(scope, name);
                };
            }
            // Every other engine's game-wide scope first (every engine reads
            // every scope); this engine's own tokens are its merged views, over
            // the top.
            foreach (var pair in others.Scopes) ctx.Scopes[pair.Key] = pair.Value;
            // Every own scope is the flow's MERGED view - its own copies over the
            // shared values, names disjoint - and each host scope reads through
            // the registry.
            foreach (var pair in _engine._hostScopes) ctx.Scopes[pair.Key] = pair.Value.Source;
            ctx.Scopes["story"] = StoryScope();
            ctx.Scopes["box"] = BoxScope(box);
            ctx.Scopes["deck"] = deck != null ? (IScopeSource)DeckScope(deck) : EmptyDeckScope;
            ctx.Scopes["hand"] = held.HandEnv?.Scope;   // CachedCtx sets it per fetch
            return held;
        }

        private ExprValue Eval(Expression expr, EvalContext ctx)
        {
            try { return Expr.Evaluate(Node(expr), ctx, StoryletsDialect.Instance); }
            catch (Exception e) when (KernelErrors.Is(e)) { throw KernelErrors.As(e); }
        }

        /// <summary>Does a condition pass? <paramref name="kind"/> ("card",
        /// "deck", "hand" or "outcome") with <paramref name="of"/> and, for an
        /// outcome, <paramref name="outcome"/> name whose condition it is; the
        /// label is built only when an evaluation fails, so a deal that throws
        /// nothing allocates nothing for it.</summary>
        private bool Passes(Expression expr, EvalContext ctx, string kind, IIdentified of, IIdentified outcome = null)
        {
            if (expr == null) return true;
            try
            {
                return ConditionPasses(Eval(expr, ctx));
            }
            catch (Exception e)
            {
                // An eval error is never a silent pass: the card/deck is
                // unavailable (schema 3.1), and the game hears of it through
                // OnError, tracing or not; the trace carries it too.
                var at = NodeLabel(kind, of, outcome);
                _engine.ReportPlayError(new PlayError
                {
                    Flow = Id,
                    Kind = "condition",
                    Node = at,
                    Source = string.IsNullOrEmpty(expr.Src) ? null : expr.Src,
                    Message = e.Message,
                });
                if (Tracing)
                {
                    Emit(new DiagnosticEvent { Where = kind == "deck" ? $"{at} gate" : $"{at} condition", Message = e.Message });
                }
                return false;
            }
        }

        /// <summary>A PlayError's Node: `card &lt;gameId&gt;`, `deck &lt;gameId&gt;`,
        /// `hand &lt;gameId&gt;` or `outcome &lt;card gameId&gt;/&lt;outcome gameId&gt;`,
        /// as the reference names them (a card's and a deck's gameId as
        /// written, a hand's and an outcome's effective one).</summary>
        private static string NodeLabel(string kind, IIdentified of, IIdentified outcome)
        {
            switch (kind)
            {
                case "hand": return $"hand {(of != null ? Model.EffectiveGameId(of) : "")}";
                case "outcome": return $"outcome {Model.EffectiveGameId(of)}/{Model.EffectiveGameId(outcome)}";
                default: return $"{kind} {of?.GameId}";
            }
        }

        // --- resolving asks (schema 2.6 + 3.6) -----------------------------------

        private static Tag TagByGameId(TagGroup group, string gameId)
        {
            return group.Tags.Find(t => t.GameId == gameId);
        }

        // The two lookups an ask makes per binding, as loops: List.Find takes
        // a closure, and these run on every deal.
        private static Tag TagById(TagGroup group, string id)
        {
            foreach (var t in group.Tags) if (t.Id == id) return t;
            return null;
        }

        private static Tag TagByEffectiveGameId(TagGroup group, string gameId)
        {
            foreach (var t in group.Tags) if (Model.EffectiveGameId(t) == gameId) return t;
            return null;
        }

        /// <summary>Hole references and BoundBy references, parsed: {scope,
        /// name}, or null for one that is not a reference. Keyed by the
        /// reference text, which is the bundle's, so they hold for the flow's
        /// life.</summary>
        private readonly Dictionary<string, string[]> _holeParts = new Dictionary<string, string[]>();
        private readonly Dictionary<string, string[]> _boundByParts = new Dictionary<string, string[]>();

        /// <summary>A deal's ask: the hand's template bindings + chosen tags, or
        /// its rule's bindings, plus the implicit home binding (schema 2.4).
        /// With a scratch, the ask is the scratch's, good until its next
        /// ask.</summary>
        private AskDescriptor AskForHand(Hand hand, Box box, DealScratch scratch = null)
        {
            var boundTags = scratch != null ? Cleared(scratch.AskTags) : new OrderedMap<string, string>();
            var askNames = scratch != null ? Cleared(scratch.AskNames) : new OrderedMap<string, string>();
            Expression condition = null;
            if (hand.Template != null)
            {
                var template = _engine._templatesById.GetOrDefault(hand.Template);
                if (template == null)
                {
                    throw new StoryletError($"hand \"{Model.EffectiveGameId(hand)}\": unknown template \"{hand.Template}\"");
                }
                if (template.Bindings != null)
                {
                    var groups = template.Bindings.Keys;
                    for (int i = 0; i < groups.Count; i++) boundTags.Set(groups[i], template.Bindings.GetOrDefault(groups[i]));
                }
                BindHand(hand, hand.Chosen, boundTags, askNames);
                condition = template.Condition;
            }
            else
            {
                BindHand(hand, hand.Rule?.Bindings, boundTags, askNames);
                condition = hand.Rule?.Condition;
            }
            boundTags.Set(Model.PLACE_GROUP, hand.Id);
            BindStateGroups(box, boundTags, askNames);
            var ask = scratch?.Ask ?? new AskDescriptor();
            ask.Box = box;
            ask.Hand = hand;
            ask.Condition = condition;
            ask.BoundTags = boundTags;
            ask.AskNames = askNames;
            return ask;
        }

        /// <summary>The hand's own bindings: a template instance's chosen tags or
        /// a standalone hand's rule bindings, one loop for both because a card
        /// reading @hand.&lt;group&gt; must not care HOW the group was bound.
        /// Each binding is bound and named; a hole filled from a property rather
        /// than with a tag is resolved now, before tag composition (4.6).</summary>
        private void BindHand(Hand hand, OrderedMap<string, string> bindings,
            OrderedMap<string, string> boundTags, OrderedMap<string, string> askNames)
        {
            if (bindings == null) return;
            // Walked by key: an OrderedMap's enumerator allocates, and this
            // runs twice per hand per deal.
            var groups = bindings.Keys;
            for (int i = 0; i < groups.Count; i++)
            {
                var groupId = groups[i];
                var value = bindings.GetOrDefault(groupId);
                if (Model.IsHoleRef(value))
                {
                    FillHoleFromProperty(hand, groupId, value, boundTags, askNames);
                    continue;
                }
                boundTags.Set(groupId, value);
                var found = _engine._groupsById.GetOrDefault(groupId);
                var tag = found.Group != null ? TagById(found.Group, value) : null;
                if (found.Group != null && tag != null)
                {
                    askNames.Set(Model.EffectiveGameId(found.Group), Model.EffectiveGameId(tag));
                }
            }
        }

        /// <summary>A peek's ask: raw criteria ({group gameId: tag gameId}),
        /// bindings only, no condition slot (schema 3.1; the boundary, Reboot 4).</summary>
        private AskDescriptor AskForPeek(Box box, OrderedMap<string, string> criteria)
        {
            var boundTags = new OrderedMap<string, string>();
            var askNames = new OrderedMap<string, string>();
            foreach (var pair in criteria)
            {
                var groupRef = pair.Key;
                var tagRef = pair.Value;
                if (groupRef == Model.PLACE_GROUP)
                {
                    var hand = _engine._handsByGameId.GetOrDefault(tagRef) ?? _engine._handsById.GetOrDefault(tagRef);
                    if (hand == null) throw new StoryletError($"peek: unknown hand \"{tagRef}\" in home criteria");
                    boundTags.Set(Model.PLACE_GROUP, hand.Hand.Id);
                    continue;
                }
                var found = GroupInBox(box, groupRef);
                if (found == null)
                {
                    throw new StoryletError($"peek: unknown tag group \"{groupRef}\" in box \"{Model.EffectiveGameId(box)}\"");
                }
                var tag = TagByGameId(found, tagRef) ?? found.Tags.Find(t => t.Id == tagRef);
                if (tag == null)
                {
                    throw new StoryletError($"peek: unknown tag \"{tagRef}\" in group \"{Model.EffectiveGameId(found)}\"");
                }
                boundTags.Set(found.Id, tag.Id);
                askNames.Set(Model.EffectiveGameId(found), Model.EffectiveGameId(tag));
            }
            BindStateGroups(box, boundTags, askNames);
            return new AskDescriptor { Box = box, BoundTags = boundTags, AskNames = askNames };
        }

        /// <summary>Fill one hole from the property its value names: the hand
        /// that moves (design/engine-server.md 4.6).
        ///
        /// The semantics are BindStateGroups' below, word for word, applied per
        /// HOLE instead of per group: resolved at ask time, and a value naming
        /// no tag leaves the hole UNBOUND (a wildcard) with a diagnostic rather
        /// than dealing a silently empty hand. What is added is the @hand
        /// scope - the asking hand's OWN declared state, read from the flow's
        /// merged view, so a shared declaration moves the hole for every flow
        /// and a per-flow one moves it for this flow alone.
        ///
        /// Read BEFORE tag composition, which is what makes it safe: the @hand
        /// bag a card sees is built from the bound tags, so resolving a hole
        /// from it would be circular. A hand's own declarations are not.</summary>
        private void FillHoleFromProperty(Hand hand, string groupId, string reference,
            OrderedMap<string, string> boundTags, OrderedMap<string, string> askNames)
        {
            var found = _engine._groupsById.GetOrDefault(groupId);
            var groupName = found.Group != null ? Model.EffectiveGameId(found.Group) : groupId;
            // The diagnostics' text is built only when something is tracing:
            // this runs on every deal of a hand with a hole.
            string Where() => $"hand {Model.EffectiveGameId(hand)}, tag group {groupName}";
            // The reference parsed once per flow, not per ask: it is the
            // bundle's, and the parse is a regex match and three strings.
            if (!_holeParts.TryGetValue(reference, out var parts))
            {
                parts = Model.TryParseHoleRef(reference, out var parsedScope, out var parsedName)
                    ? new[] { parsedScope, parsedName }
                    : null;
                _holeParts[reference] = parts;
            }
            if (parts == null)
            {
                if (Tracing) Emit(new DiagnosticEvent { Where = Where(), Message = $"\"{reference}\" is not a @hand, @world or @story property reference" });
                return;
            }
            if (found.Group == null)
            {
                if (Tracing) Emit(new DiagnosticEvent { Where = Where(), Message = $"\"{reference}\" fills a tag group that is not in this box" });
                return;
            }
            ExprValue value = null;
            if (parts[0] == "hand")
            {
                // The merged view: the flow's own bag first, the shared bag
                // behind it. Names are disjoint, so "first" is routing.
                var own = _stores.Hand.GetOrDefault(hand.Id);
                var shared = _engine._shared.Hand.GetOrDefault(hand.Id);
                value = own?.Get(parts[1]) ?? shared?.Get(parts[1]);
            }
            else
            {
                try { value = PropertyAt(parts, null); }
                catch (StoryletError) { value = null; }
            }
            if (value == null)
            {
                if (Tracing) Emit(new DiagnosticEvent { Where = Where(), Message = $"\"{reference}\" names a property that is not declared" });
                return;
            }
            // As JS String() makes it: 2 is "2", never "2.0", and a flags list
            // is joined with "," (["act1"] is "act1"). ToString is the JSON
            // form, which quoted a list and so could never name a tag.
            var wanted = value.ToDisplayString();
            var tag = TagByEffectiveGameId(found.Group, wanted);
            if (tag == null)
            {
                if (Tracing) Emit(new DiagnosticEvent { Where = Where(), Message = $"{reference} is \"{wanted}\", which is not one of the tags of \"{groupName}\"" });
                return;
            }
            boundTags.Set(groupId, tag.Id);
            askNames.Set(groupName, Model.EffectiveGameId(tag));
        }

        /// <summary>Bind every state-bound group in the box from the property it
        /// names. Runs after the hand's own bindings and never overwrites one: an
        /// explicit binding beats a default. A value naming no tag leaves the group
        /// UNBOUND (a wildcard) with a diagnostic, because a silently empty hand
        /// reads as content that does not exist.</summary>
        private void BindStateGroups(Box box, OrderedMap<string, string> boundTags, OrderedMap<string, string> askNames)
        {
            // The box's own groups and, when it is on the project map, the
            // map's group: a BoundBy there binds in every opted-in box (3.2).
            // Model.GroupsOfBox's order, walked without the list it builds.
            foreach (var group in box.TagGroups) BindStateGroup(group, boundTags, askNames);
            var mapGroup = _engine._bundle?.Map?.Group;
            if (box.UsesMap && mapGroup != null) BindStateGroup(mapGroup, boundTags, askNames);
        }

        private void BindStateGroup(TagGroup group, OrderedMap<string, string> boundTags, OrderedMap<string, string> askNames)
        {
            if (string.IsNullOrEmpty(group.BoundBy) || boundTags.GetOrDefault(group.Id) != null) return;
            // Parsed once per flow, as a hole's reference is.
            if (!_boundByParts.TryGetValue(group.BoundBy, out var parts))
            {
                var match = BoundByRef.Match(group.BoundBy);
                parts = match.Success ? new[] { match.Groups[1].Value, match.Groups[2].Value } : null;
                _boundByParts[group.BoundBy] = parts;
            }
            if (parts == null)
            {
                if (Tracing) Emit(new DiagnosticEvent { Where = $"tag group {Model.EffectiveGameId(group)}", Message = $"boundBy \"{group.BoundBy}\" is not a @world or @story property reference" });
                return;
            }
            ExprValue value;
            try { value = PropertyAt(parts, null); }
            catch (StoryletError)
            {
                if (Tracing) Emit(new DiagnosticEvent { Where = $"tag group {Model.EffectiveGameId(group)}", Message = $"boundBy \"{group.BoundBy}\" names a property that is not declared" });
                return;
            }
            // JS String() text, as FillHoleFromProperty above.
            var wanted = value.ToDisplayString();
            var tag = TagByEffectiveGameId(group, wanted);
            if (tag == null)
            {
                if (Tracing) Emit(new DiagnosticEvent { Where = $"tag group {Model.EffectiveGameId(group)}", Message = $"{group.BoundBy} is \"{wanted}\", which is not one of its tags" });
                return;
            }
            boundTags.Set(group.Id, tag.Id);
            askNames.Set(Model.EffectiveGameId(group), Model.EffectiveGameId(tag));
        }

        // --- @hand composition (schema 3.6) ---------------------------------------

        /// <summary>With a scratch, the env is the scratch's, good until its
        /// next ask (the contexts it caches read it only while that ask
        /// runs).</summary>
        private HandEnv BuildHandEnv(AskDescriptor ask, DealScratch scratch = null)
        {
            HandEnv env;
            if (scratch != null)
            {
                env = scratch.HandEnv;
                env.Bag.Clear();
                env.Sources.Clear();
            }
            else
            {
                var fresh = new OrderedMap<string, ExprValue>();
                env = new HandEnv { Bag = fresh, Sources = new Dictionary<string, HandSource>(), Scope = new BagScope(fresh) };
            }
            env.BoundTags = ask.BoundTags;
            var bag = env.Bag;
            var sources = env.Sources;

            // 1. Tag properties of every bound tag (home binds a hand, not a
            //    tag) - the MERGED view: shared under the flow's own, names
            //    disjoint, so order is routing, not shadowing.
            //    Walked by key: an OrderedMap's enumerator allocates, and this
            //    runs twice per hand per deal.
            var bound = ask.BoundTags.Keys;
            for (int i = 0; i < bound.Count; i++)
            {
                if (bound[i] == Model.PLACE_GROUP) continue;
                var tagId = ask.BoundTags.GetOrDefault(bound[i]);
                var side = _engine._shared.Value.GetOrDefault(tagId);
                var mine = _stores.Value.GetOrDefault(tagId);
                if (side == null && mine == null) continue;
                var source = SourceOf(_valueSources, "value", tagId);
                Compose(bag, sources, side, source);
                Compose(bag, sources, mine, source);
            }
            // 2. Hand properties, when the ask is a deal.
            if (ask.Hand != null)
            {
                var side = _engine._shared.Hand.GetOrDefault(ask.Hand.Id);
                var mine = _stores.Hand.GetOrDefault(ask.Hand.Id);
                if (side != null || mine != null)
                {
                    var source = SourceOf(_handSources, "hand", ask.Hand.Id);
                    Compose(bag, sources, side, source);
                    Compose(bag, sources, mine, source);
                }
            }
            // 3. Chosen tags / criteria, by group name (the tag's gameId as value).
            var named = ask.AskNames.Keys;
            for (int i = 0; i < named.Count; i++)
            {
                bag.Set(named[i], ExprValue.Str(ask.AskNames.GetOrDefault(named[i])));
                sources[named[i]] = CriteriaSource;
            }
            return env;
        }

        // Where a @hand name routes is a (kind, id) pair and never changes,
        // so one HandSource serves every ask that composes it.
        private static readonly HandSource CriteriaSource = new HandSource { Kind = "criteria" };
        private readonly Dictionary<string, HandSource> _valueSources = new Dictionary<string, HandSource>();
        private readonly Dictionary<string, HandSource> _handSources = new Dictionary<string, HandSource>();

        private static HandSource SourceOf(Dictionary<string, HandSource> known, string kind, string id)
        {
            if (known.TryGetValue(id, out var source)) return source;
            source = new HandSource { Kind = kind, Id = id };
            known[id] = source;
            return source;
        }

        /// <summary>One side of one @hand source, laid over the bag so far.</summary>
        private static void Compose(OrderedMap<string, ExprValue> bag, Dictionary<string, HandSource> sources,
            PropertyBag side, HandSource source)
        {
            if (side == null) return;
            var names = side.Values.Keys;
            for (int i = 0; i < names.Count; i++)
            {
                bag.Set(names[i], side.Values.GetOrDefault(names[i]));
                sources[names[i]] = source;
            }
        }

        // --- the ask (schema 3.1 + 3.2) --------------------------------------------

        /// <summary>The claims ledger, derived from the board: card id -> holding
        /// hands (schema 3.5).</summary>
        private Dictionary<string, int> Claims(Dictionary<string, int> counts)
        {
            counts.Clear();
            var hands = _boardContents.Keys;
            for (int h = 0; h < hands.Count; h++)
            {
                foreach (var id in _boardContents.GetOrDefault(hands[h]))
                {
                    counts.TryGetValue(id, out var n);
                    counts[id] = n + 1;
                }
            }
            return counts;
        }

        private static Dictionary<string, int> Cleared(Dictionary<string, int> map)
        {
            map.Clear();
            return map;
        }

        private static OrderedMap<string, string> Cleared(OrderedMap<string, string> map)
        {
            map.Clear();
            return map;
        }

        /// <summary>How many hands of one flow may hold a card at once: one, or
        /// any number (AcrossHands), or a bundle from before it, its
        /// Copies.</summary>
        private static double AcrossLimit(Card card)
        {
            if (card.AcrossHands == "any") return double.PositiveInfinity;
            if (card.AcrossHands == "one") return 1;
            return card.Copies ?? 1;
        }

        /// <summary>How many slots of one hand a card may fill (InOneHand,
        /// default 1).</summary>
        private static double InOneHandOf(Card card)
        {
            return card.InOneHand ?? 1;
        }

        /// <summary>Is this card scarce across flows (design/shared-scarcity.md)?
        /// The deck says what the pile is for and the card may override it. The
        /// deck's flag hoists out of the card loop: the ask runs this per card
        /// per deal.</summary>
        internal static bool CardIsShared(Card card, bool deckShared)
        {
            return card.Shared ?? deckShared;
        }

        /// <summary>How many hands ACROSS EVERY FLOW may hold this at once;
        /// defaults to the per-flow limit (one hand, or Copies).</summary>
        internal static double SharedCap(Card card)
        {
            return card.SharedCopies ?? AcrossLimit(card);
        }

        /// <summary>Every card id on THIS flow's board, one entry per holding
        /// hand. The engine sums these across live flows for the shared
        /// ledger.</summary>
        internal IEnumerable<string> HeldCardIds()
        {
            foreach (var pair in _boardContents)
            {
                foreach (var id in pair.Value) yield return id;
            }
        }

        /// <summary>The claims step (3.1 step 6) for one card, as the verdict
        /// that refused it or null for available. Two caps apply to a shared
        /// card and they are different statements, so they get different
        /// verdicts: Copies is your own board filling up, SharedCopies is
        /// somebody else already holding it, and a participant told "claimed"
        /// about a card on another person's table would read it as a
        /// fault.
        ///
        /// `own` is what the hand being dealt holds already: those are the
        /// hand's to keep or give up as it re-ranks, so they claim nothing
        /// against it.</summary>
        private TraceVerdict? ClaimVerdict(Card card, bool shared,
            Dictionary<string, int> mine, Dictionary<string, int> world, int own = 0)
        {
            mine.TryGetValue(card.Id, out var here);
            if (here - own >= AcrossLimit(card)) return TraceVerdict.Claimed;
            if (shared)
            {
                world.TryGetValue(card.Id, out var anywhere);
                if (anywhere - own >= SharedCap(card)) return TraceVerdict.ClaimedElsewhere;
            }
            return null;
        }

        /// <summary>Tag matching (schema 3.1 step 3): for every bound group the
        /// card lists the bound tag or omits the group (wildcard); the home group
        /// inverts - a homed card requires a matching home binding (schema 2.4).</summary>
        private bool TagsMatch(Card card, OrderedMap<string, string> boundTags)
        {
            var home = card.Tags?.GetOrDefault(Model.PLACE_GROUP);
            if (home != null && home.Count > 0)
            {
                var bound = boundTags.GetOrDefault(Model.PLACE_GROUP);
                if (bound == null || !home.Contains(bound)) return false;
            }
            // Walked by key: an OrderedMap's enumerator allocates, and this
            // runs once per card per ask.
            var groups = boundTags.Keys;
            for (int i = 0; i < groups.Count; i++)
            {
                var group = groups[i];
                if (group == Model.PLACE_GROUP) continue;
                var tags = card.Tags?.GetOrDefault(group);
                if (tags == null)
                {
                    // Omission is a wildcard unless the group says otherwise.
                    if (_engine.requiredGroups.Contains(group)) return false;
                    continue;
                }
                if (!tags.Contains(boundTags.GetOrDefault(group))) return false;
            }
            return true;
        }

        /// <summary>Run one ask: availability filter then ranking. `mine` and
        /// `world` are the claims ledgers the claims step (step 6) reads per
        /// card. `trace` (when a subscriber exists) collects the per-card
        /// verdicts. `held` is the cards the hand being dealt holds: they win
        /// ties, so a re-ranking deal never swaps one for an equal, and claim
        /// nothing against it. The ranking comes back in the scratch's list,
        /// which is the caller's until it releases the scratch.</summary>
        private List<Scored> RunAsk(
            DealScratch scratch,
            AskDescriptor ask,
            Dictionary<string, int> mine,
            Dictionary<string, int> world,
            List<TraceCard> trace,
            Dictionary<string, int> held = null)
        {
            var box = ask.Box;
            var handEnv = BuildHandEnv(ask, scratch);
            var scored = scratch.Scored;
            scored.Clear();
            // Identity on the trace is by gameId (4.4), so the helper takes the
            // CARD rather than an id: every call site had one in hand, and
            // taking the id was the whole of how the two vocabularies got mixed.
            void Verdict(Card card, TraceVerdict v)
            {
                trace?.Add(new TraceCard { Id = Model.EffectiveGameId(card), Verdict = v });
            }

            // The hand's condition: ask-constant, evaluated once (schema 3.1 step 4).
            if (!Passes(ask.Condition, CachedCtx(scratch, box, null, handEnv).Ctx, "hand", ask.Hand))
            {
                return scored;
            }

            // Deck gates: evaluated once per ask, in deck (id) order (schema 2.5).
            var gateOk = scratch.Gates;
            gateOk.Clear();
            foreach (var deck in box.Decks)
            {
                gateOk.Add(Passes(deck.Condition, CachedCtx(scratch, box, deck, handEnv).Ctx, "deck", deck));
            }

            var turn = _turnCounts.GetOrDefault(box.Id);
            for (int d = 0; d < box.Decks.Count; d++)
            {
                var deck = box.Decks[d];
                // ONE context per deck, not per card: box, deck and handEnv do not
                // vary inside this loop, and a condition is a read-only gate
                // (schema 3.1). Rebuilding it per card cost an EvalContext, a
                // scopes dictionary and five BagScopes each time - about half the
                // garbage a peek over a large box produced. Reference:
                // engine.ts runAsk, and storylets-new/design/port-review-2026-08.md.
                // Since 2026-10-28 the context itself is cached across asks
                // (CachedCtx), and only pointed at this ask's @hand.
                var deckCtx = CachedCtx(scratch, box, deck, handEnv);
                var ctx = deckCtx.Ctx;
                var deckShared = deck.Shared ?? false;
                foreach (var card in deck.Cards)
                {
                    var shared = CardIsShared(card, deckShared);
                    if (!gateOk[d])
                    {
                        Verdict(card, TraceVerdict.DeckGate);
                        continue;
                    }
                    // Taken out of the world by somebody's shared one-shot.
                    // Checked before this flow's own clock, because "cooldown"
                    // would point the reader at a turn counter that has nothing
                    // to do with it.
                    if (shared && _engine.IsTaken(card.Id))
                    {
                        Verdict(card, TraceVerdict.Taken);
                        continue;
                    }
                    if (_cooldowns.GetOrDefault(card.Id) > turn)
                    {
                        Verdict(card, TraceVerdict.Cooldown);
                        continue;
                    }
                    if (!TagsMatch(card, handEnv.BoundTags))
                    {
                        Verdict(card, TraceVerdict.Tags);
                        continue;
                    }
                    // The label is only built when an eval THROWS, so
                    // interpolating it per card would be waste on the path that
                    // matters.
                    if (card.Condition != null && !Passes(card.Condition, ctx, "card", card))
                    {
                        Verdict(card, TraceVerdict.Condition);
                        continue;
                    }
                    // Claims, last (schema 3.1 step 6).
                    var refused = ClaimVerdict(card, shared, mine, world,
                        held != null && held.TryGetValue(card.Id, out var mineHere) ? mineHere : 0);
                    if (refused.HasValue)
                    {
                        Verdict(card, refused.Value);
                        continue;
                    }

                    double priority;
                    if (card.PriorityExpr == null)
                    {
                        priority = card.PriorityNumber ?? 0;
                    }
                    else
                    {
                        try
                        {
                            var v = Eval(card.PriorityExpr, ctx);
                            // NaN is a number and no rank to a sort (ruling G):
                            // Inf - Inf, an overflow or a host value gets here.
                            if (!v.IsNumber || double.IsNaN(v.AsNumber))
                            {
                                Verdict(card, TraceVerdict.Priority);
                                continue;
                            }
                            priority = v.AsNumber;
                        }
                        catch (Exception e)
                        {
                            if (Tracing)
                            {
                                Emit(new DiagnosticEvent { Where = $"card {card.GameId} priority", Message = e.Message });
                            }
                            Verdict(card, TraceVerdict.Priority);
                            continue;
                        }
                    }
                    double spec = 0;
                    if (box.Ranking.Specificity && card.Condition != null)
                    {
                        spec = Specificity.MatchedSpecificity(Node(card.Condition), deckCtx.Matches);
                    }
                    scored.Add(new Scored { Card = card, Priority = priority, Spec = spec, Index = scored.Count });
                }
            }

            // STABLE sort: List<T>.Sort is not, so the scored order is its
            // last key (ByRank), in place of LINQ's OrderBy and its copies.
            scored.Sort(ByRank);
            // Each maximal tie run in the order a deal takes it; runs of 1
            // consume no draws. Held cards first, in the order they were
            // scored; then the rest, shuffled, or drawn by weight when their
            // weights differ. Held cards take no draws, so a deal draws what it
            // always drew.
            int i = 0;
            while (i < scored.Count)
            {
                int j = i + 1;
                while (j < scored.Count
                    && scored[j].Priority == scored[i].Priority
                    && scored[j].Spec == scored[i].Spec) j++;
                if (j - i > 1) OrderRun(scored, i, j, held);
                i = j;
            }
            if (trace != null)
            {
                foreach (var s in scored)
                {
                    trace.Add(new TraceCard { Id = Model.EffectiveGameId(s.Card), Verdict = TraceVerdict.Dealt, Priority = s.Priority, Specificity = s.Spec });
                }
            }
            return scored;
        }

        /// <summary>One run of equally ranked cards, scored[from..to), put in
        /// the order a deal takes them (the hands-on review, 2026-10, rulings 1
        /// and 4). Cards the hand already holds come first, in the order they
        /// were scored, so a re-ranking deal never swaps one for an equal. The
        /// rest are shuffled, as runs always were, when their weights are all
        /// equal; otherwise drawn by weight, one draw per place but the last:
        /// each place takes the card whose share of the remaining weight the
        /// draw falls in, walking the remaining cards in scored order. Both
        /// forms draw (rest - 1) numbers, held cards none, so unweighted
        /// content deals exactly as it did. Reordered through one scratch list
        /// the flow keeps, so a deal allocates nothing for it.</summary>
        private void OrderRun(List<Scored> scored, int from, int to, Dictionary<string, int> held)
        {
            var run = _runScratch;
            run.Clear();
            if (held != null && held.Count > 0)
            {
                for (int k = from; k < to; k++) if (held.ContainsKey(scored[k].Card.Id)) run.Add(scored[k]);
            }
            int first = run.Count;
            for (int k = from; k < to; k++)
            {
                if (first == 0 || !held.ContainsKey(scored[k].Card.Id)) run.Add(scored[k]);
            }
            int rest = run.Count - first;
            bool weighted = false;
            if (rest > 1)
            {
                var w0 = run[first].Card.Weight ?? 1;
                for (int k = first + 1; k < run.Count && !weighted; k++) weighted = (run[k].Card.Weight ?? 1) != w0;
            }
            if (weighted)
            {
                // Place p takes a draw over run[p..]; what is left keeps its
                // scored order, as the reference's splice leaves it.
                for (int p = first; p < run.Count - 1; p++)
                {
                    double total = 0;
                    for (int k = p; k < run.Count; k++) total += run[k].Card.Weight ?? 1;
                    double r = _prng.Next() * total;
                    int at = p;
                    while (at < run.Count - 1 && r >= (run[at].Card.Weight ?? 1))
                    {
                        r -= run[at].Card.Weight ?? 1;
                        at++;
                    }
                    var picked = run[at];
                    for (int k = at; k > p; k--) run[k] = run[k - 1];
                    run[p] = picked;
                }
            }
            else if (rest > 1)
            {
                // The contractual shuffle (schema 3.3), over the rest alone.
                for (int k = rest - 1; k > 0; k--)
                {
                    int m = (int)Math.Floor(_prng.Next() * (k + 1));
                    var tmp = run[first + k];
                    run[first + k] = run[first + m];
                    run[first + m] = tmp;
                }
            }
            for (int k = 0; k < run.Count; k++) scored[from + k] = run[k];
        }

        /// <summary>Flip eligible-but-not-taken trace entries to "capped".
        /// `taken` is keyed by GAMEID, as the trace rows are (4.4): the two must
        /// move together or every dealt card silently reads as capped.</summary>
        private static void CapTrace(List<TraceCard> trace, HashSet<string> taken)
        {
            foreach (var entry in trace)
            {
                if (entry.Verdict == TraceVerdict.Dealt && !taken.Contains(entry.Id)) entry.Verdict = TraceVerdict.Capped;
            }
        }

        private static DealtCard View(CardEntry entry) => View(entry.Card);

        private static DealtCard View(Card card)
        {
            return new DealtCard
            {
                Id = card.Id,
                GameId = Model.EffectiveGameId(card),
                Title = card.Title,
                Purpose = card.Purpose,
                // Fields are copied: the game may change what it is handed, and
                // the bundle's own maps are every later deal's (the hands-on
                // review, 2026-10, foundation 6). Extension values are NOT: they
                // are the extension runtime's data, read-only by contract, and
                // can be large (a family ruling, 2026-10-28, as Patter's).
                Fields = Handed.Fields(card.Fields),
                Extensions = card.Extensions,
            };
        }

        private double HandCapacity(Hand hand)
        {
            if (hand.Slots != null) return hand.Slots.Value;
            double? declared = hand.Template != null
                ? _engine._templatesById.GetOrDefault(hand.Template)?.Slots
                : hand.Rule?.Slots;
            return declared == null || double.IsPositiveInfinity(declared.Value)
                ? double.PositiveInfinity
                : declared.Value;
        }

        /// <summary>A box by gameId or id, as every verb that names one takes
        /// it; throws on an unknown box.</summary>
        private Box ResolveBox(string boxRef)
        {
            var box = _engine._boxesByGameId.GetOrDefault(boxRef) ?? _engine._boxesById.GetOrDefault(boxRef);
            if (box == null) throw new StoryletError($"unknown box \"{boxRef}\"");
            return box;
        }

        private HandInBox ResolveHand(string handRef)
        {
            var found = _engine._handsByGameId.GetOrDefault(handRef) ?? _engine._handsById.GetOrDefault(handRef);
            if (found == null) throw new StoryletError($"unknown hand \"{handRef}\"");
            return found;
        }

        // --- host surface (schema 5) -----------------------------------------------

        /// <summary>Look at the top of the stock through raw tag criteria (schema
        /// 3.1): claims respected, nothing registered, nothing left behind but the
        /// trace line. You can never play a card you only peeked.</summary>
        public RankedList Peek(string boxRef, OrderedMap<string, string> criteria = null, int? n = null)
        {
            AssertOpen();
            criteria = criteria ?? new OrderedMap<string, string>();
            var box = ResolveBox(boxRef);
            var ask = AskForPeek(box, criteria);
            var scratch = TakeScratch();
            var claimCounts = Claims(scratch.Claims);
            // Skipped outright when the bundle shares nothing, which is most
            // bundles: the ledger walks every live flow's whole board, and an
            // empty map answers every question the same way.
            var worldClaims = _engine._hasShared ? _engine.SharedClaims() : Cleared(scratch.World);
            var trace = Tracing ? new List<TraceCard>() : null;
            // A peek consumes NO draws (ruling A, 2026-10-06): its tie shuffle
            // and any random() in a condition run on a throwaway COPY of the
            // flow's generator, so looking at the stock any number of times
            // leaves the next deal exactly as it was, and the peek still answers
            // as a deal would now. The host's NextRandom reads _prng live, which
            // is what the swap relies on.
            var own = _prng;
            _prng = new Mulberry32(own.State);
            try
            {
                List<Scored> ordered;
                try
                {
                    ordered = RunAsk(scratch, ask, claimCounts, worldClaims, trace);
                }
                finally
                {
                    _prng = own;
                }
                var count = n == null ? ordered.Count : Math.Min(Math.Max(n.Value, 0), ordered.Count);
                if (trace != null)
                {
                    var listedIds = new HashSet<string>();
                    for (int i = 0; i < count; i++) listedIds.Add(Model.EffectiveGameId(ordered[i].Card));
                    CapTrace(trace, listedIds);
                    Emit(new PeekEvent { Box = Model.EffectiveGameId(box), Criteria = criteria, Cards = trace }, _turnCounts.GetOrDefault(box.Id));
                }
                var cards = new List<DealtCard>(count);
                for (int i = 0; i < count; i++) cards.Add(View(ordered[i].Card));
                return new RankedList { Box = Model.EffectiveGameId(box), Cards = cards };
            }
            finally
            {
                ReleaseScratch(scratch);
            }
        }

        /// <summary>Refresh one hand (schema 3.5); returns its new shape.</summary>
        public List<DealtCard> Deal(string handRef)
        {
            AssertOpen();
            var found = ResolveHand(handRef);
            return DealMany(new[] { handRef }).GetOrDefault(Model.EffectiveGameId(found.Hand)) ?? new List<DealtCard>();
        }

        /// <summary>Drop the cards a hand holds that are no longer available to
        /// it, as a deal does before it fills, and add to `evicted` (when given)
        /// which went and why: the deal's first pass, and the load's check of
        /// what it put back (<see cref="DropUnqualified"/>).</summary>
        private void EvictUnavailable(DealScratch scratch, Hand hand, Box box, List<EvictEvent> evicted)
        {
            var ask = AskForHand(hand, box, scratch);
            var handEnv = BuildHandEnv(ask, scratch);
            var conditionOk = Passes(ask.Condition, CachedCtx(scratch, box, null, handEnv).Ctx, "hand", hand);
            var gateOk = scratch.GateById;
            gateOk.Clear();
            // ONE context per deck, serving the gate and then every held card
            // of that deck, rather than a fresh one per surviving card: box,
            // deck and handEnv do not vary, and a condition is a read-only
            // gate (schema 3.1), as RunAsk's per-deck context already relies on.
            var deckCtx = scratch.CtxById;
            deckCtx.Clear();
            foreach (var deck in box.Decks)
            {
                var held = CachedCtx(scratch, box, deck, handEnv);
                deckCtx[deck.Id] = held;
                gateOk[deck.Id] = Passes(deck.Condition, held.Ctx, "deck", deck);
            }
            var turn = _turnCounts.GetOrDefault(box.Id);
            // The card is named by gameId (4.4). A card the build no longer
            // has - the "vanished" branch below - has no gameId left, so it
            // is named by the id the board carries, which is the rule a load
            // report has always used for the same reason.
            bool Evict(string cardId, string reason)
            {
                if (evicted != null)
                {
                    var known = _engine._cardsById.GetOrDefault(cardId);
                    evicted.Add(new EvictEvent
                    {
                        Hand = Model.EffectiveGameId(hand),
                        Card = known != null ? Model.EffectiveGameId(known.Card) : cardId,
                        Reason = reason,
                    });
                }
                return false;
            }
            bool Survives(string cardId)
            {
                if (!conditionOk) return Evict(cardId, "hand-condition");
                var entry = _engine._cardsById.GetOrDefault(cardId);
                if (entry == null) return Evict(cardId, "vanished");   // edited content: dropped
                // Its deck is in ANOTHER box now (a load, resume or hot swap
                // into an edited build): gone from this hand's box, as a
                // deleted card is (ruling D). Before the gate and context
                // lookups below, which are keyed by this box's decks and
                // threw on it.
                if (entry.Box.Id != box.Id) return Evict(cardId, "vanished");
                if (!gateOk[entry.Deck.Id]) return Evict(cardId, VerdictWire(TraceVerdict.DeckGate));
                // Taken out of the world by somebody's shared one-shot (ruling
                // C): checked where the fill checks it, after the gate and
                // before this flow's own clock, so a card one playthrough
                // holds goes once another has spent it, as a cooldown evicts.
                if (CardIsShared(entry.Card, entry.Deck.Shared ?? false) && _engine.IsTaken(cardId))
                {
                    return Evict(cardId, VerdictWire(TraceVerdict.Taken));
                }
                if (_cooldowns.GetOrDefault(cardId) > turn) return Evict(cardId, VerdictWire(TraceVerdict.Cooldown));
                if (!TagsMatch(entry.Card, handEnv.BoundTags)) return Evict(cardId, VerdictWire(TraceVerdict.Tags));
                // No condition passes outright, which is what Passes answers
                // for null. The label is only built when an eval THROWS.
                if (entry.Card.Condition == null) return true;
                if (!Passes(entry.Card.Condition, deckCtx[entry.Deck.Id].Ctx, "card", entry.Card))
                {
                    return Evict(cardId, VerdictWire(TraceVerdict.Condition));
                }
                return true;
            }
            // A board list is never changed in place (a change sets a new
            // one), so a hand that loses nothing keeps its list, and only one
            // that loses a card is given a new one.
            var contents = _boardContents.GetOrDefault(hand.Id);
            if (contents == null)
            {
                _boardContents.Set(hand.Id, new List<string>());
                return;
            }
            List<string> survivors = null;
            for (int i = 0; i < contents.Count; i++)
            {
                if (Survives(contents[i]))
                {
                    survivors?.Add(contents[i]);
                }
                else if (survivors == null)
                {
                    survivors = new List<string>(contents.Count);
                    for (int k = 0; k < i; k++) survivors.Add(contents[k]);
                }
            }
            if (survivors != null) _boardContents.Set(hand.Id, survivors);
        }

        /// <summary>After a load puts this flow's board back, drop every held
        /// card that no longer qualifies, as a deal would (the hands-on review,
        /// 2026-10, foundation 7: a save from before a content edit could put
        /// back a card whose condition is now false, and nothing said so).
        /// Every hand, in id order, on a copy of the flow's generator, so the
        /// check draws nothing and the next deal is exactly what it would have
        /// been. Each entry is named by hand and card Game ID; Flow is left for
        /// the caller.</summary>
        internal List<LoadEviction> DropUnqualified()
        {
            var own = _prng;
            _prng = new Mulberry32(own.State);
            var scratch = TakeScratch();
            try
            {
                var handIds = new List<string>(_engine._handsById.Keys);
                handIds.Sort(StringComparer.Ordinal);
                var evicted = new List<EvictEvent>();
                foreach (var handId in handIds)
                {
                    var found = _engine._handsById.GetOrDefault(handId);
                    EvictUnavailable(scratch, found.Hand, found.Box, evicted);
                }
                return evicted.Select(e => new LoadEviction { Hand = e.Hand, Card = e.Card, Reason = e.Reason }).ToList();
            }
            finally
            {
                ReleaseScratch(scratch);
                _prng = own;
            }
        }

        /// <summary>Re-deal several / all hands (schema 3.5): seeded hand-order
        /// shuffle (fairness), evict, seed the ledger from survivors, fill in
        /// order. Returns the dealt slice - the new contents of exactly the hands
        /// this call dealt, keyed by hand gameId (Board() stays the whole-board
        /// read).</summary>
        public OrderedMap<string, List<DealtCard>> DealMany(IReadOnlyList<string> handRefs = null)
        {
            AssertOpen();
            var scratch = TakeScratch();
            try
            {
                return DealMany(scratch, handRefs);
            }
            finally
            {
                ReleaseScratch(scratch);
            }
        }

        /// <summary>Every hand in id order, resolved as a deal names them: what
        /// DealMany() deals, worked out once, since the bundle's hands never
        /// change under a flow.</summary>
        private List<HandInBox> _everyHand;

        private OrderedMap<string, List<DealtCard>> DealMany(DealScratch scratch, IReadOnlyList<string> handRefs)
        {
            var dealt = scratch.Dealt;
            dealt.Clear();
            if (handRefs != null)
            {
                for (int i = 0; i < handRefs.Count; i++) dealt.Add(ResolveHand(handRefs[i]));
            }
            else
            {
                if (_everyHand == null)
                {
                    var ids = new List<string>(_engine._handsById.Keys);
                    ids.Sort(StringComparer.Ordinal);
                    var every = new List<HandInBox>(ids.Count);
                    foreach (var id in ids) every.Add(ResolveHand(id));
                    _everyHand = every;
                }
                dealt.AddRange(_everyHand);
            }
            Prng.ShuffleInPlace(dealt, _prng);

            // Eviction first: drop dealt cards no longer available to their hand
            // (minus the claims check against their own seat). Trace events fire
            // after the state they report has landed (a handler reading the board
            // sees the eviction), so they are collected per hand and emitted once
            // its survivors are set. One list for the whole deal, and none at
            // all when nothing is tracing.
            var evicted = Tracing ? new List<EvictEvent>() : null;
            foreach (var handInBox in dealt)
            {
                EvictUnavailable(scratch, handInBox.Hand, handInBox.Box, evicted);
                if (evicted != null && evicted.Count > 0)
                {
                    var turn = _turnCounts.GetOrDefault(handInBox.Box.Id);
                    foreach (var e in evicted) Emit(e, turn);
                    evicted.Clear();
                }
            }

            var claimCounts = Claims(scratch.Claims);
            // Taken once for the whole batch and kept in step with the local
            // ledger below, so two hands in the SAME deal cannot both take the
            // last shared copy.
            // Skipped outright when the bundle shares nothing, which is most
            // bundles: the ledger walks every live flow's whole board, and an
            // empty map answers every question the same way.
            var worldClaims = _engine._hasShared ? _engine.SharedClaims() : Cleared(scratch.World);
            // Per hand, cleared rather than rebuilt: what the hand holds, and how
            // many of each card it takes.
            var own = scratch.Own;
            var want = scratch.Want;
            foreach (var handInBox in dealt)
            {
                var hand = handInBox.Hand;
                var box = handInBox.Box;
                // A deal makes the hand right (the hands-on review, 2026-10,
                // ruling 1): it ranks everything eligible, the cards it holds
                // included, and the hand becomes the top of that ranking, full or
                // not. A held card wins a tie, so an equal card never displaces
                // it; one a better card displaces goes back to the stock,
                // "outranked".
                var held = _boardContents.GetOrDefault(hand.Id) ?? new List<string>();
                own.Clear();
                foreach (var id in held)
                {
                    own.TryGetValue(id, out var n);
                    own[id] = n + 1;
                }
                var ask = AskForHand(hand, box, scratch);
                var trace = Tracing ? new List<TraceCard>() : null;
                // At most InOneHand times in this hand; in one hand of this flow
                // at a time unless the card says any (or, from an older bundle,
                // Copies); at most SharedCopies hands anywhere (schema 3.5,
                // shared-scarcity 5).
                var ordered = RunAsk(scratch, ask, claimCounts, worldClaims, trace, own);
                // The top of the ranking, each card as many times as one hand may hold it.
                want.Clear();
                var room = HandCapacity(hand);
                int size = 0;
                foreach (var e in ordered)
                {
                    if (room <= 0) break;
                    var n = (int)Math.Min(InOneHandOf(e.Card), room);
                    want[e.Card.Id] = n;
                    room -= n;
                    size += n;
                }
                // Held cards keep their places; newcomers follow, in rank order.
                var next = new List<string>(size);
                List<string> outranked = null;
                foreach (var id in held)
                {
                    if (want.TryGetValue(id, out var n) && n > 0)
                    {
                        next.Add(id);
                        want[id] = n - 1;
                    }
                    else if (trace != null)
                    {
                        (outranked ?? (outranked = new List<string>())).Add(id);
                    }
                }
                foreach (var e in ordered)
                {
                    if (!want.TryGetValue(e.Card.Id, out var n)) continue;
                    for (; n > 0; n--) next.Add(e.Card.Id);
                    want.Remove(e.Card.Id);
                }
                _boardContents.Set(hand.Id, next);
                foreach (var id in held)
                {
                    claimCounts[id] = (claimCounts.TryGetValue(id, out var c) ? c : 1) - 1;
                    worldClaims[id] = (worldClaims.TryGetValue(id, out var w) ? w : 1) - 1;
                }
                foreach (var id in next)
                {
                    claimCounts.TryGetValue(id, out var c);
                    claimCounts[id] = c + 1;
                    worldClaims.TryGetValue(id, out var w);
                    worldClaims[id] = w + 1;
                }
                // Emitted after the hand is set: a handler reading Board() sees the deal.
                if (trace != null)
                {
                    var turn = _turnCounts.GetOrDefault(box.Id);
                    if (outranked != null)
                    {
                        foreach (var id in outranked)
                        {
                            Emit(new EvictEvent
                            {
                                Hand = Model.EffectiveGameId(hand),
                                Card = Model.EffectiveGameId(_engine._cardsById.GetOrDefault(id).Card),
                                Reason = "outranked",
                            }, turn);
                        }
                    }
                    var nextIds = new HashSet<string>();
                    foreach (var id in next) nextIds.Add(Model.EffectiveGameId(_engine._cardsById.GetOrDefault(id).Card));
                    CapTrace(trace, nextIds);
                    Emit(new DealEvent { Hand = Model.EffectiveGameId(hand), Cards = trace }, turn);
                }
            }

            var result = new OrderedMap<string, List<DealtCard>>();
            foreach (var handInBox in dealt)
            {
                var ids = _boardContents.GetOrDefault(handInBox.Hand.Id);
                var cards = new List<DealtCard>(ids?.Count ?? 0);
                if (ids != null)
                {
                    foreach (var id in ids) cards.Add(View(_engine._cardsById.GetOrDefault(id)));
                }
                result.Set(Model.EffectiveGameId(handInBox.Hand), cards);
            }
            // Keyed as the reference's object is (ruling E): an integer-like
            // hand gameId first.
            return Model.InJsKeyOrder(result);
        }

        /// <summary>The board: current hand contents, in dealt order, keyed by
        /// hand gameId (schema 5). Read it for what is out; peek the stock for
        /// what could come.</summary>
        public OrderedMap<string, List<DealtCard>> Board()
        {
            AssertOpen();
            return BoardOf(null);
        }

        /// <summary>The board narrowed to one box's hands (by box gameId or
        /// id), same shape and same order: "give me the barks hands" is a
        /// common host query, and boxes are how a game separates its storylet
        /// systems, so the grouping belongs here rather than in every host.
        /// Throws on an unknown box, as Turn and Peek do.</summary>
        public OrderedMap<string, List<DealtCard>> Board(string boxRef)
        {
            AssertOpen();
            var box = ResolveBox(boxRef);
            return BoardOf(box.Id);
        }

        private OrderedMap<string, List<DealtCard>> BoardOf(string boxId)
        {
            var result = new OrderedMap<string, List<DealtCard>>();
            foreach (var pair in _boardContents)
            {
                var handInBox = _engine._handsById.GetOrDefault(pair.Key);
                if (boxId != null && handInBox.Box.Id != boxId) continue;
                result.Set(Model.EffectiveGameId(handInBox.Hand), pair.Value.Select(id => View(_engine._cardsById.GetOrDefault(id))).ToList());
            }
            return Model.InJsKeyOrder(result);   // as DealMany (ruling E)
        }

        /// <summary>Resolve a played/inspected card within a hand on the board.</summary>
        private (CardEntry Entry, AskDescriptor Ask) ResolveDealt(string cardId, string handRef)
        {
            var entry = _engine._cardsById.GetOrDefault(cardId) ?? _engine._cardsByGameId.GetOrDefault(cardId);
            if (entry == null) throw new StoryletError($"unknown card \"{cardId}\"");
            var found = ResolveHand(handRef);
            var contents = _boardContents.GetOrDefault(found.Hand.Id) ?? new List<string>();
            if (!contents.Contains(entry.Card.Id))
            {
                throw new StoryletError(
                    $"card \"{Model.EffectiveGameId(entry.Card)}\" is not dealt to hand \"{Model.EffectiveGameId(found.Hand)}\"");
            }
            return (entry, AskForHand(found.Hand, found.Box));
        }

        /// <summary>Outcome availability, evaluated against CURRENT state on every
        /// ask (schema 3.1/5) - never a deal-time snapshot.</summary>
        public List<OutcomeView> Outcomes(string cardId, string from)
        {
            AssertOpen();
            var (entry, ask) = ResolveDealt(cardId, from);
            var ctx = EvalCtx(entry.Box, entry.Deck, BuildHandEnv(ask));
            return entry.Card.Outcomes.Select(o => new OutcomeView
            {
                Id = o.Id,
                GameId = Model.EffectiveGameId(o),
                Title = o.Title,
                Purpose = o.Purpose,
                Fields = Handed.Fields(o.Fields),
                Extensions = o.Extensions,   // read-only, as a dealt card's
                Available = Passes(o.Condition, ctx, "outcome", entry.Card, o),
            }).ToList();
        }

        /// <summary>Apply an outcome (schema 3.7): the card must sit in a hand on
        /// the board (you never play a card from inside the deck). All-or-nothing:
        /// throws before any mutation on a gated-shut outcome or a refused write
        /// target, and a refusal changes nothing at all (ruling B).
        ///
        /// A card with NO outcomes is played with none, named as "" (the
        /// no-outcome-play brief, 2026-09-14): a masthead, a notice, a codex
        /// entry, whose play means "shown". It is everything a play is except
        /// the writes: the play log and the history functions count it, the
        /// box's turn moves by the usual rule, the redraw rests it and it leaves
        /// its hand. "" is the one spelling in all four runtimes, because a
        /// Blueprint pin cannot be absent. Only the empty-for-empty case is new:
        /// "" on a card that has outcomes is refused, and a named outcome on a
        /// card with none is refused as before.</summary>
        public void Play(string cardId, string outcomeGameId, string from, PlayOptions opts = null)
        {
            AssertOpen();
            opts = opts ?? new PlayOptions();
            var (entry, ask) = ResolveDealt(cardId, from);
            var bare = outcomeGameId == "";
            if (bare && entry.Card.Outcomes.Count > 0)
            {
                throw new StoryletError($"card \"{Model.EffectiveGameId(entry.Card)}\" has outcomes ({string.Join(", ", entry.Card.Outcomes.Select(o => Model.EffectiveGameId(o)))}); name the one played");
            }
            var outcome = bare ? null : entry.Card.Outcomes.Find(o => Model.EffectiveGameId(o) == outcomeGameId);
            if (!bare && outcome == null)
            {
                throw new StoryletError($"card \"{Model.EffectiveGameId(entry.Card)}\" has no outcome \"{outcomeGameId}\"");
            }

            var handEnv = BuildHandEnv(ask);
            var ctx = EvalCtx(entry.Box, entry.Deck, handEnv);
            if (outcome != null && !Passes(outcome.Condition, ctx, "outcome", entry.Card, outcome))
            {
                throw new StoryletError($"outcome \"{outcomeGameId}\" on \"{Model.EffectiveGameId(entry.Card)}\" is gated shut");
            }

            // The played card's box's clock advances (schema 3.4); computed up
            // front so the play and its writes log as one action, one turn stamp.
            //
            // A TIMED box (design/engine-server.md 4.8) defaults to advancing
            // NOTHING: its clock is time, the host ticks it, and a play is not a
            // tick. A call that names AdvanceTurns still gets what it asked for,
            // in either kind of box, because the call says otherwise. This is the
            // whole of turn's effect on the engine: the seconds are never read.
            var perPlay = entry.Box.Turn != null ? 0 : _engine._bundle.Settings.PlayAdvancesTurns;
            var newTurn = _turnCounts.GetOrDefault(entry.Box.Id) + (opts.AdvanceTurns ?? perPlay);

            // A play is ALL-OR-NOTHING (ruling B, 2026-10-06). Every target is
            // resolved and checked first, so a refusal the engine can know in
            // advance lands nothing and emits nothing; then every right-hand side
            // evaluates against PRE-play state (schema 3.7); then the writes land.
            // A refusal only the landing can meet puts back what the earlier
            // writes replaced. The write events fire once all of them have landed.
            // A bare play (no outcome) has nothing to write.
            var changes = outcome?.Changes ?? new OrderedMap<string, Expression>();
            var plans = new List<WritePlan>();
            foreach (var change in changes) plans.Add(PlanWrite(change.Key, entry, handEnv));
            var values = new List<ExprValue>();
            foreach (var change in changes) values.Add(Eval(change.Value, ctx));
            var prevs = new List<ExprValue>();
            try
            {
                for (int i = 0; i < plans.Count; i++) prevs.Add(LandWrite(plans[i], values[i]));
            }
            catch
            {
                for (int i = prevs.Count - 1; i >= 0; i--) UndoWrite(plans[i], prevs[i]);
                throw;
            }
            if (Tracing)
            {
                int i = 0;
                foreach (var change in changes)
                {
                    Emit(new WriteEvent { Target = change.Key, Path = plans[i].Path, Value = values[i], Prev = prevs[i] }, newTurn);
                    i++;
                }
            }

            var outcomeId = outcome != null ? Model.EffectiveGameId(outcome) : "";
            var record = new PlayRecord { Card = Model.EffectiveGameId(entry.Card), Outcome = outcomeId, Turn = newTurn };
            _playLog.Add(record);
            IndexPlay(record);
            if (entry.Card.Redraw.IsNever)
            {
                // A shared one-shot leaves the WORLD rather than this flow. A
                // finite redraw deliberately does not share, whatever the deck
                // says: a cooldown is an absolute turn of this flow's box clock
                // and there is no shared clock to compare it against
                // (design/shared-scarcity.md 9.3.2).
                if (CardIsShared(entry.Card, entry.Deck.Shared ?? false)) _engine.MarkTaken(entry.Card.Id);
                else _cooldowns.Set(entry.Card.Id, Model.MAX_SAFE_INTEGER);
            }
            else if (entry.Card.Redraw.Turns != null)
            {
                _cooldowns.Set(entry.Card.Id, newTurn + entry.Card.Redraw.Turns.Value);
            }
            // The card leaves its hand, releasing its claim (schema 3.5/3.7):
            // one copy, for a card the hand holds more than once (InOneHand).
            RemoveOne(ask.Hand.Id, entry.Card.Id);
            _turnCounts.Set(entry.Box.Id, newTurn);
            // Emitted last: a handler reading the board and the clock sees the play.
            if (Tracing)
            {
                Emit(new PlayEvent { Card = Model.EffectiveGameId(entry.Card), Outcome = outcomeId, Turn = newTurn }, newTurn);
            }
        }

        /// <summary>Take a card out of a hand without playing it: the player
        /// turned it down, or the game wants the room (the hands-on review,
        /// 2026-10, ruling: discard). No outcome, no play in the log, no move of
        /// the clock, no play count. It starts its Redraw as a play would, so a
        /// re-ranking deal doesn't hand it straight back: a finite Redraw waits
        /// that many turns from now, a "never" card is gone for good (for
        /// everyone, when it's shared), and an "always" card can come up at the
        /// next deal. One copy leaves, for a card the hand holds more than
        /// once.</summary>
        public void Discard(string cardId, string from)
        {
            AssertOpen();
            var (entry, ask) = ResolveDealt(cardId, from);
            var turn = _turnCounts.GetOrDefault(entry.Box.Id);
            if (entry.Card.Redraw.IsNever)
            {
                if (CardIsShared(entry.Card, entry.Deck.Shared ?? false)) _engine.MarkTaken(entry.Card.Id);
                else _cooldowns.Set(entry.Card.Id, Model.MAX_SAFE_INTEGER);
            }
            else if (entry.Card.Redraw.Turns != null)
            {
                _cooldowns.Set(entry.Card.Id, turn + entry.Card.Redraw.Turns.Value);
            }
            RemoveOne(ask.Hand.Id, entry.Card.Id);
            if (Tracing)
            {
                Emit(new DiscardEvent { Hand = Model.EffectiveGameId(ask.Hand), Card = Model.EffectiveGameId(entry.Card), Turn = turn }, turn);
            }
        }

        /// <summary>One copy of a card out of a hand (Play and Discard), set as a
        /// new list as a play always has.</summary>
        private void RemoveOne(string handId, string cardId)
        {
            var remaining = new List<string>(_boardContents.GetOrDefault(handId) ?? new List<string>());
            var at = remaining.IndexOf(cardId);
            if (at >= 0) remaining.RemoveAt(at);
            _boardContents.Set(handId, remaining);
        }

        /// <summary>One owned property owner's address, owner segment and all
        /// (4.4).</summary>
        private string Address(string kind, string id)
        {
            return _engine.AddressOf(kind, id);
        }

        /// <summary>Resolve a property address's owner segment to the internal
        /// id the stores are keyed by, saying so when the caller used the
        /// pre-4.4 internal-id form: it resolves for THIS release and earns a
        /// diagnostic naming the address to move to, and the next lockstep
        /// release refuses it. Throws the caller's "no &lt;kind&gt; store" error
        /// when the segment names no owner at all, and the ambiguous-address
        /// refusal when a short-form value segment names a tag in more than
        /// one box.</summary>
        private string ResolveOwner(string kind, string segment, string name)
        {
            var id = _engine.OwnerOrThrow(kind, segment, name, out var legacy);
            if (legacy && Tracing)
            {
                Emit(new DiagnosticEvent
                {
                    Where = "property address",
                    Message = _engine.LegacyAddressMessage(kind, segment, name),
                });
            }
            return id;
        }

        /// <summary>The bag that declares one change's name: the flow's bag when
        /// the property is per-flow, the shared bag when it is shared - the
        /// union/partition invariant made executable. Throws, landing nothing,
        /// when no bag declares it or the declaration is writable: false.</summary>
        private WritePlan PlanBag(string kind, string ownerId, string name, string path)
        {
            var bag = DeclaringBag(HalvesOf(kind, ownerId), name, path);
            // The kernel would refuse this at Set, with this text; asked here so
            // the refusal comes before any of the play's writes has landed.
            foreach (var d in bag.Declarations())
            {
                if (d.Name == name && d.Writable == false) throw new StoryletError($"'{name}' is read-only");
            }
            return new WritePlan { Kind = "bag", Bag = bag, Name = name, Path = path };
        }

        /// <summary>The two bags one owner's properties live in: this flow's and
        /// the shared one. Story has no owner. Either may be null for an owner
        /// the build does not have.</summary>
        private (PropertyBag Own, PropertyBag Shared) HalvesOf(string kind, string ownerId)
        {
            return kind == "story"
                ? (_stores.Story, _engine._shared.Story)
                : (Engine.KindOf(_stores, kind).GetOrDefault(ownerId), Engine.KindOf(_engine._shared, kind).GetOrDefault(ownerId));
        }

        /// <summary>Whichever half declares the name (the routing a play's
        /// writes and the host's SetProperty share); throws naming the path
        /// when neither does.</summary>
        private static PropertyBag DeclaringBag((PropertyBag Own, PropertyBag Shared) halves, string name, string path)
        {
            var bag = halves.Own != null && halves.Own.Get(name) != null ? halves.Own
                : halves.Shared != null && halves.Shared.Get(name) != null ? halves.Shared
                : null;
            if (bag == null) throw new StoryletError($"no property at \"{path}\"");
            return bag;
        }

        /// <summary>Resolve and check one change target, writing nothing: every
        /// refusal a write can meet that the engine can know in advance is met
        /// HERE, so a play checks all its targets before any write lands
        /// (ruling B).</summary>
        private WritePlan PlanWrite(string target, CardEntry entry, HandEnv handEnv)
        {
            var match = ChangeTarget.Match(target);
            if (!match.Success) throw new StoryletError($"bad change target \"{target}\"");
            var scope = match.Groups[1].Value;
            var name = match.Groups[2].Value;
            var host = _engine._hostScopes.GetOrDefault(scope);
            if (host != null)
            {
                if (!host.CanSet) throw new StoryletError($"@{scope}.{name} cannot be written: the host bound @{scope} read-only");
                // The story's own promise, kept HERE and only here, because here
                // is where the story does the writing: it is consulted before
                // the seam, so an outcome never reaches the bag (which would let
                // a host write past it) nor a bound resolver (which cannot tell
                // the two apart). The host's SetProperty is its own path and
                // never asks.
                if (Engine.HostReadOnly(host.Spec, name)) throw new StoryletError($"'@{scope}.{name}' is read-only (writable: false)");
                return new WritePlan { Kind = "host", Host = host, Name = name, Path = $"{scope}.{name}" };
            }
            switch (scope)
            {
                case "story": return PlanBag("story", null, name, $"story.{name}");
                case "box": return PlanBag("box", entry.Box.Id, name, $"{Address("box", entry.Box.Id)}.{name}");
                case "deck": return PlanBag("deck", entry.Deck.Id, name, $"{Address("deck", entry.Deck.Id)}.{name}");
                case "hand":
                {
                    // Write-back routing (schema 3.6): the composed name remembers
                    // its source store; writes to criteria/chosen-tag names are errors.
                    if (!handEnv.Sources.TryGetValue(name, out var source))
                    {
                        throw new StoryletError($"@hand.{name} is not composed in this ask");
                    }
                    if (source.Kind == "criteria")
                    {
                        throw new StoryletError($"@hand.{name} is a chosen tag / criteria name and cannot be written");
                    }
                    return PlanBag(source.Kind, source.Id, name, $"{Address(source.Kind, source.Id)}.{name}");
                }
                default:
                {
                    // Another engine's game-wide scope (`@patter.x`): the family's
                    // shared vocabulary lets a card write it, and the registry keeps
                    // that engine's rules (a read-only property is refused when the
                    // write lands, and the play then puts back what it had written).
                    // A story write, so no host flag.
                    if (_engine._registry.Has(scope)) return new WritePlan { Kind = "scope", Scope = scope, Name = name, Path = $"{scope}.{name}" };
                    if (_engine._bundle.ExternalScopes != null && _engine._bundle.ExternalScopes.Contains(scope))
                    {
                        throw new StoryletError($"@{scope}.{name} cannot be written: no engine on this registry registered @{scope}");
                    }
                    throw new StoryletError($"bad change target scope \"@{scope}\"");
                }
            }
        }

        /// <summary>Land one planned change; returns the value it replaced (for
        /// the log's "0 -> 1" reading). An engine write: the bag's subscribers
        /// fire (the firing rule).</summary>
        private ExprValue LandWrite(WritePlan plan, ExprValue value)
        {
            switch (plan.Kind)
            {
                case "host":
                {
                    var prev = _engine.HostGet(plan.Host, plan.Name);
                    _engine.HostSet(plan.Host, plan.Name, value);
                    return prev;
                }
                case "bag":
                {
                    try { return plan.Bag.Set(plan.Name, value).Prev; }
                    catch (Exception e) when (KernelErrors.Is(e)) { throw KernelErrors.As(e); }
                }
                default:
                {
                    var reg = _engine._registry;
                    var prev = reg.Get(plan.Scope, plan.Name);
                    try { reg.Set(plan.Scope, plan.Name, value); }
                    catch (Exception e) when (KernelErrors.Is(e)) { throw KernelErrors.As(e); }
                    return prev;
                }
            }
        }

        /// <summary>Put back what one landed change replaced, when a LATER change
        /// in the same play was refused as it landed (a refusal no plan could see
        /// coming: another engine's read-only property, a host resolver that
        /// throws). Silent and as the host, since this is the engine undoing
        /// itself, not the story writing.</summary>
        private void UndoWrite(WritePlan plan, ExprValue prev)
        {
            if (prev == null) return;
            switch (plan.Kind)
            {
                case "host": _engine.HostSet(plan.Host, plan.Name, prev, isHost: true); return;
                case "bag": plan.Bag.Set(plan.Name, prev, silent: true, reason: "play refused", host: true); return;
                default: _engine._registry.Set(plan.Scope, plan.Name, prev, host: true); return;
            }
        }

        /// <summary>Advance one box's clock (schema 3.4): a turn is one
        /// draw-from-stock session for that box.</summary>
        public void AdvanceTurns(string boxRef, double n = 1)
        {
            AssertOpen();
            var box = ResolveBox(boxRef);
            var next = _turnCounts.GetOrDefault(box.Id) + n;
            _turnCounts.Set(box.Id, next);
            if (Tracing) Emit(new TurnsEvent { Box = Model.EffectiveGameId(box), Turn = next }, next);
        }

        // --- state access (host surface + test tooling) ------------------------------

        /// <summary>Every box, bundle order: identity + THIS flow's clock (the
        /// enumeration surface examiners key their turns sections on; parity
        /// member).</summary>
        public List<BoxView> ListBoxes()
        {
            AssertOpen();
            var boxes = new List<BoxView>();
            foreach (var box in _engine._bundle.Boxes)
            {
                boxes.Add(new BoxView
                {
                    Id = box.Id,
                    GameId = Model.EffectiveGameId(box),
                    Title = box.Title,
                    Turn = _turnCounts.GetOrDefault(box.Id),
                    Extensions = box.Extensions,   // read-only and uncopied, as a dealt card's
                });
            }
            return boxes;
        }

        /// <summary>THIS flow's kernel bags with their store path prefixes (the
        /// state logger's mount surface; parity member). The shared bags are the
        /// engine's ListBags; flows are rebuilt by LoadGame, so consumers
        /// re-enumerate after a load.</summary>
        public List<BagMount> ListBags()
        {
            AssertOpen();
            var mounts = new List<BagMount> { new BagMount { Prefix = "story", Bag = _stores.Story } };
            foreach (var kind in Engine.OwnedScopes)
            {
                foreach (var pair in Engine.KindOf(_stores, kind))
                {
                    mounts.Add(new BagMount { Prefix = Address(kind, pair.Key), Bag = pair.Value });
                }
            }
            return mounts;
        }

        /// <summary>The flow's FULL merged view as examiner rows (the property
        /// examiner / editor surface, parity across all runtimes): the host
        /// scopes read through their resolvers, then per scope the shared
        /// values and this flow's own. Bundle order: host scopes (@world first
        /// when the bundle lists it first), story, then per-box / per-deck /
        /// per-hand / per-tag stores.</summary>
        public List<PropertyRow> ListProperties()
        {
            AssertOpen();
            var rows = new List<PropertyRow>();
            _engine.AddHostRows(rows);
            void Add(string prefix, PropertyBag bag)
            {
                if (bag == null) return;
                foreach (var row in bag.Rows())
                {
                    rows.Add(new PropertyRow
                    {
                        Path = $"{prefix}.{row.Name}",
                        Name = row.Name,
                        Type = row.Type,
                        Value = row.Value,
                        Default = row.Default,
                        Values = row.Values,
                        Stages = row.Stages,
                        Writable = row.Writable,
                    });
                }
            }
            Add("story", _engine._shared.Story);
            Add("story", _stores.Story);
            void AddKind(string kind, OrderedMap<string, PropertyBag> shared, OrderedMap<string, PropertyBag> own)
            {
                var ids = new List<string>(shared.Keys);
                foreach (var id in own.Keys) if (!ids.Contains(id)) ids.Add(id);
                foreach (var id in ids)
                {
                    // Composed here rather than taken from the bag's own
                    // PathPrefix because one address covers the two bags a
                    // merged read unions; the owner segment is its gameId (4.4).
                    var address = Address(kind, id);
                    Add(address, shared.GetOrDefault(id));
                    Add(address, own.GetOrDefault(id));
                }
            }
            AddKind("box", _engine._shared.Box, _stores.Box);
            AddKind("deck", _engine._shared.Deck, _stores.Deck);
            AddKind("hand", _engine._shared.Hand, _stores.Hand);
            AddKind("value", _engine._shared.Value, _stores.Value);
            return rows;
        }

        /// <summary>Read by path: "world.x", "story.gold",
        /// "value.docks.danger", "box.village.heat", "deck.wares.n",
        /// "hand.the-elder.zone" - the flow's merged view, routed by the
        /// declaration's sharing.
        ///
        /// The owner segment is the entity's GAMEID, the name it is called by
        /// everywhere else (4.4). Its internal id is accepted for this release
        /// and earns a DiagnosticEvent naming the address to move to; the next
        /// lockstep release refuses it.</summary>
        public ExprValue GetProperty(string path)
        {
            AssertOpen();
            return PropertyAt(path.Split('.'), path);
        }

        /// <summary>GetProperty on a path already split; a null path is
        /// joined from the parts only for a refusal's message.</summary>
        private ExprValue PropertyAt(string[] parts, string path)
        {
            ExprValue value = null;
            var host = _engine.HostScopeOf(parts);
            if (host != null)
            {
                value = _engine.HostGet(host, parts[1]);
            }
            else if (_engine.IsOtherScope(parts))
            {
                // Another engine's game-wide scope (`patter.gold`).
                value = _engine._registry.Get(parts[0], parts[1]);
            }
            else if (parts.Length == 2 && parts[0] == "story")
            {
                value = _stores.Story.Get(parts[1]) ?? _engine._shared.Story.Get(parts[1]);
            }
            else if (parts.Length == 3 && Engine.IsOwnedKind(parts[0]))
            {
                var (own, shared) = HalvesOf(parts[0], ResolveOwner(parts[0], parts[1], parts[2]));
                if (own == null && shared == null) throw new StoryletError($"no {parts[0]} store \"{parts[1]}\"");
                value = own?.Get(parts[2]) ?? shared?.Get(parts[2]);
            }
            else
            {
                throw new StoryletError($"bad property path \"{path ?? string.Join(".", parts)}\"");
            }
            if (value == null) throw new StoryletError($"no property at \"{path ?? string.Join(".", parts)}\"");
            return value;
        }

        public void SetProperty(string path, ExprValue value)
        {
            AssertOpen();
            var parts = path.Split('.');
            var host = _engine.HostScopeOf(parts);
            if (host != null)
            {
                _engine.CheckHostWrite(path, parts, null, value);
                if (!host.CanSet) throw new StoryletError($"@{host.Token} is read-only here: the host bound no write");
                _engine.HostSet(host, parts[1], value, isHost: true);
                return;
            }
            if (_engine.IsOtherScope(parts))
            {
                try { _engine._registry.Set(parts[0], parts[1], value, host: true); }
                catch (Exception e) when (KernelErrors.Is(e)) { throw KernelErrors.As(e); }
                return;
            }
            (PropertyBag Own, PropertyBag Shared) halves;
            string name;
            string ownerId = null;
            if (parts.Length == 2 && parts[0] == "story")
            {
                halves = HalvesOf("story", null);
                name = parts[1];
            }
            else if (parts.Length == 3 && Engine.IsOwnedKind(parts[0]))
            {
                ownerId = ResolveOwner(parts[0], parts[1], parts[2]);
                halves = HalvesOf(parts[0], ownerId);
                if (halves.Own == null && halves.Shared == null) throw new StoryletError($"no {parts[0]} store \"{parts[1]}\"");
                name = parts[2];
            }
            else
            {
                throw new StoryletError($"bad property path \"{path}\"");
            }
            _engine.CheckHostWrite(path, parts, ownerId, value);
            // The same routing a play's writes take (PlanBag), so the two can
            // never disagree about which half a name lives in.
            var bag = DeclaringBag(halves, name, path);
            // A host write: silent under the firing rule (no subscriber feedback
            // loop), visible to the bag's audit hook, and flagged HOST so a
            // Writable == false does not refuse the game its own value.
            bag.Set(name, value, silent: true, reason: "host setProperty", host: true);
        }

        // --- persistence (schema 4) ----------------------------------------------------

        /// <summary>This flow's DURABLE HALF, the player's pocket (ruling H): every
        /// per-flow Durable property's value by its address, and every per-flow
        /// durable one-shot this flow has spent, by card gameId. A later run opens
        /// the player's flow with it, OpenFlow(id, new OpenFlowOptions { Durable =
        /// pocket }); the shared half is Engine.SaveDurable.</summary>
        public DurableSave SaveDurable()
        {
            AssertOpen();
            var spent = new List<string>();
            foreach (var entry in _engine._durableFlowCards)
            {
                if (_cooldowns.TryGetValue(entry.Card.Id, out var until) && until == Model.MAX_SAFE_INTEGER)
                {
                    spent.Add(Model.EffectiveGameId(entry.Card));
                }
            }
            spent.Sort(StringComparer.Ordinal);
            return new DurableSave
            {
                Schema = Model.DURABLE_SCHEMA,
                Content = _engine.ContentCopy(),
                Values = Engine.DurableValues(_stores, _engine._durableFlow),
                Spent = spent,
            };
        }

        /// <summary>Write a planned pocket into this freshly opened flow
        /// (OpenFlow's Durable, which has already checked and planned it). Its
        /// bags hold their defaults, so only what the plan carries is
        /// written.</summary>
        internal void WriteDurable(DurablePlan plan)
        {
            foreach (var pair in plan.Values) Engine.PutDurable(Engine.DurableBag(_stores, pair.Key), pair.Key.Decl.Name, pair.Value);
            foreach (var cardId in plan.Cards) _cooldowns.Set(cardId, Model.MAX_SAFE_INTEGER);
        }

        /// <summary>This flow's blob: inside the engine's envelope without its
        /// properties (the registry has them), or parked whole by SaveFlow.
        /// ExprValue is immutable, so a container-deep copy is the TS
        /// structuredClone.</summary>
        internal FlowSave Snapshot(bool withProps)
        {
            var save = new FlowSave { Prng = _prng.State };
            if (withProps)
            {
                var props = new PropsPartition { Story = _stores.Story.Save() };
                foreach (var pair in _stores.Box) props.Box.Set(pair.Key, pair.Value.Save());
                foreach (var pair in _stores.Deck) props.Deck.Set(pair.Key, pair.Value.Save());
                foreach (var pair in _stores.Hand) props.Hand.Set(pair.Key, pair.Value.Save());
                foreach (var pair in _stores.Value) props.Value.Set(pair.Key, pair.Value.Save());
                save.Props = props;
            }
            // Keyed by Game ID (save version 3; see Engine.SavedCard): the turns
            // by box, the cooldowns by card, the board by hand with its cards,
            // in the order the flow holds them, then in JS object order (ruling
            // E: a Game ID may be all digits), so the bytes match the
            // reference's.
            foreach (var pair in _turnCounts) save.Turns.Set(_engine.BoxKey(pair.Key), pair.Value);
            foreach (var pair in _cooldowns) save.Cooldowns.Set(_engine.CardKey(pair.Key), pair.Value);
            foreach (var pair in _boardContents)
            {
                var cards = new List<string>(pair.Value.Count);
                foreach (var cardId in pair.Value) cards.Add(_engine.CardKey(cardId));
                save.Board.Set(_engine.HandKey(pair.Key), cards);
            }
            save.Turns = Model.InJsKeyOrder(save.Turns);
            save.Cooldowns = Model.InJsKeyOrder(save.Cooldowns);
            save.Board = Model.InJsKeyOrder(save.Board);
            foreach (var record in _playLog)
            {
                save.PlayLog.Add(new PlayRecord { Card = record.Card, Outcome = record.Outcome, Turn = record.Turn });
            }
            return save;
        }

        /// <summary>Restore a freshly opened flow from its blob (LoadGame).
        /// Orphaned keys (deleted entities) drop; new declarations keep
        /// defaults.</summary>
        internal void Restore(FlowSave saved)
        {
            if (saved.Props != null)
            {
                _stores.Story.Load(saved.Props.Story);
                LoadKind(_stores.Box, saved.Props.Box);
                LoadKind(_stores.Deck, saved.Props.Deck);
                LoadKind(_stores.Hand, saved.Props.Hand);
                LoadKind(_stores.Value, saved.Props.Value);
            }
            _turnCounts = new OrderedMap<string, double>();
            foreach (var box in _engine._bundle.Boxes) _turnCounts.Set(box.Id, 0);
            foreach (var pair in saved.Turns)
            {
                if (_turnCounts.ContainsKey(pair.Key)) _turnCounts.Set(pair.Key, pair.Value);
            }
            _prng = new Mulberry32(saved.Prng);
            _cooldowns = new OrderedMap<string, double>();
            foreach (var pair in saved.Cooldowns) _cooldowns.Set(pair.Key, pair.Value);
            _playLog = new List<PlayRecord>();
            foreach (var record in saved.PlayLog)
            {
                _playLog.Add(new PlayRecord { Card = record.Card, Outcome = record.Outcome, Turn = record.Turn });
            }
            RebuildPlayIndex();
            _boardContents = new OrderedMap<string, List<string>>();
            foreach (var pair in saved.Board)
            {
                if (!_engine._handsById.ContainsKey(pair.Key)) continue;
                _boardContents.Set(pair.Key, pair.Value.Where(id => _engine._cardsById.ContainsKey(id)).ToList());
            }
            foreach (var handId in _engine._handsById.Keys)
            {
                if (!_boardContents.ContainsKey(handId)) _boardContents.Set(handId, new List<string>());
            }
        }

        private static void LoadKind(
            OrderedMap<string, PropertyBag> stores,
            OrderedMap<string, OrderedMap<string, ExprValue>> saved)
        {
            foreach (var pair in saved)
            {
                stores.GetOrDefault(pair.Key)?.Load(pair.Value);
            }
        }
    }
}
