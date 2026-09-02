// The storylets state logger: the ADAPTER half. The core - push-based property logging on the
// PropertyBag audit hook, the diff for what has no hook, the re-mount that survives a load - is
// the shared kernel's, vendored beside this file as Expr/StateLogger.cs and shared with
// Patterplay. This supplies what is storylets' own: which bags to watch, and the non-property
// state (turns / cooldowns / board) as flattened paths.
//
// Flattened path scheme (the JS play-helpers logger's, verbatim):
//   world.x / story.x / box.<id>.x / deck.<id>.x / hand.<id>.x / value.<id>.x
//   turn:<boxId>      per-box clocks
//   cooldown:<cardId> next-eligible turns
//   board:<handId>    hand contents (card ids, dealt order)
// Line format: `${label}${path}: ${from} -> ${to}`, `<unset>` for null.

using System;
using System.Collections.Generic;

namespace StoryletStudio.StoryletEngine
{
    /// <summary>The storylets pieces of the state logger. The logger itself is the kernel's
    /// StateLogger (Expr/StateLogger.cs); these are the two providers it asks for, plus the
    /// whole-flow snapshot that defines the path space.</summary>
    public static class StoryletStateLogger
    {
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
                    // A BagMount's Prefix ("story", "deck.<id>") is the engine's label for the
                    // mount; the kernel composes paths from the BAG's own PathPrefix ("story.",
                    // "deck.<id>."), so no prefix is passed. Same strings, one owner.
                    var mounts = engine.ListBags();
                    var live = engine.GetFlow(flowId);
                    if (live != null) mounts.AddRange(live.ListBags());
                    var logMounts = new List<LogMount>();
                    foreach (var m in mounts) logMounts.Add(new LogMount { Bag = m.Bag });
                    return logMounts;
                },
                Extra = () => ExtraState(engine.SaveGame().Flows.GetOrDefault(flowId)),
            };
            return new StateLogger(adapter, sink, label);
        }
    }
}
