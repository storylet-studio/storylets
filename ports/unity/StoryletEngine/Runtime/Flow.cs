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
//   - availability order: deck gate -> cooldown -> tags -> hand condition ->
//     card condition -> claims (3.1)
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
            public OrderedMap<string, StoryletValue> Bag;
            public Dictionary<string, HandSource> Sources;
            /// <summary>tag group id -> bound tag id (home included, its "tag" a hand id).</summary>
            public OrderedMap<string, string> BoundTags;
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
            public StoryletValue Get(string name)
            {
                return Own?.Get(name) ?? Shared?.Get(name);
            }
        }

        private sealed class Scored
        {
            public CardEntry Entry;
            public double Priority;
            public double Spec;
        }

        private sealed class WriteResult
        {
            public string Path;
            public StoryletValue Prev;
        }

        // Stores are shared-kernel bags: identity normalisation because storylets
        // property names are case-significant as authored.
        private static PropertyBag BagFromDecls(IEnumerable<PropertyDecl> decls)
        {
            return new PropertyBag(decls, n => n);
        }

        /// <summary>Truthiness for a bare condition. One line, because the rule is
        /// on the SHARED value type: the two families disagreed about it until
        /// 2026-09-01, and they share a property registry, so the same value read
        /// from the same registry must answer the same question.</summary>
        private static bool ConditionPasses(StoryletValue v) => v.Truthy;

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

        private static readonly Regex ChangeTarget = new Regex("^@([a-z]+)\\.([A-Za-z_][A-Za-z0-9_-]*)$");

        private readonly Engine _engine;
        /// <summary>The flow's name - the address the host opened it under.</summary>
        public readonly string Id;
        private bool _closed;

        private Mulberry32 _prng;
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

        /// <summary>The per-flow property partitions (the not-shared halves).</summary>
        private Partition _stores;

        private readonly List<Action<TraceEvent>> _traceHandlers = new List<Action<TraceEvent>>();
        private List<LogEntry> _logEntries = new List<LogEntry>();
        private long _logSeq;

        internal Flow(Engine engine, string id, double seed)
        {
            _engine = engine;
            Id = id;
            _prng = new Mulberry32(seed);
            _stores = engine.BuildFlowPartition();
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
            _closed = true;
        }

        private void AssertOpen()
        {
            if (_closed) throw new StoryletError($"flow \"{Id}\" is closed");
        }

        /// <summary>A box's current turn (schema 3.4), on THIS flow's clock.</summary>
        public double Turn(string boxRef)
        {
            AssertOpen();
            var box = _engine._boxesByGameId.GetOrDefault(boxRef) ?? _engine._boxesById.GetOrDefault(boxRef);
            if (box == null) throw new StoryletError($"unknown box \"{boxRef}\"");
            return _turnCounts.GetOrDefault(box.Id);
        }

        /// <summary>Subscribe to the deal/play trace (schema 5). Returns the
        /// unsubscribe. With no subscribers the flow does no trace work at all.</summary>
        public Action SubscribeTrace(Action<TraceEvent> handler)
        {
            _traceHandlers.Add(handler);
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
        /// box.</summary>
        private static TagGroup GroupInBox(Box box, string reference)
        {
            return box.TagGroups.Find(g => Model.EffectiveGameId(g) == reference)
                ?? box.TagGroups.Find(g => g.Id == reference);
        }

        /// <summary>A count out of one of the play indexes, 0 when absent.
        /// (OrderedMap has GetOrDefault; a plain Dictionary does not.)</summary>
        private static int CountAt(Dictionary<string, int> map, string key)
        {
            int n;
            return map.TryGetValue(key, out n) ? n : 0;
        }

        /// <summary>The play-history indexes' key for one (group, tag) pair. A
        /// unit separator (U+001F) joins them: ids are letters, digits and
        /// underscores, so a control character cannot occur in one and two
        /// pairs can never collide into one key.</summary>
        private static string TagKey(string groupId, string tagId) => groupId + "\u001f" + tagId;

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
                    var key = TagKey(pair.Key, tagId);
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

        /// <summary><paramref name="box"/> is the box whose ask is being
        /// evaluated: the play-history functions take a bare group name, so it
        /// resolves there (a card's tags reference its own box's group, which
        /// keeps the counts box-local).</summary>
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

        private StoryletsHost MakeHost(Box box)
        {
            // A group NAME and tag name resolved in THIS box, as the index's
            // key; null when either is unknown here, which is the old
            // per-record `false` and reads as "never". Resolved once per call,
            // where InTag used to resolve it again for every log record.
            string KeyOf(string group, string tag)
            {
                var found = GroupInBox(box, group);
                var t = found?.Tags.Find(v => v.GameId == tag);
                return found == null || t == null ? null : TagKey(found.Id, t.Id);
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

        private static readonly OrderedMap<string, StoryletValue> EmptyBag = new OrderedMap<string, StoryletValue>();

        /// <summary>The evaluation environment (schema 3.1/6.2): @box/@deck resolve
        /// to the card under evaluation; in hand-condition contexts @deck is an
        /// empty bag, so any reference is an eval error (missing-policy throw).</summary>
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

        private EvalContext EvalCtx(Box box, Deck deck, HandEnv handEnv)
        {
            var ctx = new EvalContext { Host = Host(box) };
            if (_engine._hasQualities)
            {
                // The quality channel, answering for THIS ask's box and deck.
                ctx.Qualities = (scope, name) =>
                {
                    List<string> ladder = null;
                    if (scope == "world") _engine._worldLadders.TryGetValue(name, out ladder);
                    else if (scope == "story") _engine._storyLadders.TryGetValue(name, out ladder);
                    else if (scope == "box" && _engine._boxLadders.TryGetValue(box.Id, out var bm)) bm.TryGetValue(name, out ladder);
                    else if (scope == "deck" && deck != null && _engine._deckLadders.TryGetValue(deck.Id, out var dm)) dm.TryGetValue(name, out ladder);
                    else if (scope == "hand") ladder = HandLadder(handEnv, name);
                    return ladder;
                };
            }
            // Every scope is the flow's MERGED view - its own copies over the
            // shared values, names disjoint - and @world reads through the
            // engine's resolver.
            ctx.Scopes["world"] = _engine.WorldScope;
            ctx.Scopes["story"] = new PairScope { Own = _stores.Story, Shared = _engine._shared.Story };
            ctx.Scopes["box"] = new PairScope { Own = _stores.Box.GetOrDefault(box.Id), Shared = _engine._shared.Box.GetOrDefault(box.Id) };
            ctx.Scopes["deck"] = deck != null
                ? (IScopeSource)new PairScope { Own = _stores.Deck.GetOrDefault(deck.Id), Shared = _engine._shared.Deck.GetOrDefault(deck.Id) }
                : new BagScope(EmptyBag);
            ctx.Scopes["hand"] = new BagScope(handEnv.Bag);
            return ctx;
        }

        private StoryletValue Eval(Expression expr, EvalContext ctx)
        {
            return Expr.Evaluate(Node(expr), ctx, StoryletsDialect.Instance);
        }

        private bool Passes(Expression expr, EvalContext ctx, string where = null)
        {
            if (expr == null) return true;
            try
            {
                return ConditionPasses(Eval(expr, ctx));
            }
            catch (Exception e)
            {
                // An eval error is never a silent pass: the card/deck is
                // unavailable (schema 3.1), and the trace surfaces the diagnostic.
                if (Tracing)
                {
                    Emit(new DiagnosticEvent { Where = where ?? "condition", Message = e.Message });
                }
                return false;
            }
        }

        // --- resolving asks (schema 2.6 + 3.6) -----------------------------------

        private static Tag TagByGameId(TagGroup group, string gameId)
        {
            return group.Tags.Find(t => t.GameId == gameId);
        }

        /// <summary>A deal's ask: the hand's template bindings + chosen tags, or
        /// its rule's bindings, plus the implicit home binding (schema 2.4).</summary>
        private AskDescriptor AskForHand(Hand hand, Box box)
        {
            var boundTags = new OrderedMap<string, string>();
            var askNames = new OrderedMap<string, string>();
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
                    foreach (var pair in template.Bindings) boundTags.Set(pair.Key, pair.Value);
                }
                if (hand.Chosen != null)
                {
                    foreach (var pair in hand.Chosen)
                    {
                        boundTags.Set(pair.Key, pair.Value);
                        var found = _engine._groupsById.GetOrDefault(pair.Key);
                        var tag = found.Group?.Tags.Find(t => t.Id == pair.Value);
                        if (found.Group != null && tag != null)
                        {
                            askNames.Set(Model.EffectiveGameId(found.Group), Model.EffectiveGameId(tag));
                        }
                    }
                }
                condition = template.Condition;
            }
            else
            {
                if (hand.Rule?.Bindings != null)
                {
                    foreach (var pair in hand.Rule.Bindings)
                    {
                        boundTags.Set(pair.Key, pair.Value);
                        // ...and name it, as the template branch does: a card
                        // reading @hand.<group> must not care HOW it was bound.
                        var found = _engine._groupsById.GetOrDefault(pair.Key);
                        var tag = found.Group?.Tags.Find(t => t.Id == pair.Value);
                        if (found.Group != null && tag != null)
                        {
                            askNames.Set(Model.EffectiveGameId(found.Group), Model.EffectiveGameId(tag));
                        }
                    }
                }
                condition = hand.Rule?.Condition;
            }
            boundTags.Set(Model.PLACE_GROUP, hand.Id);
            BindStateGroups(box, boundTags, askNames);
            return new AskDescriptor { Box = box, Hand = hand, Condition = condition, BoundTags = boundTags, AskNames = askNames };
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

        /// <summary>Bind every state-bound group in the box from the property it
        /// names. Runs after the hand's own bindings and never overwrites one: an
        /// explicit binding beats a default. A value naming no tag leaves the group
        /// UNBOUND (a wildcard) with a diagnostic, because a silently empty hand
        /// reads as content that does not exist.</summary>
        private void BindStateGroups(Box box, OrderedMap<string, string> boundTags, OrderedMap<string, string> askNames)
        {
            foreach (var group in box.TagGroups)
            {
                if (string.IsNullOrEmpty(group.BoundBy) || boundTags.GetOrDefault(group.Id) != null) continue;
                var match = System.Text.RegularExpressions.Regex.Match(group.BoundBy, @"^@(world|story)\.([a-z][a-z0-9_-]*)$");
                if (!match.Success)
                {
                    Emit(new DiagnosticEvent { Where = $"tag group {Model.EffectiveGameId(group)}", Message = $"boundBy \"{group.BoundBy}\" is not a @world or @story property reference" });
                    continue;
                }
                StoryletValue value;
                try { value = GetProperty($"{match.Groups[1].Value}.{match.Groups[2].Value}"); }
                catch (StoryletError)
                {
                    Emit(new DiagnosticEvent { Where = $"tag group {Model.EffectiveGameId(group)}", Message = $"boundBy \"{group.BoundBy}\" names a property that is not declared" });
                    continue;
                }
                var wanted = value.Kind == StoryletKind.Str ? value.AsString : value.ToString();
                var tag = group.Tags.Find(t => Model.EffectiveGameId(t) == wanted);
                if (tag == null)
                {
                    Emit(new DiagnosticEvent { Where = $"tag group {Model.EffectiveGameId(group)}", Message = $"{group.BoundBy} is \"{wanted}\", which is not one of its tags" });
                    continue;
                }
                boundTags.Set(group.Id, tag.Id);
                askNames.Set(Model.EffectiveGameId(group), Model.EffectiveGameId(tag));
            }
        }

        // --- @hand composition (schema 3.6) ---------------------------------------

        private HandEnv BuildHandEnv(AskDescriptor ask)
        {
            var bag = new OrderedMap<string, StoryletValue>();
            var sources = new Dictionary<string, HandSource>();

            // 1. Tag properties of every bound tag (home binds a hand, not a
            //    tag) - the MERGED view: shared under the flow's own, names
            //    disjoint, so order is routing, not shadowing.
            foreach (var pair in ask.BoundTags)
            {
                if (pair.Key == Model.PLACE_GROUP) continue;
                foreach (var side in new[] { _engine._shared.Value.GetOrDefault(pair.Value), _stores.Value.GetOrDefault(pair.Value) })
                {
                    if (side == null) continue;
                    foreach (var prop in side.Values)
                    {
                        bag.Set(prop.Key, prop.Value);
                        sources[prop.Key] = new HandSource { Kind = "value", Id = pair.Value };
                    }
                }
            }
            // 2. Hand properties, when the ask is a deal.
            if (ask.Hand != null)
            {
                foreach (var side in new[] { _engine._shared.Hand.GetOrDefault(ask.Hand.Id), _stores.Hand.GetOrDefault(ask.Hand.Id) })
                {
                    if (side == null) continue;
                    foreach (var prop in side.Values)
                    {
                        bag.Set(prop.Key, prop.Value);
                        sources[prop.Key] = new HandSource { Kind = "hand", Id = ask.Hand.Id };
                    }
                }
            }
            // 3. Chosen tags / criteria, by group name (the tag's gameId as value).
            foreach (var pair in ask.AskNames)
            {
                bag.Set(pair.Key, StoryletValue.Str(pair.Value));
                sources[pair.Key] = new HandSource { Kind = "criteria" };
            }
            return new HandEnv { Bag = bag, Sources = sources, BoundTags = ask.BoundTags };
        }

        // --- the ask (schema 3.1 + 3.2) --------------------------------------------

        /// <summary>The claims ledger, derived from the board: card id -> holding
        /// hands (schema 3.5).</summary>
        private Dictionary<string, int> Claims()
        {
            var counts = new Dictionary<string, int>();
            foreach (var pair in _boardContents)
            {
                foreach (var id in pair.Value)
                {
                    counts.TryGetValue(id, out var n);
                    counts[id] = n + 1;
                }
            }
            return counts;
        }

        private static double CopiesOf(Card card)
        {
            return card.Copies ?? 1;
        }

        /// <summary>Is this card scarce across flows (design/shared-scarcity.md)?
        /// The deck says what the pile is for and the card may override it. The
        /// deck's flag hoists out of the card loop: the ask runs this per card
        /// per deal.</summary>
        private static bool CardIsShared(Card card, bool deckShared)
        {
            return card.Shared ?? deckShared;
        }

        /// <summary>How many hands ACROSS EVERY FLOW may hold this at once;
        /// defaults to Copies.</summary>
        private static double SharedCap(Card card)
        {
            return card.SharedCopies ?? card.Copies ?? 1;
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
        /// fault.</summary>
        private TraceVerdict? ClaimVerdict(Card card, bool shared,
            Dictionary<string, int> mine, Dictionary<string, int> world)
        {
            mine.TryGetValue(card.Id, out var own);
            if (own >= CopiesOf(card)) return TraceVerdict.Claimed;
            if (shared)
            {
                world.TryGetValue(card.Id, out var anywhere);
                if (anywhere >= SharedCap(card)) return TraceVerdict.ClaimedElsewhere;
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
            foreach (var pair in boundTags)
            {
                if (pair.Key == Model.PLACE_GROUP) continue;
                var tags = card.Tags?.GetOrDefault(pair.Key);
                if (tags == null)
                {
                    // Omission is a wildcard unless the group says otherwise.
                    if (_engine.requiredGroups.Contains(pair.Key)) return false;
                    continue;
                }
                if (!tags.Contains(pair.Value)) return false;
            }
            return true;
        }

        /// <summary>Run one ask: availability filter then ranking. `claimed`
        /// decides the claims step (step 6) per card. `trace` (when a subscriber
        /// exists) collects the per-card verdicts.</summary>
        private (List<CardEntry> Ordered, HandEnv HandEnv) RunAsk(
            AskDescriptor ask,
            Func<Card, bool, TraceVerdict?> claimed,
            List<TraceCard> trace)
        {
            var box = ask.Box;
            var handEnv = BuildHandEnv(ask);
            void Verdict(string id, TraceVerdict v)
            {
                trace?.Add(new TraceCard { Id = id, Verdict = v });
            }

            // The hand's condition: ask-constant, evaluated once (schema 3.1 step 4).
            var handWhere = $"hand {(ask.Hand != null ? Model.EffectiveGameId(ask.Hand) : "")} condition";
            if (!Passes(ask.Condition, EvalCtx(box, null, handEnv), handWhere))
            {
                return (new List<CardEntry>(), handEnv);
            }

            // Deck gates: evaluated once per ask, in deck (id) order (schema 2.5).
            var gateOk = new Dictionary<string, bool>();
            foreach (var deck in box.Decks)
            {
                gateOk[deck.Id] = Passes(deck.Condition, EvalCtx(box, deck, handEnv), $"deck {deck.GameId} gate");
            }

            var turn = _turnCounts.GetOrDefault(box.Id);
            var scored = new List<Scored>();
            foreach (var deck in box.Decks)
            {
                // ONE context per deck, not per card: box, deck and handEnv do not
                // vary inside this loop, and a condition is a read-only gate
                // (schema 3.1). Rebuilding it per card cost an EvalContext, a
                // scopes dictionary and five BagScopes each time - about half the
                // garbage a peek over a large box produced. Reference:
                // engine.ts runAsk, and storylets-new/design/port-review-2026-08.md.
                var deckCtx = EvalCtx(box, deck, handEnv);
                var deckShared = deck.Shared ?? false;
                foreach (var card in deck.Cards)
                {
                    var shared = CardIsShared(card, deckShared);
                    if (!gateOk[deck.Id])
                    {
                        Verdict(card.Id, TraceVerdict.DeckGate);
                        continue;
                    }
                    // Taken out of the world by somebody's shared one-shot.
                    // Checked before this flow's own clock, because "cooldown"
                    // would point the reader at a turn counter that has nothing
                    // to do with it.
                    if (shared && _engine.IsTaken(card.Id))
                    {
                        Verdict(card.Id, TraceVerdict.Taken);
                        continue;
                    }
                    if (_cooldowns.GetOrDefault(card.Id) > turn)
                    {
                        Verdict(card.Id, TraceVerdict.Cooldown);
                        continue;
                    }
                    if (!TagsMatch(card, handEnv.BoundTags))
                    {
                        Verdict(card.Id, TraceVerdict.Tags);
                        continue;
                    }
                    var ctx = deckCtx;
                    // The label is only read when an eval THROWS and only when
                    // tracing, so interpolating it per card was waste on the path
                    // that matters.
                    if (card.Condition != null && !Passes(card.Condition, ctx,
                        Tracing ? $"card {card.GameId} condition" : null))
                    {
                        Verdict(card.Id, TraceVerdict.Condition);
                        continue;
                    }
                    var refused = claimed(card, shared);    // claims, last (schema 3.1 step 6)
                    if (refused.HasValue)
                    {
                        Verdict(card.Id, refused.Value);
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
                            if (!v.IsNumber)
                            {
                                Verdict(card.Id, TraceVerdict.Priority);
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
                            Verdict(card.Id, TraceVerdict.Priority);
                            continue;
                        }
                    }
                    double spec = 0;
                    if (box.Ranking.Specificity && card.Condition != null)
                    {
                        var node = Node(card.Condition);
                        spec = Specificity.MatchedSpecificity(node, n =>
                        {
                            try
                            {
                                return ConditionPasses(Expr.Evaluate(n, ctx, StoryletsDialect.Instance));
                            }
                            catch (Exception)
                            {
                                return false;
                            }
                        });
                    }
                    scored.Add(new Scored { Entry = new CardEntry { Card = card, Deck = deck, Box = box }, Priority = priority, Spec = spec });
                }
            }

            // STABLE sort (List<T>.Sort is unstable; LINQ OrderBy is not).
            scored = scored.OrderByDescending(s => s.Priority).ThenByDescending(s => s.Spec).ToList();
            // Seeded shuffle of each maximal tie run; runs of 1 consume no draws.
            int i = 0;
            while (i < scored.Count)
            {
                int j = i + 1;
                while (j < scored.Count
                    && scored[j].Priority == scored[i].Priority
                    && scored[j].Spec == scored[i].Spec) j++;
                if (j - i > 1)
                {
                    var run = scored.GetRange(i, j - i);
                    Prng.ShuffleInPlace(run, _prng);
                    for (int k = 0; k < run.Count; k++) scored[i + k] = run[k];
                }
                i = j;
            }
            if (trace != null)
            {
                foreach (var s in scored)
                {
                    trace.Add(new TraceCard { Id = s.Entry.Card.Id, Verdict = TraceVerdict.Dealt, Priority = s.Priority, Specificity = s.Spec });
                }
            }
            return (scored.Select(s => s.Entry).ToList(), handEnv);
        }

        /// <summary>Flip eligible-but-not-taken trace entries to "capped".</summary>
        private static void CapTrace(List<TraceCard> trace, HashSet<string> taken)
        {
            foreach (var entry in trace)
            {
                if (entry.Verdict == TraceVerdict.Dealt && !taken.Contains(entry.Id)) entry.Verdict = TraceVerdict.Capped;
            }
        }

        private static DealtCard View(CardEntry entry)
        {
            var card = entry.Card;
            return new DealtCard
            {
                Id = card.Id,
                GameId = Model.EffectiveGameId(card),
                Title = card.Title,
                Purpose = card.Purpose,
                Fields = card.Fields,
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
            var box = _engine._boxesByGameId.GetOrDefault(boxRef) ?? _engine._boxesById.GetOrDefault(boxRef);
            if (box == null) throw new StoryletError($"unknown box \"{boxRef}\"");
            var ask = AskForPeek(box, criteria);
            var claimCounts = Claims();
            // Skipped outright when the bundle shares nothing, which is most
            // bundles: the ledger walks every live flow's whole board, and an
            // empty map answers every question the same way.
            var worldClaims = _engine._hasShared ? _engine.SharedClaims() : new Dictionary<string, int>();
            var trace = Tracing ? new List<TraceCard>() : null;
            var (ordered, _) = RunAsk(ask, (card, shared) => ClaimVerdict(card, shared, claimCounts, worldClaims), trace);
            var listed = n == null ? ordered : ordered.GetRange(0, Math.Min(Math.Max(n.Value, 0), ordered.Count));
            if (trace != null)
            {
                CapTrace(trace, new HashSet<string>(listed.Select(e => e.Card.Id)));
                Emit(new PeekEvent { Box = Model.EffectiveGameId(box), Criteria = criteria, Cards = trace }, _turnCounts.GetOrDefault(box.Id));
            }
            return new RankedList { Box = Model.EffectiveGameId(box), Cards = listed.Select(View).ToList() };
        }

        /// <summary>Refresh one hand (schema 3.5); returns its new shape.</summary>
        public List<DealtCard> Deal(string handRef)
        {
            AssertOpen();
            var found = ResolveHand(handRef);
            return DealMany(new[] { handRef }).GetOrDefault(Model.EffectiveGameId(found.Hand)) ?? new List<DealtCard>();
        }

        /// <summary>Re-deal several / all hands (schema 3.5): seeded hand-order
        /// shuffle (fairness), evict, seed the ledger from survivors, fill in
        /// order. Returns the dealt slice - the new contents of exactly the hands
        /// this call dealt, keyed by hand gameId (Board() stays the whole-board
        /// read).</summary>
        public OrderedMap<string, List<DealtCard>> DealMany(IReadOnlyList<string> handRefs = null)
        {
            AssertOpen();
            List<string> refs;
            if (handRefs != null)
            {
                refs = new List<string>(handRefs);
            }
            else
            {
                refs = new List<string>(_engine._handsById.Keys);
                refs.Sort(StringComparer.Ordinal);
            }
            var dealt = refs.Select(ResolveHand).ToList();
            Prng.ShuffleInPlace(dealt, _prng);

            // Eviction first: drop dealt cards no longer available to their hand
            // (minus the claims check against their own seat).
            foreach (var handInBox in dealt)
            {
                var hand = handInBox.Hand;
                var box = handInBox.Box;
                var ask = AskForHand(hand, box);
                var handEnv = BuildHandEnv(ask);
                var conditionOk = Passes(ask.Condition, EvalCtx(box, null, handEnv));
                var gateOk = new Dictionary<string, bool>();
                foreach (var deck in box.Decks)
                {
                    gateOk[deck.Id] = Passes(deck.Condition, EvalCtx(box, deck, handEnv));
                }
                var turn = _turnCounts.GetOrDefault(box.Id);
                // Trace events fire after the state they report has landed (a
                // handler reading the board sees the eviction), so they are
                // collected here and emitted once the survivors are set.
                var evicted = new List<EvictEvent>();
                bool Evict(string cardId, string reason)
                {
                    if (Tracing) evicted.Add(new EvictEvent { Hand = hand.Id, Card = cardId, Reason = reason });
                    return false;
                }
                var contents = _boardContents.GetOrDefault(hand.Id) ?? new List<string>();
                var survivors = contents.Where(cardId =>
                {
                    if (!conditionOk) return Evict(cardId, "hand-condition");
                    var entry = _engine._cardsById.GetOrDefault(cardId);
                    if (entry == null) return Evict(cardId, "vanished");   // edited content: dropped
                    if (!gateOk[entry.Deck.Id]) return Evict(cardId, VerdictWire(TraceVerdict.DeckGate));
                    if (_cooldowns.GetOrDefault(cardId) > turn) return Evict(cardId, VerdictWire(TraceVerdict.Cooldown));
                    if (!TagsMatch(entry.Card, handEnv.BoundTags)) return Evict(cardId, VerdictWire(TraceVerdict.Tags));
                    if (!Passes(entry.Card.Condition, EvalCtx(box, entry.Deck, handEnv), $"card {entry.Card.GameId} condition"))
                    {
                        return Evict(cardId, VerdictWire(TraceVerdict.Condition));
                    }
                    return true;
                }).ToList();
                _boardContents.Set(hand.Id, survivors);
                if (Tracing)
                {
                    foreach (var e in evicted) Emit(e, turn);
                }
            }

            var claimCounts = Claims();
            // Taken once for the whole batch and kept in step with the local
            // ledger below, so two hands in the SAME deal cannot both take the
            // last shared copy.
            // Skipped outright when the bundle shares nothing, which is most
            // bundles: the ledger walks every live flow's whole board, and an
            // empty map answers every question the same way.
            var worldClaims = _engine._hasShared ? _engine.SharedClaims() : new Dictionary<string, int>();
            foreach (var handInBox in dealt)
            {
                var hand = handInBox.Hand;
                var box = handInBox.Box;
                var contents = _boardContents.GetOrDefault(hand.Id) ?? new List<string>();
                var free = HandCapacity(hand) - contents.Count;
                if (free <= 0) continue;
                var ask = AskForHand(hand, box);
                var own = new HashSet<string>(contents);
                var trace = Tracing ? new List<TraceCard>() : null;
                // At most once in any one hand; at most `copies` hands here, and
                // at most SharedCopies hands anywhere (schema 3.5, shared-scarcity 5).
                var (ordered, _) = RunAsk(ask,
                    (card, shared) => own.Contains(card.Id)
                        ? TraceVerdict.Claimed
                        : ClaimVerdict(card, shared, claimCounts, worldClaims), trace);
                var take = double.IsPositiveInfinity(free) ? ordered.Count : Math.Min((int)free, ordered.Count);
                var added = ordered.GetRange(0, take).Select(e => e.Card.Id).ToList();
                var next = new List<string>(contents);
                next.AddRange(added);
                _boardContents.Set(hand.Id, next);
                foreach (var id in added)
                {
                    claimCounts.TryGetValue(id, out var c);
                    claimCounts[id] = c + 1;
                    worldClaims.TryGetValue(id, out var w);
                    worldClaims[id] = w + 1;
                }
                // Emitted after the hand is set: a handler reading Board() sees the deal.
                if (trace != null)
                {
                    CapTrace(trace, new HashSet<string>(added));
                    Emit(new DealEvent { Hand = Model.EffectiveGameId(hand), Cards = trace }, _turnCounts.GetOrDefault(box.Id));
                }
            }

            var result = new OrderedMap<string, List<DealtCard>>();
            foreach (var handInBox in dealt)
            {
                var ids = _boardContents.GetOrDefault(handInBox.Hand.Id) ?? new List<string>();
                result.Set(Model.EffectiveGameId(handInBox.Hand), ids.Select(id => View(_engine._cardsById.GetOrDefault(id))).ToList());
            }
            return result;
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
            var box = _engine._boxesByGameId.GetOrDefault(boxRef) ?? _engine._boxesById.GetOrDefault(boxRef);
            if (box == null) throw new StoryletError($"unknown box \"{boxRef}\"");
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
            return result;
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
                Available = Passes(o.Condition, ctx),
            }).ToList();
        }

        /// <summary>Apply an outcome (schema 3.7): the card must sit in a hand on
        /// the board (you never play a card from inside the deck). Throws before
        /// any mutation on a gated-shut outcome or a bad write target.</summary>
        public void Play(string cardId, string outcomeGameId, string from, PlayOptions opts = null)
        {
            AssertOpen();
            opts = opts ?? new PlayOptions();
            var (entry, ask) = ResolveDealt(cardId, from);
            var outcome = entry.Card.Outcomes.Find(o => Model.EffectiveGameId(o) == outcomeGameId);
            if (outcome == null)
            {
                throw new StoryletError($"card \"{Model.EffectiveGameId(entry.Card)}\" has no outcome \"{outcomeGameId}\"");
            }

            var handEnv = BuildHandEnv(ask);
            var ctx = EvalCtx(entry.Box, entry.Deck, handEnv);
            if (!Passes(outcome.Condition, ctx))
            {
                throw new StoryletError($"outcome \"{outcomeGameId}\" on \"{Model.EffectiveGameId(entry.Card)}\" is gated shut");
            }

            // The played card's box's clock advances (schema 3.4); computed up
            // front so the play and its writes log as one action, one turn stamp.
            var newTurn = _turnCounts.GetOrDefault(entry.Box.Id)
                + (opts.AdvanceTurns ?? _engine._bundle.Settings.PlayAdvancesTurns);

            // Every right-hand side evaluates against PRE-play state, then all
            // writes land (schema 3.7).
            var writes = new List<KeyValuePair<string, StoryletValue>>();
            foreach (var change in outcome.Changes)
            {
                writes.Add(new KeyValuePair<string, StoryletValue>(change.Key, Eval(change.Value, ctx)));
            }
            foreach (var write in writes)
            {
                var landed = ApplyWrite(write.Key, write.Value, entry, handEnv);
                if (Tracing)
                {
                    Emit(new WriteEvent { Target = write.Key, Path = landed.Path, Value = write.Value, Prev = landed.Prev }, newTurn);
                }
            }

            var record = new PlayRecord { Card = Model.EffectiveGameId(entry.Card), Outcome = Model.EffectiveGameId(outcome), Turn = newTurn };
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
            // The card leaves its hand, releasing its claim (schema 3.5/3.7).
            var handId = ask.Hand.Id;
            var remaining = (_boardContents.GetOrDefault(handId) ?? new List<string>())
                .Where(id => id != entry.Card.Id).ToList();
            _boardContents.Set(handId, remaining);
            _turnCounts.Set(entry.Box.Id, newTurn);
            // Emitted last: a handler reading the board and the clock sees the play.
            if (Tracing)
            {
                Emit(new PlayEvent { Card = entry.Card.Id, Outcome = Model.EffectiveGameId(outcome), Turn = newTurn }, newTurn);
            }
        }

        /// <summary>Land one change in whichever partition declares the name:
        /// the flow's bag when the property is per-flow, the shared bag when it
        /// is shared - the union/partition invariant made executable. Returns
        /// the resolved store path (for the trace) and the value it replaced
        /// (for the log's "0 -> 1" reading).</summary>
        private WriteResult LandIn(string kind, string ownerId, string name, StoryletValue value, string path)
        {
            PropertyBag own = kind == "story" ? _stores.Story : KindOf(_stores, kind).GetOrDefault(ownerId);
            PropertyBag shared = kind == "story" ? _engine._shared.Story : KindOf(_engine._shared, kind).GetOrDefault(ownerId);
            var bag = own != null && own.Get(name) != null ? own
                : shared != null && shared.Get(name) != null ? shared
                : null;
            if (bag == null) throw new StoryletError($"no property at \"{path}\"");
            // An engine write: the bag's subscribers fire (the firing rule).
            var change = bag.Set(name, value);
            return new WriteResult { Path = path, Prev = change.Prev };
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

        private WriteResult ApplyWrite(string target, StoryletValue value, CardEntry entry, HandEnv handEnv)
        {
            var match = ChangeTarget.Match(target);
            if (!match.Success) throw new StoryletError($"bad change target \"{target}\"");
            var scope = match.Groups[1].Value;
            var name = match.Groups[2].Value;
            switch (scope)
            {
                case "world":
                {
                    if (!_engine.WorldCanSet) throw new StoryletError($"@world.{name} cannot be written: the host bound @world read-only");
                    var prev = _engine.WorldGet(name);
                    _engine.WorldSet(name, value);
                    return new WriteResult { Path = $"world.{name}", Prev = prev };
                }
                case "story": return LandIn("story", null, name, value, $"story.{name}");
                case "box": return LandIn("box", entry.Box.Id, name, value, $"box.{entry.Box.Id}.{name}");
                case "deck": return LandIn("deck", entry.Deck.Id, name, value, $"deck.{entry.Deck.Id}.{name}");
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
                    return LandIn(source.Kind, source.Id, name, value, $"{source.Kind}.{source.Id}.{name}");
                }
                default: throw new StoryletError($"bad change target scope \"@{scope}\"");
            }
        }

        /// <summary>Advance one box's clock (schema 3.4): a turn is one
        /// draw-from-stock session for that box.</summary>
        public void AdvanceTurns(string boxRef, double n = 1)
        {
            AssertOpen();
            var box = _engine._boxesByGameId.GetOrDefault(boxRef) ?? _engine._boxesById.GetOrDefault(boxRef);
            if (box == null) throw new StoryletError($"unknown box \"{boxRef}\"");
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
            foreach (var pair in _stores.Box) mounts.Add(new BagMount { Prefix = $"box.{pair.Key}", Bag = pair.Value });
            foreach (var pair in _stores.Deck) mounts.Add(new BagMount { Prefix = $"deck.{pair.Key}", Bag = pair.Value });
            foreach (var pair in _stores.Hand) mounts.Add(new BagMount { Prefix = $"hand.{pair.Key}", Bag = pair.Value });
            foreach (var pair in _stores.Value) mounts.Add(new BagMount { Prefix = $"value.{pair.Key}", Bag = pair.Value });
            return mounts;
        }

        /// <summary>The flow's FULL merged view as examiner rows (the property
        /// examiner / editor surface, parity across all runtimes): @world read
        /// through the engine's resolver, then per scope the shared values and
        /// this flow's own. Bundle order.</summary>
        public List<PropertyView> ListProperties()
        {
            AssertOpen();
            var rows = new List<PropertyView>();
            _engine.AddWorldRows(rows);
            void Add(string prefix, PropertyBag bag)
            {
                if (bag == null) return;
                foreach (var row in bag.Rows())
                {
                    rows.Add(new PropertyView
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
                    Add($"{kind}.{id}", shared.GetOrDefault(id));
                    Add($"{kind}.{id}", own.GetOrDefault(id));
                }
            }
            AddKind("box", _engine._shared.Box, _stores.Box);
            AddKind("deck", _engine._shared.Deck, _stores.Deck);
            AddKind("hand", _engine._shared.Hand, _stores.Hand);
            AddKind("value", _engine._shared.Value, _stores.Value);
            return rows;
        }

        /// <summary>Read by path: "world.x", "story.gold",
        /// "value.v_docks.danger", "box.b_x.heat" - the flow's merged view,
        /// routed by the declaration's sharing.</summary>
        public StoryletValue GetProperty(string path)
        {
            AssertOpen();
            var parts = path.Split('.');
            StoryletValue value = null;
            if (parts.Length == 2 && parts[0] == "world")
            {
                value = _engine.WorldGet(parts[1]);
            }
            else if (parts.Length == 2 && parts[0] == "story")
            {
                value = _stores.Story.Get(parts[1]) ?? _engine._shared.Story.Get(parts[1]);
            }
            else if (parts.Length == 3 && (parts[0] == "box" || parts[0] == "deck" || parts[0] == "hand" || parts[0] == "value"))
            {
                var own = KindOf(_stores, parts[0]).GetOrDefault(parts[1]);
                var shared = KindOf(_engine._shared, parts[0]).GetOrDefault(parts[1]);
                if (own == null && shared == null) throw new StoryletError($"no {parts[0]} store \"{parts[1]}\"");
                value = own?.Get(parts[2]) ?? shared?.Get(parts[2]);
            }
            else
            {
                throw new StoryletError($"bad property path \"{path}\"");
            }
            if (value == null) throw new StoryletError($"no property at \"{path}\"");
            return value;
        }

        public void SetProperty(string path, StoryletValue value)
        {
            AssertOpen();
            var parts = path.Split('.');
            if (parts.Length == 2 && parts[0] == "world")
            {
                if (!_engine.WorldCanSet) throw new StoryletError("@world is read-only here: the host bound no write");
                _engine.WorldSet(parts[1], value);
                return;
            }
            PropertyBag own, shared;
            string name;
            if (parts.Length == 2 && parts[0] == "story")
            {
                own = _stores.Story;
                shared = _engine._shared.Story;
                name = parts[1];
            }
            else if (parts.Length == 3 && (parts[0] == "box" || parts[0] == "deck" || parts[0] == "hand" || parts[0] == "value"))
            {
                own = KindOf(_stores, parts[0]).GetOrDefault(parts[1]);
                shared = KindOf(_engine._shared, parts[0]).GetOrDefault(parts[1]);
                if (own == null && shared == null) throw new StoryletError($"no {parts[0]} store \"{parts[1]}\"");
                name = parts[2];
            }
            else
            {
                throw new StoryletError($"bad property path \"{path}\"");
            }
            var bag = own != null && own.Get(name) != null ? own
                : shared != null && shared.Get(name) != null ? shared
                : null;
            if (bag == null) throw new StoryletError($"no property at \"{path}\"");
            // A host write: silent under the firing rule (no subscriber feedback
            // loop), but visible to the bag's audit hook.
            bag.Set(name, value, silent: true, reason: "host setProperty");
        }

        // --- persistence (schema 4) ----------------------------------------------------

        /// <summary>This flow's blob inside the engine's envelope. StoryletValue
        /// is immutable, so a container-deep copy is the TS structuredClone.</summary>
        internal FlowSave Snapshot()
        {
            var save = new FlowSave { Prng = _prng.State };
            save.Props.Story = _stores.Story.Save();
            foreach (var pair in _stores.Box) save.Props.Box.Set(pair.Key, pair.Value.Save());
            foreach (var pair in _stores.Deck) save.Props.Deck.Set(pair.Key, pair.Value.Save());
            foreach (var pair in _stores.Hand) save.Props.Hand.Set(pair.Key, pair.Value.Save());
            foreach (var pair in _stores.Value) save.Props.Value.Set(pair.Key, pair.Value.Save());
            foreach (var pair in _turnCounts) save.Turns.Set(pair.Key, pair.Value);
            foreach (var pair in _cooldowns) save.Cooldowns.Set(pair.Key, pair.Value);
            foreach (var pair in _boardContents) save.Board.Set(pair.Key, new List<string>(pair.Value));
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
            _stores.Story.Load(saved.Props.Story);
            LoadKind(_stores.Box, saved.Props.Box);
            LoadKind(_stores.Deck, saved.Props.Deck);
            LoadKind(_stores.Hand, saved.Props.Hand);
            LoadKind(_stores.Value, saved.Props.Value);
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
            OrderedMap<string, OrderedMap<string, StoryletValue>> saved)
        {
            foreach (var pair in saved)
            {
                stores.GetOrDefault(pair.Key)?.Load(pair.Value);
            }
        }
    }
}
