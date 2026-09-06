// The storylets state logger: the ADAPTER half. The core - push-based property logging on the
// PropertyBag audit hook, the diff for what has no hook, the re-mount that survives a load - is
// the shared kernel's, vendored beside this file as Expr/StateLogger.cs and shared with
// Patterplay. This supplies what is storylets' own: which bags to watch, and the non-property
// state (turns / cooldowns / board) as flattened paths.
//
// Flattened path scheme (the JS play-helpers logger's, verbatim). A property's
// owner segment is its GAMEID (design/engine-server.md 4.4); the three
// non-property keys stay on the internal ids the save envelope is keyed by,
// which is what they are read off:
//   world.x / story.x / box.<gameId>.x / deck.<gameId>.x / hand.<gameId>.x
//   value.<gameId>.x
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
        /// shared partitions plus that flow's own - plus its turns / cooldowns
        /// / board. @world is not here for the same reason it is not in a save
        /// envelope: the host owns that container and mounts/saves it itself.
        ///
        /// Taken off the BAGS, which is what a save envelope is made of, rather
        /// than off the envelope itself. The two used to be interchangeable;
        /// from 4.4 they are not, because a property ADDRESS names its owner by
        /// gameId while the envelope stays keyed by internal id (a save has to
        /// survive a rename). The bags carry the address, so reading them is
        /// what keeps this snapshot and the live logger's lines in ONE path
        /// space - which is the invariant the whole diff rests on.</summary>
        public static OrderedMap<string, StoryletValue> SnapshotState(Engine engine, Flow flow)
        {
            var snapshot = new OrderedMap<string, StoryletValue>();
            // Shared under the flow's own: names are disjoint (shared XOR
            // per-flow by declaration), so one path space holds both.
            var mounts = engine.ListBags();
            mounts.AddRange(flow.ListBags());
            foreach (var mount in mounts)
            {
                foreach (var row in mount.Bag.Rows())
                {
                    if (row.Value != null) snapshot.Set(row.Path, row.Value);
                }
            }
            foreach (var pair in ExtraState(engine.SaveGame().Flows.GetOrDefault(flow.Id))) snapshot.Set(pair.Key, pair.Value);
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
                    // A BagMount's Prefix ("story", "deck.<gameId>") is the engine's label for
                    // the mount; the kernel composes paths from the BAG's own PathPrefix
                    // ("story.", "deck.<gameId>."), so no prefix is passed. The engine builds
                    // both off one AddressOf, so the label and the composed path agree by
                    // construction rather than by two spellings kept in step (4.4).
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
