// The storylets state logger: the ADAPTER half. The core - push-based property logging on
// the PropertyBag audit hook, the diff for what has no hook, the re-mount that survives a
// load - is the shared kernel's, vendored as Storylets/Expr/StateLogger.h and shared with
// Patterplay. This supplies what is storylets' own: which bags to watch, and the
// non-property state (turns / cooldowns / board) as flattened paths.
//
// Flattened path scheme (the JS play-helpers logger's, verbatim):
//   world.x / story.x / box.<gameId>.x / deck.<gameId>.x / hand.<gameId>.x /
//   value.<gameId>.x  the property half, addressed as getProperty addresses it (4.4)
//   turn:<boxId>      per-box clocks
//   cooldown:<cardId> next-eligible turns
//   board:<handId>    hand contents (card ids, dealt order)
// The three colon keys stay on INTERNAL ids: they are the save envelope's own
// keys, and a save is keyed by id so it survives a rename.
// Line format: `${label}${path}: ${from} -> ${to}`, `<unset>` for nullopt.

#pragma once

#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "Storylets/Expr/OrderedMap.h"
#include "Storylets/Expr/PropertyBag.h"
#include "Storylets/Expr/StateLogger.h"
#include "Storylets/Engine.h"
#include "Storylets/StoryletValue.h"

namespace storylets
{
    /** The storylets path-provider adapter for non-property state (design
     *  3.4): turns / cooldowns / board as flattened paths. */
    /** The storylets path-provider adapter for non-property state (design
     *  3.4): one flow's turns / cooldowns / board, off its blob in the
     *  envelope (absent for a just-closed flow: no paths). */
    inline StateSnapshot extraState(const FlowSave* saved)
    {
        StateSnapshot extra;
        if (!saved) return extra;
        for (const auto& pair : saved->turns) extra.set("turn:" + pair.first, StoryletValue::Num(pair.second));
        for (const auto& pair : saved->cooldowns) extra.set("cooldown:" + pair.first, StoryletValue::Num(pair.second));
        for (const auto& pair : saved->board) extra.set("board:" + pair.first, StoryletValue::Flags(pair.second));
        return extra;
    }

    /** The full flattened snapshot of ONE FLOW's view - the shared
     *  partitions plus that flow's own - plus its turns / cooldowns / board.
     *  @world is not here for the same reason it is not in a save envelope:
     *  the host owns that container and mounts/saves it itself.
     *
     *  Taken off the BAGS, which is what a save envelope is made of, rather
     *  than off the envelope itself. The two used to be interchangeable; from
     *  4.4 they are not, because a property ADDRESS names its owner by gameId
     *  while the envelope stays keyed by internal id (a save has to survive a
     *  rename). The bags carry the address, so reading them is what keeps this
     *  snapshot and the live logger's lines in ONE path space. */
    inline StateSnapshot snapshotState(const Engine& engine, const Flow& flow)
    {
        StateSnapshot snapshot;
        // Shared under the flow's own: names are disjoint (shared XOR
        // per-flow by declaration), so one path space holds both.
        std::vector<BagMount> mounts = engine.listBags();
        const std::vector<BagMount> own = flow.listBags();
        mounts.insert(mounts.end(), own.begin(), own.end());
        for (const BagMount& mount : mounts)
        {
            // The bag composes each row's address from its own pathPrefix, so
            // no prefix is pasted on here: same strings, one owner.
            for (const PropertyRow& row : mount.bag->rows()) snapshot.set(row.path, row.value);
        }
        const SaveEnvelope env = engine.saveGame();
        StateSnapshot extra = extraState(env.flows.get(flow.id()));
        for (const auto& pair : extra) snapshot.set(pair.first, pair.second);
        return snapshot;
    }

    /** The storylets state logger: the kernel core mounted on the SHARED
     *  bags (Engine::listBags()) and one flow's own (Flow::listBags()) -
     *  the same prefixes, one path space, names disjoint - plus the flow's
     *  turns / cooldowns / board adapter. Tracks the flow BY NAME, so
     *  loadGame's rebuild re-mounts on capture. */
    inline std::unique_ptr<StateLogger> createStateLogger(Engine& engine, Flow& flow, StateLoggerOptions opts = {})
    {
        const std::string flowId = flow.id();
        Engine* enginePtr = &engine;
        StateLoggerAdapter adapter;
        adapter.mounts = [enginePtr, flowId]()
        {
            // A BagMount's `prefix` ("story", "deck.<id>") is the engine's label for the mount;
            // the kernel composes paths from the BAG's own pathPrefix ("story.", "deck.<id>."),
            // so no prefix is passed. Same strings, one owner.
            std::vector<BagMount> mounts = enginePtr->listBags();
            FlowPtr live = enginePtr->getFlow(flowId);
            if (live)
            {
                std::vector<BagMount> own = live->listBags();
                mounts.insert(mounts.end(), own.begin(), own.end());
            }
            std::vector<LogMount> logMounts;
            logMounts.reserve(mounts.size());
            for (const BagMount& m : mounts) logMounts.push_back(LogMount{m.bag, std::nullopt});
            return logMounts;
        };
        adapter.extra = [enginePtr, flowId]()
        {
            SaveEnvelope env = enginePtr->saveGame();
            return extraState(env.flows.get(flowId));
        };
        return std::make_unique<StateLogger>(std::move(adapter), std::move(opts));
    }
}
