// The state logger (parity member: every runtime carries one; design/
// engine-runtimes.md 3.4 is the design of record). Kernel-shaped: property
// logging is PUSH-based on the PropertyBag audit hook - every write, engine
// or host, arrives with prev and reason and logs the moment it lands - while
// the product's non-property state (turns / cooldowns / board) arrives
// through a small path-provider adapter and is diffed on Capture(). The
// kernel core (the StateLogger class over a StateLoggerAdapter) is
// product-agnostic and moves into the shared kernel wholesale when the
// vendor-sync slice lands; CreateStateLogger is the storylets adapter over
// it. Flattened path scheme (the JS play-helpers logger's, verbatim):
//   world.x / story.x / box.<id>.x / deck.<id>.x / hand.<id>.x / value.<id>.x
//   turn:<boxId>      per-box clocks
//   cooldown:<cardId> next-eligible turns
//   board:<handId>    hand contents (card ids, dealt order)
// Line format: `${label}${path}: ${from} -> ${to}`, `<unset>` for null.

using System;
using System.Collections.Generic;

namespace StoryletStudio.StoryletEngine
{
    /// <summary>One flattened state transition. Null = unset.</summary>
    public sealed class StateChange
    {
        public string Path;
        public StoryletValue From;
        public StoryletValue To;
    }

    /// <summary>What a product supplies to the kernel logger (design 3.4):
    /// its kernel bags (re-read on every capture, so a product that replaces
    /// its bags on load re-mounts) and its non-property state as flattened
    /// paths.</summary>
    public sealed class StateLoggerAdapter
    {
        public Func<List<BagMount>> Mounts;
        public Func<OrderedMap<string, StoryletValue>> Extra;
    }

    public sealed class StateLogger : IDisposable
    {
        private sealed class Mounted
        {
            public PropertyBag Bag;
            public Action Off;
        }

        private readonly StateLoggerAdapter _adapter;
        private readonly Action<string> _sink;
        private readonly string _label;
        private OrderedMap<string, StoryletValue> _baseline;
        private List<StateChange> _pushed = new List<StateChange>();
        private List<Mounted> _mounted = new List<Mounted>();

        /// <summary>The product-agnostic core: audit-hooked bags plus a
        /// diffed extra snapshot. Sink defaults to Console.WriteLine.</summary>
        public StateLogger(StateLoggerAdapter adapter, Action<string> sink = null, string label = null)
        {
            _adapter = adapter;
            _sink = sink ?? (line => Console.WriteLine(line));
            _label = label ?? "";
            _baseline = Full();
            Mount();
        }

        private static string Show(StoryletValue v)
        {
            return v == null ? "<unset>" : v.ToJsonString();
        }

        private void Emit(StateChange c)
        {
            _sink($"{_label}{c.Path}: {Show(c.From)} -> {Show(c.To)}");
        }

        /// <summary>The full flattened snapshot: every mounted bag's values
        /// under its prefix, plus the adapter's non-property paths.</summary>
        public OrderedMap<string, StoryletValue> Snapshot()
        {
            return Full();
        }

        private OrderedMap<string, StoryletValue> Full()
        {
            var snapshot = new OrderedMap<string, StoryletValue>();
            foreach (var mount in _adapter.Mounts())
            {
                foreach (var pair in mount.Bag.Values) snapshot.Set($"{mount.Prefix}.{pair.Key}", pair.Value);
            }
            foreach (var pair in _adapter.Extra()) snapshot.Set(pair.Key, pair.Value);
            return snapshot;
        }

        private void Hook(string prefix, PropertyBag bag)
        {
            var off = bag.OnAudit(change =>
            {
                // Push-based: the write logs as it lands, prev straight off
                // the audit event; the baseline moves with it so Capture()
                // never re-reports.
                var c = new StateChange { Path = $"{prefix}.{change.Name}", From = change.Prev, To = change.Next };
                Emit(c);
                _pushed.Add(c);
                _baseline.Set(c.Path, change.Next);
            });
            _mounted.Add(new Mounted { Bag = bag, Off = off });
        }

        private void Mount()
        {
            var mounts = _adapter.Mounts();
            var same = _mounted.Count == mounts.Count;
            if (same)
            {
                for (int i = 0; i < mounts.Count; i++)
                {
                    if (!ReferenceEquals(_mounted[i].Bag, mounts[i].Bag)) { same = false; break; }
                }
            }
            if (same) return;
            foreach (var m in _mounted) m.Off();
            _mounted = new List<Mounted>();
            foreach (var mount in mounts) Hook(mount.Prefix, mount.Bag);
        }

        /// <summary>Everything since the last capture: the audited writes
        /// already logged (push-based), plus anything that changed WITHOUT an
        /// audit event (non-property state; bags replaced by a load, which
        /// fires none), diffed, logged, and re-baselined.</summary>
        public List<StateChange> Capture()
        {
            var next = Full();
            var diffed = DiffState(_baseline, next);
            foreach (var c in diffed) Emit(c);
            var changes = new List<StateChange>(_pushed);
            changes.AddRange(diffed);
            _pushed = new List<StateChange>();
            _baseline = next;
            Mount();   // a load replaces the product's bags; re-hook them
            return changes;
        }

        /// <summary>Unhook the bag auditors. The logger is inert afterwards.</summary>
        public void Dispose()
        {
            foreach (var m in _mounted) m.Off();
            _mounted = new List<Mounted>();
            _pushed = new List<StateChange>();
        }

        // --- the shared helpers (the JS logger's exports, same names) --------

        /// <summary>The full flattened snapshot of ONE FLOW's view - the
        /// shared partitions plus that flow's own - straight off the save
        /// envelope, so "what the snapshot sees" is by construction "what a
        /// save persists". @world is not here for the same reason it is not
        /// in the envelope: the host owns that container and mounts/saves it
        /// itself.</summary>
        public static OrderedMap<string, StoryletValue> SnapshotState(Engine engine, Flow flow)
        {
            var env = engine.SaveGame();
            var flowSave = env.Flows.GetOrDefault(flow.Id);
            var snapshot = new OrderedMap<string, StoryletValue>();
            void Bag(string prefix, OrderedMap<string, StoryletValue> values)
            {
                if (values == null) return;
                foreach (var pair in values) snapshot.Set($"{prefix}.{pair.Key}", pair.Value);
            }
            // Shared under the flow's own: names are disjoint (shared XOR
            // per-flow by declaration), so one path space holds both.
            Bag("story", env.Shared.Props.Story);
            Bag("story", flowSave?.Props.Story);
            void Kind(string kind, OrderedMap<string, OrderedMap<string, StoryletValue>> shared, OrderedMap<string, OrderedMap<string, StoryletValue>> own)
            {
                foreach (var pair in shared) Bag($"{kind}.{pair.Key}", pair.Value);
                if (own == null) return;
                foreach (var pair in own) Bag($"{kind}.{pair.Key}", pair.Value);
            }
            Kind("box", env.Shared.Props.Box, flowSave?.Props.Box);
            Kind("deck", env.Shared.Props.Deck, flowSave?.Props.Deck);
            Kind("hand", env.Shared.Props.Hand, flowSave?.Props.Hand);
            Kind("value", env.Shared.Props.Value, flowSave?.Props.Value);
            foreach (var pair in ExtraState(flowSave)) snapshot.Set(pair.Key, pair.Value);
            return snapshot;
        }

        /// <summary>The changed paths between two snapshots, sorted; null =
        /// unset on either side.</summary>
        public static List<StateChange> DiffState(
            OrderedMap<string, StoryletValue> prev, OrderedMap<string, StoryletValue> next)
        {
            var paths = new SortedSet<string>(StringComparer.Ordinal);
            foreach (var pair in prev) paths.Add(pair.Key);
            foreach (var pair in next) paths.Add(pair.Key);
            var changes = new List<StateChange>();
            foreach (var path in paths)
            {
                var from = prev.GetOrDefault(path);
                var to = next.GetOrDefault(path);
                var equal = from == null ? to == null : to != null && from.ValueEquals(to);
                if (!equal) changes.Add(new StateChange { Path = path, From = from, To = to });
            }
            return changes;
        }

        /// <summary>The storylets path-provider adapter for non-property state
        /// (design 3.4): one flow's turns / cooldowns / board, off its blob in
        /// the envelope (null for a just-closed flow: no paths).</summary>
        private static OrderedMap<string, StoryletValue> ExtraState(FlowSave saved)
        {
            var extra = new OrderedMap<string, StoryletValue>();
            if (saved == null) return extra;
            foreach (var pair in saved.Turns) extra.Set($"turn:{pair.Key}", StoryletValue.Num(pair.Value));
            foreach (var pair in saved.Cooldowns) extra.Set($"cooldown:{pair.Key}", StoryletValue.Num(pair.Value));
            foreach (var pair in saved.Board) extra.Set($"board:{pair.Key}", StoryletValue.Flags(pair.Value));
            return extra;
        }

        /// <summary>The storylets state logger: the kernel core mounted on the
        /// SHARED bags (Engine.ListBags()) and one flow's own (Flow.ListBags())
        /// - the same prefixes, one path space, names disjoint - plus the
        /// flow's turns / cooldowns / board adapter. Tracks the flow BY NAME,
        /// so LoadGame's rebuild re-mounts on Capture.</summary>
        public static StateLogger CreateStateLogger(Engine engine, Flow flow, Action<string> sink = null, string label = null)
        {
            var flowId = flow.Id;
            var adapter = new StateLoggerAdapter
            {
                Mounts = () =>
                {
                    var mounts = engine.ListBags();
                    var live = engine.GetFlow(flowId);
                    if (live != null) mounts.AddRange(live.ListBags());
                    return mounts;
                },
                Extra = () => ExtraState(engine.SaveGame().Flows.GetOrDefault(flowId)),
            };
            return new StateLogger(adapter, sink, label);
        }
    }
}
