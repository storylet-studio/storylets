// The state logger (parity member: every runtime carries one; design/
// engine-runtimes.md 3.4 is the design of record). Kernel-shaped: property
// logging is PUSH-based on the PropertyBag audit hook - every write, engine
// or host, arrives with prev and reason and logs the moment it lands - while
// the product's non-property state (turns / cooldowns / board) arrives
// through a small path-provider adapter and is diffed on capture(). The
// kernel core (the StateLogger class over a StateLoggerAdapter) is
// product-agnostic and moves into the shared kernel wholesale when the
// vendor-sync slice lands; createStateLogger is the storylets adapter over
// it. Flattened path scheme (the JS play-helpers logger's, verbatim):
//   world.x / story.x / box.<id>.x / deck.<id>.x / hand.<id>.x / value.<id>.x
//   turn:<boxId>      per-box clocks
//   cooldown:<cardId> next-eligible turns
//   board:<handId>    hand contents (card ids, dealt order)
// Line format: `${label}${path}: ${from} -> ${to}`, `<unset>` for nullopt.
#pragma once

#include <cstdio>
#include <functional>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "Storylets/Expr/OrderedMap.h"
#include "Storylets/Expr/PropertyBag.h"
#include "Storylets/Engine.h"
#include "Storylets/StoryletValue.h"

namespace storylets
{
    /** A flattened snapshot: path -> value. */
    using StateSnapshot = OrderedMap<std::string, StoryletValue>;

    /** One flattened state transition. nullopt = unset. */
    struct StateChange
    {
        std::string path;
        std::optional<StoryletValue> from;
        std::optional<StoryletValue> to;
    };

    /** What a product supplies to the kernel logger (design 3.4): its kernel
     *  bags (re-read on every capture, so a product that replaces its bags
     *  on load re-mounts) and its non-property state as flattened paths. */
    struct StateLoggerAdapter
    {
        std::function<std::vector<BagMount>()> mounts;
        std::function<StateSnapshot()> extra;
    };

    struct StateLoggerOptions
    {
        /** Where lines go; defaults to stdout. */
        std::function<void(const std::string&)> sink;
        /** Prefixed to every line (e.g. "[board] "). */
        std::string label;
    };

    /** The changed paths between two snapshots, sorted; nullopt = unset on
     *  either side. */
    inline std::vector<StateChange> diffState(const StateSnapshot& prev, const StateSnapshot& next)
    {
        std::set<std::string> paths;
        for (const auto& pair : prev) paths.insert(pair.first);
        for (const auto& pair : next) paths.insert(pair.first);
        std::vector<StateChange> changes;
        for (const std::string& path : paths)
        {
            const StoryletValue* from = prev.get(path);
            const StoryletValue* to = next.get(path);
            const bool equal = from == nullptr ? to == nullptr
                : to != nullptr && from->valueEquals(*to);
            if (!equal)
            {
                StateChange c;
                c.path = path;
                if (from) c.from = *from;
                if (to) c.to = *to;
                changes.push_back(std::move(c));
            }
        }
        return changes;
    }

    /** The product-agnostic core: audit-hooked bags plus a diffed extra
     *  snapshot. */
    class StateLogger
    {
    public:
        explicit StateLogger(StateLoggerAdapter adapter, StateLoggerOptions opts = {})
            : adapter_(std::move(adapter))
            , sink_(opts.sink ? std::move(opts.sink)
                : [](const std::string& line) { std::fputs((line + "\n").c_str(), stdout); })
            , label_(std::move(opts.label))
        {
            baseline_ = full();
            mount();
        }

        StateLogger(const StateLogger&) = delete;
        StateLogger& operator=(const StateLogger&) = delete;

        ~StateLogger() { dispose(); }

        /** The full flattened snapshot: every mounted bag's values under its
         *  prefix, plus the adapter's non-property paths. */
        StateSnapshot snapshot() const { return full(); }

        /** Everything since the last capture: the audited writes already
         *  logged (push-based), plus anything that changed WITHOUT an audit
         *  event (non-property state; bags replaced by a load, which fires
         *  none), diffed, logged, and re-baselined. */
        std::vector<StateChange> capture()
        {
            StateSnapshot next = full();
            std::vector<StateChange> diffed = diffState(baseline_, next);
            for (const StateChange& c : diffed) emit(c);
            std::vector<StateChange> changes = std::move(pushed_);
            pushed_.clear();
            changes.insert(changes.end(), diffed.begin(), diffed.end());
            baseline_ = std::move(next);
            mount();   // a load replaces the product's bags; re-hook them
            return changes;
        }

        /** Unhook the bag auditors. The logger is inert afterwards. */
        void dispose()
        {
            for (const Mounted& m : mounted_) m.off();
            mounted_.clear();
            pushed_.clear();
        }

    private:
        struct Mounted
        {
            std::shared_ptr<PropertyBag> bag;
            PropertyBag::Unsubscribe off;
        };

        static std::string show(const std::optional<StoryletValue>& v)
        {
            return v.has_value() ? v->toJsonString() : "<unset>";
        }

        void emit(const StateChange& c) const
        {
            sink_(label_ + c.path + ": " + show(c.from) + " -> " + show(c.to));
        }

        StateSnapshot full() const
        {
            StateSnapshot out;
            for (const BagMount& m : adapter_.mounts())
            {
                for (const auto& pair : m.bag->values()) out.set(m.prefix + "." + pair.first, pair.second);
            }
            for (const auto& pair : adapter_.extra()) out.set(pair.first, pair.second);
            return out;
        }

        void hook(const std::string& prefix, const std::shared_ptr<PropertyBag>& bag)
        {
            PropertyBag::Unsubscribe off = bag->onAudit([this, prefix](const BagChange& change)
            {
                // Push-based: the write logs as it lands, prev straight off
                // the audit event; the baseline moves with it so capture()
                // never re-reports.
                StateChange c;
                c.path = prefix + "." + change.name;
                c.from = change.prev;
                c.to = change.next;
                emit(c);
                baseline_.set(c.path, change.next);
                pushed_.push_back(std::move(c));
            });
            mounted_.push_back({bag, std::move(off)});
        }

        void mount()
        {
            std::vector<BagMount> mounts = adapter_.mounts();
            bool same = mounted_.size() == mounts.size();
            if (same)
            {
                for (size_t i = 0; i < mounts.size(); ++i)
                {
                    if (mounted_[i].bag != mounts[i].bag) { same = false; break; }
                }
            }
            if (same) return;
            for (const Mounted& m : mounted_) m.off();
            mounted_.clear();
            for (const BagMount& m : mounts) hook(m.prefix, m.bag);
        }

        StateLoggerAdapter adapter_;
        std::function<void(const std::string&)> sink_;
        std::string label_;
        StateSnapshot baseline_;
        std::vector<StateChange> pushed_;
        std::vector<Mounted> mounted_;
    };

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
     *  partitions plus that flow's own - straight off the save envelope, so
     *  "what the snapshot sees" is by construction "what a save persists".
     *  @world is not here for the same reason it is not in the envelope:
     *  the host owns that container and mounts/saves it itself. */
    inline StateSnapshot snapshotState(const Engine& engine, const Flow& flow)
    {
        SaveEnvelope env = engine.saveGame();
        const FlowSave* flowSave = env.flows.get(flow.id());
        StateSnapshot snapshot;
        auto bag = [&snapshot](const std::string& prefix, const OrderedMap<std::string, StoryletValue>& values)
        {
            for (const auto& pair : values) snapshot.set(prefix + "." + pair.first, pair.second);
        };
        // Shared under the flow's own: names are disjoint (shared XOR
        // per-flow by declaration), so one path space holds both.
        bag("story", env.shared.props.story);
        if (flowSave) bag("story", flowSave->props.story);
        auto kind = [&bag](const char* k,
            const OrderedMap<std::string, OrderedMap<std::string, StoryletValue>>& shared,
            const OrderedMap<std::string, OrderedMap<std::string, StoryletValue>>* own)
        {
            for (const auto& pair : shared) bag(std::string(k) + "." + pair.first, pair.second);
            if (!own) return;
            for (const auto& pair : *own) bag(std::string(k) + "." + pair.first, pair.second);
        };
        kind("box", env.shared.props.box, flowSave ? &flowSave->props.box : nullptr);
        kind("deck", env.shared.props.deck, flowSave ? &flowSave->props.deck : nullptr);
        kind("hand", env.shared.props.hand, flowSave ? &flowSave->props.hand : nullptr);
        kind("value", env.shared.props.value, flowSave ? &flowSave->props.value : nullptr);
        StateSnapshot extra = extraState(flowSave);
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
            std::vector<BagMount> mounts = enginePtr->listBags();
            FlowPtr live = enginePtr->getFlow(flowId);
            if (live)
            {
                std::vector<BagMount> own = live->listBags();
                mounts.insert(mounts.end(), own.begin(), own.end());
            }
            return mounts;
        };
        adapter.extra = [enginePtr, flowId]()
        {
            SaveEnvelope env = enginePtr->saveGame();
            return extraState(env.flows.get(flowId));
        };
        return std::make_unique<StateLogger>(std::move(adapter), std::move(opts));
    }
}
