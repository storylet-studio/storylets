// The Engine + Flow: the world + flow manager and the personal playthrough
// (design/flows.md; the shape is Patter's), transliterated from the
// reference runtime (packages/runtime/src/engine.ts) and held to the
// conformance corpus. An Engine owns the bundle, the lookups, the SHARED
// property partitions and the @world resolver (never in saveGame() - the
// host saves its container); a Flow owns its own PRNG, clocks, cooldowns,
// board, claims, play history and per-flow partitions. Every name is
// shared XOR per-flow by declaration, so a read is a union of two bags and
// a write routes by name. No default flow, no ambient flow: openFlow(id)
// is the only way in, an existing id is REPLACED, closed handles are
// INERT, and engine-level reads of per-flow refs throw the teaching error.
//
// Key dealing contracts, per flow, in one place:
//   - two verbs: deal(hand) claims, peek(box, criteria) just looks; you can
//     never play a card you only peeked (3.1, look/use rule)
//   - availability order: deck gate -> cooldown -> tags -> hand condition ->
//     card condition -> claims (3.1)
//   - claims are physical WITHIN a flow: a card sits in at most `copies` hands
//     of that flow's board at once, at most once in any one hand; the ledger
//     is derived from the board contents (3.5)
//   - a SHARED card (its deck's flag, or its own overriding it) is scarce
//     across flows too: at most `sharedCopies` hands anywhere, counted over
//     every live flow's board, and a shared `redraw: "never"` is spent for
//     everyone the first time anyone plays it. A finite redraw deliberately
//     does NOT share: a cooldown is an absolute turn of this flow's box clock
//     (design/shared-scarcity.md)
//   - the reserved home group inverts the wildcard: a homed card is available
//     only to an ask binding its home (2.4)
//   - ranking: priority desc -> specificity desc (box toggle) -> seeded
//     shuffle of each maximal tie run (3.2); sorts are STABLE
//     (std::stable_sort; never a bare std::sort over candidates)
//   - one PRNG per flow: expression random(), tie shuffles and the batch
//     deal's hand-order shuffle all advance it; state lives in the save (3.3)
//   - each box has its own turn counter; cooldowns are absolute next-eligible
//     turns of the card's box's clock, set at play time from the post-advance
//     turn; "never" is MAX_SAFE_INTEGER, not Infinity (3.4)
//   - @hand composes bound-tag props -> hand props -> chosen tags/criteria
//     (by group name), later shadowing earlier; writes route back to their
//     source; criteria names cannot be written (3.6)
//   - outcome availability is never snapshotted: outcomes() and play()
//     evaluate gates against current state (3.1, 3.7)
//   - a trace event fires after the state it reports has landed, so a
//     handler reading the flow inside it sees the effect (the Live Link's
//     board snapshot depends on this; the shared fixture pins it)
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <functional>
#include <limits>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include "Storylets/Ast.h"
#include "Storylets/Bundle.h"
#include "Storylets/Dialect.h"
#include "Storylets/Expression.h"
#include "Storylets/Mulberry32.h"
#include "Storylets/Expr/OrderedMap.h"
#include "Storylets/Expr/PropertyBag.h"
#include "Storylets/Specificity.h"
#include "Storylets/StoryletValue.h"

namespace storylets
{
    /** The host's @world resolver - the values the game owns. `set` may be
     *  left empty for a read-only binding. */
    struct WorldResolver
    {
        std::function<std::optional<StoryletValue>(const std::string&)> get;
        std::function<void(const std::string&, const StoryletValue&)> set;
    };

    struct EngineOptions
    {
        /** Default seed for each flow's PRNG; override per flow in openFlow
         *  (cross-runtime determinism, schema 3.3). Default 0. */
        double seed = 0;
        /** Retain each flow's event log for introspection. Off by default;
         *  subscribeTrace stays the zero-retention stream. */
        bool log = false;
        /** Retained log cap (oldest dropped first) when log is on. */
        int logCap = 1000;
        /** The host's @world binding; absent = self-backed from the declared
         *  defaults. Engine-level, shared by all flows, never in saveGame(). */
        std::optional<WorldResolver> world;
        /** Diagnostics hook (opt-in, dev only): fired when openFlow REPLACES a
         *  flow that still had cards dealt (flow id, count). Behaviour is
         *  unchanged; this makes observable the host that calls openFlow straight
         *  after loadGame and discards the restored hand - getFlow is the call.
         *  Parity with the JS runtime's onReplacedFlow. Zero cost when unset. */
        std::function<void(const std::string&, int)> onReplacedFlow;
    };

    struct OpenFlowOptions
    {
        /** Seed for this flow's PRNG (absent = the engine's seed). */
        std::optional<double> seed;
    };

    /** A card view in a dealt hand or a peeked list. Carries NO outcome
     *  availability - ask outcomes() for current truth (schema 5). */
    struct DealtCard
    {
        std::string id;
        std::string gameId;
        std::string title;
        std::string purpose;
        OrderedMap<std::string, StoryletValue> fields;
    };

    struct OutcomeView
    {
        std::string id;
        std::string gameId;
        std::string title;
        std::string purpose;
        /** Evaluated against CURRENT state at the moment of the ask. */
        bool available = false;
    };

    /** What a peek returns: the top of the stock, looked at and put back. The
     *  engine has no pick policy (Reboot 2.1). */
    struct RankedList
    {
        std::string box;
        std::vector<DealtCard> cards;
    };

    struct PlayOptions
    {
        /** Turn advance override; default settings.playAdvancesTurns. */
        std::optional<double> advanceTurns;
    };

    // --- the trace (schema 5): the deal/play log for tooling ------------------

    /** Why a card did or did not make an ask, in availability order (schema 3.1). */
    enum class TraceVerdict
    {
        Dealt,          // in the hand / the returned list
        Capped,         // eligible, ranked below the size cap
        Cooldown,       // schema 3.1 step 1
        DeckGate,       // step 2
        Tags,           // step 3 (incl. the home group's inverted default)
        Condition,      // steps 4-5 (a failing or erroring condition)
        Priority,       // a priority expression errored or was not a number
        Claimed,          // step 6: no free copy on YOUR board
        ClaimedElsewhere, // step 6: another flow holds the world's copies
        Taken,            // a shared redraw:never was spent, by anyone, for everyone
    };

    struct TraceCard
    {
        std::string id;
        TraceVerdict verdict = TraceVerdict::Dealt;
        std::optional<double> priority;
        std::optional<double> specificity;
    };

    /** One event on the deal/play log, as a single tagged struct (the C++
     *  shape of the reference's event-type union; the kind is the verb, so a
     *  peek is distinguishable from a deal when reading a run back). Only
     *  the fields the kind names are meaningful. */
    struct TraceEvent
    {
        enum class Kind { Deal, Peek, Evict, Play, Write, Turns, Diagnostic };

        Kind kind = Kind::Deal;
        /** Deal: hand gameId. Evict: hand id. */
        std::string hand;
        /** Peek / Turns: box gameId. */
        std::string box;
        /** Evict / Play: card id. */
        std::string card;
        /** Play: outcome gameId. */
        std::string outcome;
        /** Evict: a verdict wire name, or "hand-condition" / "vanished". */
        std::string reason;
        /** Write: the authored target and the resolved store location (a
         *  routed @hand write shows where it actually went, schema 3.6). */
        std::string target;
        std::string path;
        /** Write: the landed value and the value it replaced ("0 -> 1"). */
        std::optional<StoryletValue> value;
        std::optional<StoryletValue> prev;
        /** Diagnostic: an expression eval error - never a silent pass (schema
         *  3.1), always a visible diagnostic. */
        std::string where;
        std::string message;
        /** Peek: the ask's criteria. */
        OrderedMap<std::string, std::string> criteria;
        /** Deal / Peek: per-card verdicts. */
        std::vector<TraceCard> cards;
        /** Play / Turns: the box's (new) turn. */
        double turn = 0;
    };

    /** A retained log entry: the trace event plus its place in the flow's time.
     *  seq orders the whole flow (monotonic; survives clearLog). turn is
     *  the clock of the box the event happened in when it fired. Diagnostics
     *  carry no turn. */
    struct LogEntry
    {
        TraceEvent event;
        int64_t seq = 0;
        std::optional<double> turn;
    };

    /** One entry on the ENGINE's log: the same event, plus the flow it happened
     *  in. A run is several flows over shared state, so "what happened in this
     *  run" is only answerable in one ordered stream, and only if each line says
     *  who (design/shared-scarcity.md 8.2). */
    struct EngineLogEntry
    {
        TraceEvent event;
        std::string flow;
        int64_t seq = 0;
        std::optional<double> turn;
    };

    // PropertyView is gone. It was the shared PropertyRow plus a `path`, and `path` moved
    // onto that row on 2026-09-02 - so the name was a synonym, and a synonym for a shared
    // type is how the two families drifted: the same row called PropertyView here,
    // ScopePropertyRow next to it, PropertyRow in the kernel. listProperties() returns
    // PropertyRow, in this runtime and in Patterplay's.

    /** One kernel bag with its store path prefix (world / story / box.<id> /
     *  deck.<id> / hand.<id> / value.<id>): the state logger's mount surface
     *  (design/engine-runtimes.md 3.4 - the logger builds on the PropertyBag
     *  audit hook, so it needs the bags themselves, not just their rows).
     *  load() replaces the flow's bags, so re-enumerate after a load. */
    struct BagMount
    {
        std::string prefix;
        std::shared_ptr<PropertyBag> bag;
    };

    /** One box on the enumeration surface (examiners, hosts): identity plus
     *  its clock. */
    struct BoxView
    {
        std::string id;
        std::string gameId;
        /** Empty when the box has no title. */
        std::string title;
        double turn = 0;
    };

    inline const char* VerdictWire(TraceVerdict v)
    {
        switch (v)
        {
            case TraceVerdict::Dealt: return "dealt";
            case TraceVerdict::Capped: return "capped";
            case TraceVerdict::Cooldown: return "cooldown";
            case TraceVerdict::DeckGate: return "deck-gate";
            case TraceVerdict::Tags: return "tags";
            case TraceVerdict::Condition: return "condition";
            case TraceVerdict::Priority: return "priority";
            case TraceVerdict::ClaimedElsewhere: return "claimed-elsewhere";
            case TraceVerdict::Taken: return "taken";
            default: return "claimed";
        }
    }

    namespace detail
    {
        struct CardEntry
        {
            const Card* card = nullptr;
            const Deck* deck = nullptr;
            const Box* box = nullptr;
        };

        struct HandInBox
        {
            const Hand* hand = nullptr;
            const Box* box = nullptr;
        };

        struct GroupInBox
        {
            const TagGroup* group = nullptr;
            const Box* box = nullptr;
        };

        /** One side's five stores (shared on the engine, per-flow on each
         *  flow). */
        struct Partition
        {
            std::shared_ptr<PropertyBag> story;
            OrderedMap<std::string, std::shared_ptr<PropertyBag>> box;
            OrderedMap<std::string, std::shared_ptr<PropertyBag>> deck;
            OrderedMap<std::string, std::shared_ptr<PropertyBag>> hand;
            OrderedMap<std::string, std::shared_ptr<PropertyBag>> value;
        };

        /** The per-flow halves of every declaration list. */
        struct FlowDecls
        {
            std::vector<PropertyDecl> story;
            OrderedMap<std::string, std::vector<PropertyDecl>> box;
            OrderedMap<std::string, std::vector<PropertyDecl>> deck;
            OrderedMap<std::string, std::vector<PropertyDecl>> hand;
            OrderedMap<std::string, std::vector<PropertyDecl>> value;
        };
    }

    class Flow;
    using FlowPtr = std::shared_ptr<Flow>;

    /** The world + flow manager (design/flows.md; the shape is Patter's):
     *  owns the bundle, every lookup built from it, the SHARED property
     *  partitions and the @world resolver; ALL play happens on a Flow from
     *  openFlow(id). @world is never in saveGame() - the host saves its
     *  container, each engine saves its own envelope. */
    class Engine
    {
    public:
        explicit Engine(BundlePtr bundle, const EngineOptions& opts = {});

        Engine(const Engine&) = delete;
        Engine& operator=(const Engine&) = delete;

        /** Open (or REPLACE) the named flow. An existing id's flow is closed
         *  first - re-opening a name is a reset of that name's whole
         *  per-flow state; shared state is untouched. There is no default
         *  flow: "main" is a caller convention, not an engine rule. */
        FlowPtr openFlow(const std::string& id, const OpenFlowOptions& opts = {});

        FlowPtr getFlow(const std::string& id) const
        {
            const FlowPtr* found = flows_.get(id);
            return found ? *found : nullptr;
        }

        /** Every live flow, open order. */
        std::vector<FlowPtr> flows() const
        {
            std::vector<FlowPtr> out;
            for (const auto& pair : flows_) out.push_back(pair.second);
            return out;
        }

        /** Close the named flow: its handle goes INERT (every verb throws).
         *  Unknown ids are a quiet no-op. */
        void closeFlow(const std::string& id);

        /** Close every flow and reseed the shared state to its defaults (the
         *  self-backed @world included; a host-bound @world is the host's). */
        void reset();

        // --- shared scarcity (design/shared-scarcity.md) ----------------------

        /** Cards a shared `redraw: never` has taken out of the world, by card
         *  id. The claim ledger is DERIVED from live boards and needs no
         *  storage; this one is durable, so it rides the save. */
        bool isTaken(const std::string& cardId) const { return spent_.count(cardId) > 0; }
        void markTaken(const std::string& cardId) { spent_.insert(cardId); }

        /** Shared claims across every LIVE flow, card id -> holders. Derived,
         *  which is what makes closeFlow and the openFlow replace release what
         *  a flow was holding: its board leaves the map with it. */
        std::unordered_map<std::string, int> sharedClaims() const;

        // --- the run's log (design/shared-scarcity.md 8.2) --------------------

        /** Every flow's events in one ordered stream, each tagged with its flow.
         *  Opt in with the same `log` option the flow logs use; capped the same.
         *
         *  This exists because a flow's own log cannot answer the question a run
         *  raises: when a story action in ANOTHER flow moves shared state, your
         *  flow's log says nothing and your value simply changes. */
        const std::vector<EngineLogEntry>& log() const { return engineLog_; }
        void clearLog() { engineLog_.clear(); }

        /** Read shared state by path: "world.x", "story.gold" (when shared),
         *  "box.b_x.heat" (when shared). A ref that resolves PER-FLOW throws,
         *  naming the fix (Patter's teaching rule). */
        StoryletValue getProperty(const std::string& path) const;

        void setProperty(const std::string& path, const StoryletValue& value);

        /** The shared surface as examiner rows: @world (read through the
         *  resolver) then the shared partitions. */
        std::vector<PropertyRow> listProperties() const;

        /** The SHARED kernel bags with their store path prefixes (the state
         *  logger's mount surface). The @world container is the host's own. */
        std::vector<BagMount> listBags() const
        {
            std::vector<BagMount> mounts;
            mounts.push_back({"story", shared_.story});
            for (const auto& pair : shared_.box) mounts.push_back({"box." + pair.first, pair.second});
            for (const auto& pair : shared_.deck) mounts.push_back({"deck." + pair.first, pair.second});
            for (const auto& pair : shared_.hand) mounts.push_back({"hand." + pair.first, pair.second});
            for (const auto& pair : shared_.value) mounts.push_back({"value." + pair.first, pair.second});
            return mounts;
        }

        /** Every flow's trace, one stream, each event tagged with its flow id
         *  - the tools' one stream. Returns the unsubscribe. */
        std::function<void()> subscribeTrace(std::function<void(const std::string&, const TraceEvent&)> handler)
        {
            uint64_t id = nextEngineTraceId_++;
            engineTraceHandlers_.push_back({id, std::move(handler)});
            return [this, id]()
            {
                engineTraceHandlers_.erase(
                    std::remove_if(engineTraceHandlers_.begin(), engineTraceHandlers_.end(),
                        [id](const EngineTraceHandler& h) { return h.first == id; }),
                    engineTraceHandlers_.end());
            };
        }

        /** The whole engine, one envelope: the shared partitions once, then
         *  every live flow keyed by its id. @world is NEVER here. */
        SaveEnvelope saveGame() const;

        /** Restore: shared state once, then every flow REBUILT from its
         *  blob. Handles held from before the load are closed and inert;
         *  take fresh ones from getFlow()/flows(). */
        void loadGame(const SaveEnvelope& envelope);

        // --- the @world seam (used by flows and hosts alike) -----------------

        std::optional<StoryletValue> worldGet(const std::string& name) const
        {
            if (hostWorld_.has_value()) return hostWorld_->get(name);
            return selfWorld_->get(name);
        }

        bool worldCanSet() const
        {
            return hostWorld_.has_value() ? static_cast<bool>(hostWorld_->set) : true;
        }

        void worldSet(const std::string& name, const StoryletValue& value)
        {
            if (hostWorld_.has_value()) hostWorld_->set(name, value);
            else selfWorld_->set(name, value);
        }

    private:
        friend class Flow;

        using EngineTraceHandler = std::pair<uint64_t, std::function<void(const std::string&, const TraceEvent&)>>;

        /** The sharing default per scope (design/flows.md): @story shared,
         *  the narrower geographic scopes per-flow. */
        static bool isShared(const std::string& scope, const PropertyDecl& d)
        {
            if (d.shared.has_value()) return *d.shared;
            return scope == "story";
        }

        static std::vector<PropertyDecl> half(
            const std::string& scope, const std::vector<PropertyDecl>& decls, bool shared)
        {
            std::vector<PropertyDecl> out;
            for (const auto& d : decls)
            {
                if (isShared(scope, d) == shared) out.push_back(d);
            }
            return out;
        }

        // Stores are shared-kernel bags: identity normalisation because
        // storylets property names are case-significant as authored.
        // pathPrefix carries its own separator, so a bag composes its rows' addresses
        // itself ("story.gold", "deck.tavern.drawn") instead of each caller pasting one on.
        static std::shared_ptr<PropertyBag> bagFromDecls(const std::vector<PropertyDecl>& decls,
                                                         const std::string& pathPrefix)
        {
            // PropertyDecl extends ScopeDeclaration; seed a plain declaration list.
            std::vector<ScopeDeclaration> plain(decls.begin(), decls.end());
            return std::make_shared<PropertyBag>(&plain, [](const std::string& n) { return n; }, pathPrefix);
        }

        const std::vector<PropertyDecl>& handDecls(const Hand& hand) const
        {
            static const std::vector<PropertyDecl> empty;
            if (!hand.templateId.empty())
            {
                const HandTemplate* const* known = templatesById_.get(hand.templateId);
                if (known) return (*known)->properties;
                for (const auto& box : bundle_->boxes)
                {
                    for (const auto& t : box.handTemplates)
                    {
                        if (t.id == hand.templateId) return t.properties;
                    }
                }
                return empty;
            }
            return hand.properties;
        }

        /** Build the shared stores and the @world seam. */
        void initShared()
        {
            detail::Partition shared;
            shared.story = bagFromDecls(half("story", bundle_->story.properties, true), "story.");
            for (const auto& box : bundle_->boxes)
            {
                shared.box.set(box.id, bagFromDecls(half("box", box.properties, true), "box." + box.id + "."));
                for (const auto& deck : box.decks)
                {
                    shared.deck.set(deck.id, bagFromDecls(half("deck", deck.properties, true), "deck." + deck.id + "."));
                }
                for (const auto& hand : box.hands)
                {
                    shared.hand.set(hand.id, bagFromDecls(half("hand", handDecls(hand), true), "hand." + hand.id + "."));
                }
                for (const auto& group : box.tagGroups)
                {
                    for (const auto& tag : group.tags)
                    {
                        shared.value.set(tag.id, bagFromDecls(half("value", tag.properties, true), "value." + tag.id + "."));
                    }
                }
            }
            shared_ = std::move(shared);
            if (!hostWorld_.has_value())
            {
                // Standalone: self-backed from the declared defaults. Still
                // FOREIGN in spirit - never in saveGame(); a host that wants
                // @world to persist saves the container itself.
                selfWorld_ = bagFromDecls(bundle_->world.properties, "world.");
            }
        }

        void initLadders();

        void emitEngine(const std::string& flowId, const TraceEvent& evt, std::optional<double> turn)
        {
            // Retain first, then notify: the run's log is the record,
            // subscribers are the live view, and a handler that reads log()
            // should see its own event.
            if (logCap_.has_value())
            {
                EngineLogEntry entry;
                entry.event = evt;
                entry.flow = flowId;
                entry.seq = engineSeq_++;
                entry.turn = turn;
                engineLog_.push_back(std::move(entry));
                if (engineLog_.size() > static_cast<size_t>(*logCap_))
                {
                    engineLog_.erase(engineLog_.begin(),
                        engineLog_.begin() + (engineLog_.size() - static_cast<size_t>(*logCap_)));
                }
            }
            std::vector<EngineTraceHandler> handlers = engineTraceHandlers_;
            for (const auto& handler : handlers) handler.second(flowId, evt);
        }

        // --- the run's log (design/shared-scarcity.md 8.2) --------------------

        /** Every flow's events in one ordered stream, each tagged with its flow.
         *  Opt in with the same `log` option the flow logs use; capped the same.
         *
         *  This exists because a flow's own log cannot answer the question a run
         *  raises: when a story action in ANOTHER flow moves shared state, your
         *  flow's log says nothing and your value simply changes. */


        bool engineTracing() const { return !engineTraceHandlers_.empty(); }

        BundlePtr bundle_;
        double seed_ = 0;
        std::function<void(const std::string&, int)> onReplacedFlow_;
        std::optional<int> logCap_;
        std::optional<WorldResolver> hostWorld_;
        std::shared_ptr<PropertyBag> selfWorld_;
        detail::Partition shared_;
        detail::FlowDecls flowDecls_;
        OrderedMap<std::string, FlowPtr> flows_;
        /** The shared spend ledger; see isTaken / markTaken. */
        std::unordered_set<std::string> spent_;
        std::vector<EngineLogEntry> engineLog_;
        int64_t engineSeq_ = 0;
        std::vector<std::string> spentIds() const;
        std::vector<EngineTraceHandler> engineTraceHandlers_;
        uint64_t nextEngineTraceId_ = 1;

        // Lookups (bundle is immutable; built once). Shared with every flow.
        OrderedMap<std::string, detail::CardEntry> cardsById_;
        /** Does ANY deck or card in the bundle opt into shared scarcity? False
         *  for the overwhelming majority of projects, and when it is false the
         *  two claim-ledger walks in dealing are skipped entirely. That matters
         *  most here: sharedClaims walks every live flow's board and copies each
         *  held card id, so an unshared bundle was paying two heap allocations
         *  per held card per flow on every deal for a feature it never used. */
        bool hasShared_ = false;
        OrderedMap<std::string, detail::CardEntry> cardsByGameId_;
        OrderedMap<std::string, const Box*> boxesByGameId_;
        OrderedMap<std::string, const Box*> boxesById_;
        OrderedMap<std::string, detail::HandInBox> handsById_;
        OrderedMap<std::string, detail::HandInBox> handsByGameId_;
        OrderedMap<std::string, const HandTemplate*> templatesById_;
        OrderedMap<std::string, detail::GroupInBox> groupsById_;
        std::unordered_set<std::string> requiredGroups_;

        // Quality ladders (quality.md), declaration-level so partition-blind.
        std::unordered_map<std::string, std::vector<std::string>> worldLadders_;
        std::unordered_map<std::string, std::vector<std::string>> storyLadders_;
        std::unordered_map<std::string, std::unordered_map<std::string, std::vector<std::string>>> boxLadders_;
        std::unordered_map<std::string, std::unordered_map<std::string, std::vector<std::string>>> deckLadders_;
        std::unordered_map<std::string, std::unordered_map<std::string, std::vector<std::string>>> valueLadders_;
        std::unordered_map<std::string, std::unordered_map<std::string, std::vector<std::string>>> handLadders_;
        bool hasQualities_ = false;
    };

    /** One personal playthrough over the engine's world: the play verbs,
     *  with this flow's own PRNG, clocks, cooldowns, board, claims and play
     *  history. Built by Engine::openFlow only; a closed flow's handle is
     *  inert (every verb throws). */
    class Flow
    {
    private:
        using CardEntry = detail::CardEntry;
        using HandInBox = detail::HandInBox;
        using GroupInBox = detail::GroupInBox;
        using TraceHandler = std::pair<uint64_t, std::function<void(const TraceEvent&)>>;

    public:
        Flow(Engine* engine, std::string id, double seed)
            : engine_(engine), id_(std::move(id)), prng_(seed)
        {
            const detail::FlowDecls& fd = engine_->flowDecls_;
            stores_.story = Engine::bagFromDecls(fd.story, "story.");
            for (const auto& pair : fd.box) stores_.box.set(pair.first, Engine::bagFromDecls(pair.second, "box." + pair.first + "."));
            for (const auto& pair : fd.deck) stores_.deck.set(pair.first, Engine::bagFromDecls(pair.second, "deck." + pair.first + "."));
            for (const auto& pair : fd.hand) stores_.hand.set(pair.first, Engine::bagFromDecls(pair.second, "hand." + pair.first + "."));
            for (const auto& pair : fd.value) stores_.value.set(pair.first, Engine::bagFromDecls(pair.second, "value." + pair.first + "."));
            for (const auto& box : engine_->bundle_->boxes)
            {
                turnCounts_.set(box.id, 0);
                hostsByBox_.set(box.id, makeHost(box));
                for (const auto& hand : box.hands) boardContents_.set(hand.id, {});
            }
        }

        Flow(const Flow&) = delete;
        Flow& operator=(const Flow&) = delete;

        /** The flow's name - the address the host opened it under. */
        const std::string& id() const { return id_; }

        bool isClosed() const { return closed_; }

        /** Close this flow: the handle goes inert, every verb throws. */
        void close()
        {
            if (closed_) return;
            const FlowPtr* held = engine_->flows_.get(id_);
            if (held && held->get() == this) engine_->flows_.remove(id_);
            markClosed();
        }

        void markClosed() { closed_ = true; }

        /** A box's current turn (schema 3.4), on THIS flow's clock. */
        double turn(const std::string& boxRef) const
        {
            assertOpen();
            const Box* box = resolveBox(boxRef);
            if (!box) throw StoryletError("unknown box \"" + boxRef + "\"");
            return turnCounts_.getOr(box->id, 0);
        }

        /** Subscribe to the deal/play trace (schema 5). Returns the
         *  unsubscribe. With no subscribers the flow does no trace work at
         *  all. */
        std::function<void()> subscribeTrace(std::function<void(const TraceEvent&)> handler)
        {
            uint64_t id = nextTraceId_++;
            traceHandlers_.push_back({id, std::move(handler)});
            return [this, id]()
            {
                traceHandlers_.erase(
                    std::remove_if(traceHandlers_.begin(), traceHandlers_.end(),
                        [id](const TraceHandler& h) { return h.first == id; }),
                    traceHandlers_.end());
            };
        }

        /** The retained flow log (opt-in via EngineOptions::log),
         *  oldest first, capped. The introspection seam for hosts and tools;
         *  the durable play history in a save stays the play log (schema 4) -
         *  the log is a flow-lifetime utility and is NOT saved. */
        const std::vector<LogEntry>& log() const { return logEntries_; }

        /** Empty the retained log; seq keeps counting, so ordering across a
         *  clear stays meaningful. */
        void clearLog() { logEntries_.clear(); }

        // --- host surface (schema 5) --------------------------------------------

        /** Look at the top of the stock through raw tag criteria (schema 3.1):
         *  claims respected, nothing registered, nothing left behind but the
         *  trace line. You can never play a card you only peeked. */
        RankedList peek(
            const std::string& boxRef,
            const OrderedMap<std::string, std::string>& criteria = {},
            std::optional<int> n = std::nullopt)
        {
            assertOpen();
            const Box* box = resolveBox(boxRef);
            if (!box) throw StoryletError("unknown box \"" + boxRef + "\"");
            AskDescriptor ask = askForPeek(*box, criteria);
            std::unordered_map<std::string, int> claimCounts = claims();
            // Skipped outright when the bundle shares nothing, which is most
            // bundles: an empty map answers every question the same way.
            std::unordered_map<std::string, int> worldClaims;
            if (engine_->hasShared_) worldClaims = engine_->sharedClaims();
            std::vector<TraceCard> traceStorage;
            std::vector<TraceCard>* trace = tracing() ? &traceStorage : nullptr;
            auto claimed = [this, &claimCounts, &worldClaims](const Card& card, bool shared)
            {
                return claimVerdict(card, shared, claimCounts, worldClaims);
            };
            RunAskResult run = runAsk(ask, claimed, trace);
            std::vector<CardEntry> listed;
            if (!n.has_value())
            {
                listed = std::move(run.ordered);
            }
            else
            {
                size_t take = static_cast<size_t>(std::max(*n, 0));
                take = std::min(take, run.ordered.size());
                listed.assign(run.ordered.begin(), run.ordered.begin() + static_cast<ptrdiff_t>(take));
            }
            if (trace)
            {
                std::unordered_set<std::string> taken;
                for (const auto& e : listed) taken.insert(e.card->id);
                capTrace(*trace, taken);
                TraceEvent evt;
                evt.kind = TraceEvent::Kind::Peek;
                evt.box = EffectiveGameId(*box);
                evt.criteria = criteria;
                evt.cards = std::move(traceStorage);
                emit(std::move(evt), turnCounts_.getOr(box->id, 0));
            }
            RankedList list;
            list.box = EffectiveGameId(*box);
            for (const auto& e : listed) list.cards.push_back(view(e));
            return list;
        }

        /** Refresh one hand (schema 3.5); returns its new shape. */
        std::vector<DealtCard> deal(const std::string& handRef)
        {
            assertOpen();
            const HandInBox& found = resolveHand(handRef);
            std::string gameId = EffectiveGameId(*found.hand);
            OrderedMap<std::string, std::vector<DealtCard>> result = dealMany(std::vector<std::string>{handRef});
            const std::vector<DealtCard>* cards = result.get(gameId);
            return cards ? *cards : std::vector<DealtCard>{};
        }

        /** Re-deal several / all hands (schema 3.5): seeded hand-order shuffle
         *  (fairness), evict, seed the ledger from survivors, fill in order.
         *  Returns the dealt slice - the new contents of exactly the hands
         *  this call dealt, keyed by hand gameId (board() stays the
         *  whole-board read). */
        OrderedMap<std::string, std::vector<DealtCard>> dealMany(
            const std::optional<std::vector<std::string>>& handRefs = std::nullopt)
        {
            assertOpen();
            std::vector<std::string> refs;
            if (handRefs.has_value())
            {
                refs = *handRefs;
            }
            else
            {
                refs = engine_->handsById_.keys();
                std::sort(refs.begin(), refs.end());
            }
            std::vector<HandInBox> dealt;
            dealt.reserve(refs.size());
            for (const auto& r : refs) dealt.push_back(resolveHand(r));
            ShuffleInPlace(dealt, prng_);

            // Eviction first: drop dealt cards no longer available to their
            // hand (minus the claims check against their own seat).
            for (const auto& handInBox : dealt)
            {
                const Hand& hand = *handInBox.hand;
                const Box& box = *handInBox.box;
                AskDescriptor ask = askForHand(hand, box);
                HandEnv handEnv = buildHandEnv(ask);
                EvalContext condCtx = evalCtx(box, nullptr, handEnv);
                bool conditionOk = passes(ask.condition, condCtx);
                std::unordered_map<std::string, bool> gateOk;
                for (const auto& deck : box.decks)
                {
                    EvalContext ctx = evalCtx(box, &deck, handEnv);
                    gateOk[deck.id] = passes(deck.condition, ctx);
                }
                double boxTurn = turnCounts_.getOr(box.id, 0);
                // Trace events fire after the state they report has landed (a
                // handler reading the board sees the eviction), so they are
                // collected here and emitted once the survivors are set.
                std::vector<std::pair<std::string, std::string>> evicted;
                auto evict = [&](const std::string& cardId, const std::string& reason)
                {
                    evicted.emplace_back(cardId, reason);
                    return false;
                };
                const std::vector<std::string>* contents = boardContents_.get(hand.id);
                std::vector<std::string> survivors;
                if (contents)
                {
                    for (const auto& cardId : *contents)
                    {
                        bool keep = [&]()
                        {
                            if (!conditionOk) return evict(cardId, "hand-condition");
                            const CardEntry* entry = engine_->cardsById_.get(cardId);
                            if (!entry) return evict(cardId, "vanished");   // edited content: dropped
                            if (!gateOk[entry->deck->id]) return evict(cardId, VerdictWire(TraceVerdict::DeckGate));
                            if (cooldowns_.getOr(cardId, 0) > boxTurn) return evict(cardId, VerdictWire(TraceVerdict::Cooldown));
                            if (!tagsMatch(*entry->card, handEnv.boundTags)) return evict(cardId, VerdictWire(TraceVerdict::Tags));
                            EvalContext ctx = evalCtx(box, entry->deck, handEnv);
                            if (!passes(entry->card->condition, ctx, "card " + entry->card->gameId + " condition"))
                            {
                                return evict(cardId, VerdictWire(TraceVerdict::Condition));
                            }
                            return true;
                        }();
                        if (keep) survivors.push_back(cardId);
                    }
                }
                boardContents_.set(hand.id, std::move(survivors));
                if (tracing())
                {
                    for (const auto& e : evicted)
                    {
                        TraceEvent evt;
                        evt.kind = TraceEvent::Kind::Evict;
                        evt.hand = hand.id;
                        evt.card = e.first;
                        evt.reason = e.second;
                        emit(std::move(evt), boxTurn);
                    }
                }
            }

            std::unordered_map<std::string, int> claimCounts = claims();
            // Taken once for the whole batch and kept in step with the local
            // ledger below, so two hands in the SAME deal cannot both take the
            // last shared copy.
            std::unordered_map<std::string, int> worldClaims;
            if (engine_->hasShared_) worldClaims = engine_->sharedClaims();
            for (const auto& handInBox : dealt)
            {
                const Hand& hand = *handInBox.hand;
                const Box& box = *handInBox.box;
                std::vector<std::string> contents = boardContents_.getOr(hand.id, {});
                double free = handCapacity(hand) - static_cast<double>(contents.size());
                if (free <= 0) continue;
                AskDescriptor ask = askForHand(hand, box);
                std::unordered_set<std::string> own(contents.begin(), contents.end());
                std::vector<TraceCard> traceStorage;
                std::vector<TraceCard>* trace = tracing() ? &traceStorage : nullptr;
                // At most once in any one hand; at most `copies` hands here, and
                // at most sharedCopies hands anywhere (schema 3.5, shared-scarcity 5).
                auto claimed = [this, &own, &claimCounts, &worldClaims](const Card& card, bool shared)
                    -> std::optional<TraceVerdict>
                {
                    if (own.count(card.id) > 0) return TraceVerdict::Claimed;
                    return claimVerdict(card, shared, claimCounts, worldClaims);
                };
                RunAskResult run = runAsk(ask, claimed, trace);
                size_t take = std::isinf(free)
                    ? run.ordered.size()
                    : std::min(static_cast<size_t>(free), run.ordered.size());
                std::vector<std::string> added;
                for (size_t i = 0; i < take; ++i) added.push_back(run.ordered[i].card->id);
                std::vector<std::string> next = contents;
                next.insert(next.end(), added.begin(), added.end());
                boardContents_.set(hand.id, std::move(next));
                for (const auto& id : added) { ++claimCounts[id]; ++worldClaims[id]; }
                // Emitted after the hand is set: a handler reading board() sees the deal.
                if (trace)
                {
                    std::unordered_set<std::string> taken(added.begin(), added.end());
                    capTrace(*trace, taken);
                    TraceEvent evt;
                    evt.kind = TraceEvent::Kind::Deal;
                    evt.hand = EffectiveGameId(hand);
                    evt.cards = std::move(traceStorage);
                    emit(std::move(evt), turnCounts_.getOr(box.id, 0));
                }
            }

            OrderedMap<std::string, std::vector<DealtCard>> result;
            for (const auto& handInBox : dealt)
            {
                std::vector<std::string> ids = boardContents_.getOr(handInBox.hand->id, {});
                std::vector<DealtCard> cards;
                for (const auto& id : ids) cards.push_back(view(engine_->cardsById_.at(id)));
                result.set(EffectiveGameId(*handInBox.hand), std::move(cards));
            }
            return result;
        }

        /** The board: current hand contents, in dealt order, keyed by hand
         *  gameId (schema 5). Read it for what is out; peek the stock for what
         *  could come.
         *
         *  `boxRef` (a box gameId or id) narrows the read to that box's
         *  hands, in the same shape and the same order: "give me the barks
         *  hands" is a common host query, and boxes are how a game separates
         *  its storylet systems, so the grouping belongs here rather than in
         *  every host. An unknown box throws, as it does on turn() and peek().
         *
         *  An OVERLOAD PAIR rather than a defaulted `""`, matching Unity's
         *  Board() / Board(ref) - because with the sentinel, `board("")` read
         *  as the whole board here and threw "unknown box" on JS and Unity
         *  (2026-08-29). An empty string is not a box name in any of them, and
         *  a host passing one out of blank config should learn that in every
         *  engine rather than silently getting everything in two. */
        OrderedMap<std::string, std::vector<DealtCard>> board() const
        {
            assertOpen();
            return boardOf(nullptr);
        }

        OrderedMap<std::string, std::vector<DealtCard>> board(const std::string& boxRef) const
        {
            assertOpen();
            const Box* box = resolveBox(boxRef);
            if (!box) throw StoryletError("unknown box \"" + boxRef + "\"");
            return boardOf(box);
        }

    private:
        OrderedMap<std::string, std::vector<DealtCard>> boardOf(const Box* only) const
        {
            const std::string keep = only ? only->id : std::string();
            OrderedMap<std::string, std::vector<DealtCard>> result;
            for (const auto& pair : boardContents_)
            {
                const HandInBox& found = engine_->handsById_.at(pair.first);
                if (!keep.empty() && found.box->id != keep) continue;
                std::vector<DealtCard> cards;
                for (const auto& id : pair.second) cards.push_back(view(engine_->cardsById_.at(id)));
                result.set(EffectiveGameId(*found.hand), std::move(cards));
            }
            return result;
        }

    public:
        /** Outcome availability, evaluated against CURRENT state on every ask
         *  (schema 3.1/5) - never a deal-time snapshot. */
        std::vector<OutcomeView> outcomes(const std::string& cardId, const std::string& from)
        {
            assertOpen();
            ResolvedDealt resolved = resolveDealt(cardId, from);
            HandEnv handEnv = buildHandEnv(resolved.ask);
            EvalContext ctx = evalCtx(*resolved.entry.box, resolved.entry.deck, handEnv);
            std::vector<OutcomeView> views;
            for (const auto& o : resolved.entry.card->outcomes)
            {
                OutcomeView v;
                v.id = o.id;
                v.gameId = EffectiveGameId(o);
                v.title = o.title;
                v.purpose = o.purpose;
                v.available = passes(o.condition, ctx);
                views.push_back(std::move(v));
            }
            return views;
        }

        /** Apply an outcome (schema 3.7): the card must sit in a hand on the
         *  board (you never play a card from inside the deck). Throws before
         *  any mutation on a gated-shut outcome or a bad write target. */
        void play(
            const std::string& cardId,
            const std::string& outcomeGameId,
            const std::string& from,
            const PlayOptions& opts = {})
        {
            assertOpen();
            ResolvedDealt resolved = resolveDealt(cardId, from);
            const CardEntry& entry = resolved.entry;
            const Outcome* outcome = nullptr;
            for (const auto& o : entry.card->outcomes)
            {
                if (EffectiveGameId(o) == outcomeGameId)
                {
                    outcome = &o;
                    break;
                }
            }
            if (!outcome)
            {
                throw StoryletError("card \"" + EffectiveGameId(*entry.card)
                    + "\" has no outcome \"" + outcomeGameId + "\"");
            }

            HandEnv handEnv = buildHandEnv(resolved.ask);
            EvalContext ctx = evalCtx(*entry.box, entry.deck, handEnv);
            if (!passes(outcome->condition, ctx))
            {
                throw StoryletError("outcome \"" + outcomeGameId + "\" on \""
                    + EffectiveGameId(*entry.card) + "\" is gated shut");
            }

            // The played card's box's clock advances (schema 3.4); computed up
            // front so the play and its writes log as one action, one turn stamp.
            double newTurn = turnCounts_.getOr(entry.box->id, 0)
                + (opts.advanceTurns.has_value() ? *opts.advanceTurns : engine_->bundle_->settings.playAdvancesTurns);

            // Every right-hand side evaluates against PRE-play state, then all
            // writes land (schema 3.7).
            std::vector<std::pair<std::string, StoryletValue>> writes;
            for (const auto& change : outcome->changes)
            {
                writes.emplace_back(change.first, eval(change.second, ctx));
            }
            for (const auto& write : writes)
            {
                WriteResult landed = applyWrite(write.first, write.second, entry, handEnv);
                if (tracing())
                {
                    TraceEvent evt;
                    evt.kind = TraceEvent::Kind::Write;
                    evt.target = write.first;
                    evt.path = landed.path;
                    evt.value = write.second;
                    evt.prev = landed.prev;
                    emit(std::move(evt), newTurn);
                }
            }

            PlayRecord record;
            record.card = EffectiveGameId(*entry.card);
            record.outcome = EffectiveGameId(*outcome);
            record.turn = newTurn;
            playLog_.push_back(std::move(record));
            indexPlay(playLog_.back());
            if (entry.card->redraw.kind == RedrawPolicy::Kind::Never)
            {
                // A shared one-shot leaves the WORLD rather than this flow. A
                // finite redraw deliberately does not share, whatever the deck
                // says: a cooldown is an absolute turn of this flow's box clock
                // and there is no shared clock to compare it against
                // (design/shared-scarcity.md 9.3.2).
                const bool deckShared = entry.deck->shared.has_value() ? *entry.deck->shared : false;
                if (cardIsShared(*entry.card, deckShared)) engine_->markTaken(entry.card->id);
                else cooldowns_.set(entry.card->id, MAX_SAFE_INTEGER);
            }
            else if (entry.card->redraw.kind == RedrawPolicy::Kind::After)
            {
                cooldowns_.set(entry.card->id, newTurn + entry.card->redraw.turns);
            }
            // The card leaves its hand, releasing its claim (schema 3.5/3.7).
            const std::string& handId = resolved.ask.hand->id;
            std::vector<std::string> remaining;
            for (const auto& id : boardContents_.getOr(handId, {}))
            {
                if (id != entry.card->id) remaining.push_back(id);
            }
            boardContents_.set(handId, std::move(remaining));
            turnCounts_.set(entry.box->id, newTurn);
            // Emitted last: a handler reading the board and the clock sees the play.
            if (tracing())
            {
                TraceEvent evt;
                evt.kind = TraceEvent::Kind::Play;
                evt.card = entry.card->id;
                evt.outcome = EffectiveGameId(*outcome);
                evt.turn = newTurn;
                emit(std::move(evt), newTurn);
            }
        }

        /** Advance one box's clock (schema 3.4): a turn is one draw-from-stock
         *  session for that box. */
        void advanceTurns(const std::string& boxRef, double n = 1)
        {
            assertOpen();
            const Box* box = resolveBox(boxRef);
            if (!box) throw StoryletError("unknown box \"" + boxRef + "\"");
            double next = turnCounts_.getOr(box->id, 0) + n;
            turnCounts_.set(box->id, next);
            if (tracing())
            {
                TraceEvent evt;
                evt.kind = TraceEvent::Kind::Turns;
                evt.box = EffectiveGameId(*box);
                evt.turn = next;
                emit(std::move(evt), next);
            }
        }

    private:
        struct HandSource
        {
            enum class Kind { Value, Hand, Criteria };
            Kind kind = Kind::Criteria;
            std::string id;
        };

        /** The composed @hand for one ask: the read bag, plus where each name
         *  routes on write (schema 3.6). */
        struct HandEnv
        {
            OrderedMap<std::string, StoryletValue> bag;
            std::unordered_map<std::string, HandSource> sources;
            /** tag group id -> bound tag id (home included, its "tag" a hand id). */
            OrderedMap<std::string, std::string> boundTags;
        };

        /** One ask, resolved: a deal (hand present, condition from its
         *  template or rule) or a peek (criteria only, no condition - schema 3.1). */
        struct AskDescriptor
        {
            const Box* box = nullptr;
            const Hand* hand = nullptr;
            ExpressionPtr condition;
            /** tag group id -> tag id, everything the ask binds (fixed +
             *  chosen + criteria; for deals also home -> the hand's own id). */
            OrderedMap<std::string, std::string> boundTags;
            /** Chosen tags / criteria surfaced into @hand by group gameId, the
             *  tag's gameId as the value (schema 3.6). */
            OrderedMap<std::string, std::string> askNames;
        };

        struct Scored
        {
            CardEntry entry;
            double priority = 0;
            double spec = 0;
        };

        struct WriteResult
        {
            std::string path;
            std::optional<StoryletValue> prev;
        };

        struct RunAskResult
        {
            std::vector<CardEntry> ordered;
            HandEnv handEnv;
        };

        struct ResolvedDealt
        {
            CardEntry entry;
            AskDescriptor ask;
        };

        /** Truthiness for a bare condition. One line, because the rule is on the
         *  SHARED value type: the two families disagreed about it until
         *  2026-09-01, and they share a property registry, so the same value
         *  read from the same registry must answer the same question. */
        static bool conditionPasses(const StoryletValue& v) { return v.truthy(); }

        bool tracing() const { return !traceHandlers_.empty() || engine_->logCap_.has_value() || engine_->engineTracing(); }

        void emit(TraceEvent evt, std::optional<double> turn = std::nullopt)
        {
            if (engine_->logCap_.has_value())
            {
                const int cap = std::max(*engine_->logCap_, 0);
                LogEntry entry;
                entry.event = evt;
                entry.seq = logSeq_++;
                entry.turn = turn;
                logEntries_.push_back(std::move(entry));
                if (logEntries_.size() > static_cast<size_t>(cap))
                {
                    logEntries_.erase(logEntries_.begin(),
                        logEntries_.begin() + static_cast<ptrdiff_t>(logEntries_.size() - static_cast<size_t>(cap)));
                }
            }
            std::vector<TraceHandler> handlers = traceHandlers_;
            for (const auto& handler : handlers) handler.second(evt);
            engine_->emitEngine(id_, evt, turn);
        }

        // --- expression plumbing -------------------------------------------------

        /** The play-history indexes' key for one (group, tag) pair. A unit
         *  separator (U+001F) joins them: ids are letters, digits and
         *  underscores, so a control character cannot occur in one and two
         *  pairs can never collide into one key. Not NUL, which GDScript will
         *  not carry in a string, and the four runtimes keep one spelling. */
        static std::string tagKey(const std::string& groupId, const std::string& tagId)
        {
            std::string key = groupId;
            key.push_back('\x1f');
            key.append(tagId);
            return key;
        }

        /** Fold one play into the indexes. O(the card's tags), not O(the log). */
        void indexPlay(const PlayRecord& record)
        {
            playCount_[record.card] += 1;
            lastPlayOf_[record.card] = record;
            const CardEntry* entry = engine_->cardsByGameId_.get(record.card);
            if (!entry) return;
            for (const auto& groupId : entry->card->tags.keys())
            {
                const std::vector<std::string>* tagIds = entry->card->tags.get(groupId);
                if (!tagIds) continue;
                for (const auto& tagId : *tagIds)
                {
                    const std::string key = tagKey(groupId, tagId);
                    tagPlayCount_[key] += 1;
                    lastPlayInTag_[key] = record;
                }
            }
        }

        /** Rebuild from the log, wherever it is REPLACED rather than appended to. */
        void rebuildPlayIndex()
        {
            playCount_.clear();
            lastPlayOf_.clear();
            tagPlayCount_.clear();
            lastPlayInTag_.clear();
            for (const auto& record : playLog_) indexPlay(record);
        }

        /** Tag group names are box-scoped: two boxes may name a group the same
         *  way (schema 1 - boxes namespace their groups), so a name is only
         *  ever resolved inside the box being asked, never bundle-wide. Ids
         *  are project-unique and accepted here too, still confined to the
         *  box. */
        static const TagGroup* groupInBox(const Box& box, const std::string& reference)
        {
            for (const auto& group : box.tagGroups)
            {
                if (EffectiveGameId(group) == reference) return &group;
            }
            for (const auto& group : box.tagGroups)
            {
                if (group.id == reference) return &group;
            }
            return nullptr;
        }

        /** A group NAME and tag name resolved in THIS box, as the index's key;
         *  false when either is unknown here, which is the old per-record
         *  `false` and reads as "never". Resolved once per call, where inTag
         *  used to resolve it again for every record in the log. */
        static bool keyOf(const Box& box, const std::string& group, const std::string& tag,
            std::string& outKey)
        {
            const TagGroup* found = groupInBox(box, group);
            if (!found) return false;
            for (const auto& candidate : found->tags)
            {
                if (candidate.gameId == tag)
                {
                    outKey = tagKey(found->id, candidate.id);
                    return true;
                }
            }
            return false;
        }

        /** One host per box: the play-history functions take a BARE group name
         *  with no box, so they resolve it in the box whose ask is being
         *  evaluated (a card's tags reference its own box's group, which keeps
         *  the counts box-local). */
        StoryletsHost makeHost(const Box& box)
        {
            StoryletsHost host;
            const Box* boxPtr = &box;
            host.nextRandom = [this]() { return prng_.next(); };
            host.countPlayed = [this](const std::string& card) -> double
            {
                auto it = playCount_.find(card);
                return it == playCount_.end() ? 0 : it->second;
            };
            host.turnsSincePlayed = [this](const std::string& card) -> double
            {
                auto it = lastPlayOf_.find(card);
                return it == lastPlayOf_.end() ? NEVER_PLAYED : since(it->second);
            };
            host.countPlayedIn = [this, boxPtr](const std::string& group, const std::string& tag) -> double
            {
                std::string key;
                if (!keyOf(*boxPtr, group, tag, key)) return 0;
                auto it = tagPlayCount_.find(key);
                return it == tagPlayCount_.end() ? 0 : it->second;
            };
            host.turnsSincePlayedIn = [this, boxPtr](const std::string& group, const std::string& tag) -> double
            {
                std::string key;
                if (!keyOf(*boxPtr, group, tag, key)) return NEVER_PLAYED;
                auto it = lastPlayInTag_.find(key);
                return it == lastPlayInTag_.end() ? NEVER_PLAYED : since(it->second);
            };
            return host;
        }

        /** Turns-since is measured on the played card's box's clock (3.4). */
        double since(const PlayRecord& record) const
        {
            const CardEntry* entry = engine_->cardsByGameId_.get(record.card);
            if (!entry) return NEVER_PLAYED;
            return turnCounts_.getOr(entry->box->id, 0) - record.turn;
        }

        static const OrderedMap<std::string, StoryletValue>& emptyBag()
        {
            static const OrderedMap<std::string, StoryletValue> empty;
            return empty;
        }

        /** The ladder behind one composed @hand name, or null when the name
         *  is not a quality (or came from criteria, which are tag names).
         *  Ladders live on the engine (declaration-level, partition-blind). */
        const std::vector<std::string>* handLadder(const HandEnv& handEnv, const std::string& name) const
        {
            auto src = handEnv.sources.find(name);
            if (src == handEnv.sources.end()) return nullptr;
            if (src->second.kind == HandSource::Kind::Criteria) return nullptr;
            const auto& owners = src->second.kind == HandSource::Kind::Value
                ? engine_->valueLadders_ : engine_->handLadders_;
            auto it = owners.find(src->second.id);
            if (it == owners.end()) return nullptr;
            auto f = it->second.find(name);
            return f == it->second.end() ? nullptr : &f->second;
        }

        /** A merged read scope: the flow's own bag first, the shared bag
         *  behind it. Names are disjoint (shared XOR per-flow by
         *  declaration), so "first" is routing, not shadowing. */
        class PairScope : public IScopeSource
        {
        public:
            PairScope(const PropertyBag* own, const PropertyBag* shared) : own_(own), shared_(shared) {}
            std::optional<StoryletValue> get(const std::string& name) const override
            {
                if (own_)
                {
                    std::optional<StoryletValue> v = own_->get(name);
                    if (v.has_value()) return v;
                }
                return shared_ ? shared_->get(name) : std::nullopt;
            }
        private:
            const PropertyBag* own_;
            const PropertyBag* shared_;
        };

        /** @world through the engine's resolver. */
        class WorldScope : public IScopeSource
        {
        public:
            explicit WorldScope(const Engine* engine) : engine_(engine) {}
            std::optional<StoryletValue> get(const std::string& name) const override
            {
                return engine_->worldGet(name);
            }
        private:
            const Engine* engine_;
        };

        static const PropertyBag* bagOf(const OrderedMap<std::string, std::shared_ptr<PropertyBag>>& kind, const std::string& id)
        {
            const std::shared_ptr<PropertyBag>* bag = kind.get(id);
            return bag ? bag->get() : nullptr;
        }

        static OrderedMap<std::string, std::shared_ptr<PropertyBag>>& kindOf(detail::Partition& p, const std::string& kind)
        {
            if (kind == "box") return p.box;
            if (kind == "deck") return p.deck;
            if (kind == "hand") return p.hand;
            return p.value;
        }

        static const OrderedMap<std::string, std::shared_ptr<PropertyBag>>& kindOf(const detail::Partition& p, const std::string& kind)
        {
            if (kind == "box") return p.box;
            if (kind == "deck") return p.deck;
            if (kind == "hand") return p.hand;
            return p.value;
        }

        static std::vector<std::string> splitPath(const std::string& path)
        {
            std::vector<std::string> parts;
            size_t start = 0;
            while (true)
            {
                size_t dot = path.find('.', start);
                if (dot == std::string::npos)
                {
                    parts.push_back(path.substr(start));
                    break;
                }
                parts.push_back(path.substr(start, dot - start));
                start = dot + 1;
            }
            return parts;
        }

        /** The evaluation environment (schema 3.1/6.2): @box/@deck resolve to
         *  the card under evaluation; in hand-condition contexts @deck is an
         *  empty bag, so any reference is an eval error (missing-policy
         *  throw). Every scope is the flow's MERGED view - its own copies
         *  over the shared values, names disjoint - and @world reads through
         *  the engine's resolver. */
        EvalContext evalCtx(const Box& box, const Deck* deck, const HandEnv& handEnv) const
        {
            EvalContext ctx;
            if (engine_->hasQualities_)
            {
                // The quality channel, answering for THIS ask's box and deck.
                const std::string boxId = box.id;
                const std::string deckId = deck ? deck->id : std::string();
                const HandEnv* env = &handEnv;
                ctx.qualities = [this, boxId, deckId, env](const std::string& scope, const std::string& name) -> const std::vector<std::string>*
                {
                    auto find = [&name](const std::unordered_map<std::string, std::vector<std::string>>& m) -> const std::vector<std::string>*
                    {
                        auto it = m.find(name);
                        return it == m.end() ? nullptr : &it->second;
                    };
                    if (scope == "world") return find(engine_->worldLadders_);
                    if (scope == "story") return find(engine_->storyLadders_);
                    if (scope == "box")
                    {
                        auto it = engine_->boxLadders_.find(boxId);
                        return it == engine_->boxLadders_.end() ? nullptr : find(it->second);
                    }
                    if (scope == "deck" && !deckId.empty())
                    {
                        auto it = engine_->deckLadders_.find(deckId);
                        return it == engine_->deckLadders_.end() ? nullptr : find(it->second);
                    }
                    if (scope == "hand") return handLadder(*env, name);
                    return nullptr;
                };
            }
            const StoryletsHost* host = hostsByBox_.get(box.id);
            if (!host) throw StoryletError("unknown box \"" + box.id + "\"");
            ctx.host = host;
            ctx.scopes["world"] = std::make_shared<WorldScope>(engine_);
            ctx.scopes["story"] = std::make_shared<PairScope>(stores_.story.get(), engine_->shared_.story.get());
            ctx.scopes["box"] = std::make_shared<PairScope>(bagOf(stores_.box, box.id), bagOf(engine_->shared_.box, box.id));
            ctx.scopes["deck"] = deck
                ? std::static_pointer_cast<IScopeSource>(std::make_shared<PairScope>(bagOf(stores_.deck, deck->id), bagOf(engine_->shared_.deck, deck->id)))
                : std::static_pointer_cast<IScopeSource>(std::make_shared<BagScope>(emptyBag()));
            ctx.scopes["hand"] = std::make_shared<BagScope>(handEnv.bag);
            return ctx;
        }

        StoryletValue eval(const ExpressionPtr& expr, EvalContext& ctx) const
        {
            return Evaluate(expr->ast, ctx, StoryletsDialect());
        }

        bool passes(const ExpressionPtr& expr, EvalContext& ctx, const std::string& where = "condition")
        {
            if (!expr) return true;
            try
            {
                return conditionPasses(eval(expr, ctx));
            }
            catch (const std::exception& e)
            {
                // An eval error is never a silent pass: the card/deck is
                // unavailable (schema 3.1), and the trace surfaces the diagnostic.
                if (tracing())
                {
                    TraceEvent evt;
                    evt.kind = TraceEvent::Kind::Diagnostic;
                    evt.where = where;
                    evt.message = e.what();
                    emit(std::move(evt));
                }
                return false;
            }
        }

        // --- resolving asks (schema 2.6 + 3.6) -------------------------------------

        const Box* resolveBox(const std::string& boxRef) const
        {
            const Box* const* byGameId = engine_->boxesByGameId_.get(boxRef);
            if (byGameId) return *byGameId;
            const Box* const* byId = engine_->boxesById_.get(boxRef);
            return byId ? *byId : nullptr;
        }

        static const Tag* tagByGameId(const TagGroup& group, const std::string& gameId)
        {
            for (const auto& t : group.tags)
            {
                if (t.gameId == gameId) return &t;
            }
            return nullptr;
        }

        static const Tag* tagById(const TagGroup& group, const std::string& id)
        {
            for (const auto& t : group.tags)
            {
                if (t.id == id) return &t;
            }
            return nullptr;
        }

        /** A deal's ask: the hand's template bindings + chosen tags, or its
         *  rule's bindings, plus the implicit home binding (schema 2.4). */
        AskDescriptor askForHand(const Hand& hand, const Box& box) const
        {
            AskDescriptor ask;
            ask.box = &box;
            ask.hand = &hand;
            if (!hand.templateId.empty())
            {
                const HandTemplate* const* found = engine_->templatesById_.get(hand.templateId);
                if (!found)
                {
                    throw StoryletError("hand \"" + EffectiveGameId(hand)
                        + "\": unknown template \"" + hand.templateId + "\"");
                }
                const HandTemplate& t = **found;
                for (const auto& pair : t.bindings) ask.boundTags.set(pair.first, pair.second);
                for (const auto& pair : hand.chosen)
                {
                    ask.boundTags.set(pair.first, pair.second);
                    const GroupInBox* group = engine_->groupsById_.get(pair.first);
                    const Tag* tag = group ? tagById(*group->group, pair.second) : nullptr;
                    if (group && tag)
                    {
                        ask.askNames.set(EffectiveGameId(*group->group), EffectiveGameId(*tag));
                    }
                }
                ask.condition = t.condition;
            }
            else
            {
                if (hand.rule)
                {
                    for (const auto& pair : hand.rule->bindings)
                    {
                        ask.boundTags.set(pair.first, pair.second);
                        // ...and name it, as the template branch does: a card
                        // reading @hand.<group> must not care HOW it was bound.
                        const GroupInBox* group = engine_->groupsById_.get(pair.first);
                        const Tag* tag = group ? tagById(*group->group, pair.second) : nullptr;
                        if (group && tag)
                        {
                            ask.askNames.set(EffectiveGameId(*group->group), EffectiveGameId(*tag));
                        }
                    }
                    ask.condition = hand.rule->condition;
                }
            }
            ask.boundTags.set(PLACE_GROUP, hand.id);
            bindStateGroups(box, ask);
            return ask;
        }

        /** A peek's ask: raw criteria ({group gameId: tag gameId}), bindings
         *  only, no condition slot (schema 3.1; the boundary, Reboot 4). */
        AskDescriptor askForPeek(const Box& box, const OrderedMap<std::string, std::string>& criteria) const
        {
            AskDescriptor ask;
            ask.box = &box;
            for (const auto& pair : criteria)
            {
                const std::string& groupRef = pair.first;
                const std::string& tagRef = pair.second;
                if (groupRef == PLACE_GROUP)
                {
                    const HandInBox* hand = engine_->handsByGameId_.get(tagRef);
                    if (!hand) hand = engine_->handsById_.get(tagRef);
                    if (!hand) throw StoryletError("peek: unknown hand \"" + tagRef + "\" in home criteria");
                    ask.boundTags.set(PLACE_GROUP, hand->hand->id);
                    continue;
                }
                const TagGroup* found = groupInBox(box, groupRef);
                if (!found)
                {
                    throw StoryletError("peek: unknown tag group \"" + groupRef
                        + "\" in box \"" + EffectiveGameId(box) + "\"");
                }
                const Tag* tag = tagByGameId(*found, tagRef);
                if (!tag) tag = tagById(*found, tagRef);
                if (!tag)
                {
                    throw StoryletError("peek: unknown tag \"" + tagRef
                        + "\" in group \"" + EffectiveGameId(*found) + "\"");
                }
                ask.boundTags.set(found->id, tag->id);
                ask.askNames.set(EffectiveGameId(*found), EffectiveGameId(*tag));
            }
            bindStateGroups(box, ask);
            return ask;
        }

        /** Bind every state-bound group in the box from the property it names.
         *  Runs after the hand's own bindings and never overwrites one: an
         *  explicit binding beats a default. A value naming no tag leaves the
         *  group UNBOUND (a wildcard) with a diagnostic, because a silently
         *  empty hand reads as content that does not exist. */
        void bindStateGroups(const Box& box, AskDescriptor& ask) const
        {
            for (const auto& group : box.tagGroups)
            {
                if (group.boundBy.empty() || ask.boundTags.get(group.id)) continue;
                const std::string& ref = group.boundBy;
                std::string scope, name;
                const size_t dot = ref.find('.');
                if (ref.size() > 1 && ref[0] == '@' && dot != std::string::npos)
                {
                    scope = ref.substr(1, dot - 1);
                    name = ref.substr(dot + 1);
                }
                // The NAME is checked too, not just the scope word: JS and
                // Unity apply ^@(world|story)\.([a-z][a-z0-9_-]*)$ and Godot
                // and Unreal accepted any non-empty remainder, so `@story.Act`
                // bound here and was refused there (2026-08-29). Spelled out
                // rather than <regex>, which the std core deliberately avoids.
                auto nameOk = [](const std::string& n) {
                    if (n.empty() || n[0] < 'a' || n[0] > 'z') return false;
                    for (char c : n)
                    {
                        const bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
                        if (!ok) return false;
                    }
                    return true;
                };
                if ((scope != "world" && scope != "story") || !nameOk(name))
                {
                    diagnose("tag group " + EffectiveGameId(group),
                        "boundBy \"" + ref + "\" is not a @world or @story property reference");
                    continue;
                }
                StoryletValue value;
                try { value = getProperty(scope + "." + name); }
                catch (const StoryletError&)
                {
                    diagnose("tag group " + EffectiveGameId(group),
                        "boundBy \"" + ref + "\" names a property that is not declared");
                    continue;
                }
                const std::string wanted = value.isString() ? value.asString() : value.toJsonString();
                const Tag* tag = nullptr;
                for (const auto& t : group.tags) { if (EffectiveGameId(t) == wanted) { tag = &t; break; } }
                if (!tag)
                {
                    diagnose("tag group " + EffectiveGameId(group),
                        ref + " is \"" + wanted + "\", which is not one of its tags");
                    continue;
                }
                ask.boundTags.set(group.id, tag->id);
                ask.askNames.set(EffectiveGameId(group), EffectiveGameId(*tag));
            }
        }

        /** A trace diagnostic, when anyone is listening. */
        void diagnose(const std::string& where, const std::string& message) const
        {
            if (!tracing()) return;
            TraceEvent evt;
            evt.kind = TraceEvent::Kind::Diagnostic;
            evt.where = where;
            evt.message = message;
            const_cast<Flow*>(this)->emit(std::move(evt));
        }

        // --- @hand composition (schema 3.6) -----------------------------------------

        HandEnv buildHandEnv(const AskDescriptor& ask) const
        {
            HandEnv env;
            env.boundTags = ask.boundTags;

            // 1. Tag properties of every bound tag (home binds a hand, not a
            //    tag) - the MERGED view: shared under the flow's own, names
            //    disjoint, so order is routing, not shadowing.
            for (const auto& pair : ask.boundTags)
            {
                if (pair.first == PLACE_GROUP) continue;
                const PropertyBag* sides[2] = {
                    bagOf(engine_->shared_.value, pair.second), bagOf(stores_.value, pair.second) };
                for (const PropertyBag* side : sides)
                {
                    if (!side) continue;
                    for (const auto& prop : side->values())
                    {
                        env.bag.set(prop.first, prop.second);
                        HandSource source;
                        source.kind = HandSource::Kind::Value;
                        source.id = pair.second;
                        env.sources[prop.first] = std::move(source);
                    }
                }
            }
            // 2. Hand properties, when the ask is a deal.
            if (ask.hand)
            {
                const PropertyBag* sides[2] = {
                    bagOf(engine_->shared_.hand, ask.hand->id), bagOf(stores_.hand, ask.hand->id) };
                for (const PropertyBag* side : sides)
                {
                    if (!side) continue;
                    for (const auto& prop : side->values())
                    {
                        env.bag.set(prop.first, prop.second);
                        HandSource source;
                        source.kind = HandSource::Kind::Hand;
                        source.id = ask.hand->id;
                        env.sources[prop.first] = std::move(source);
                    }
                }
            }
            // 3. Chosen tags / criteria, by group name (the tag's gameId as value).
            for (const auto& pair : ask.askNames)
            {
                env.bag.set(pair.first, StoryletValue::Str(pair.second));
                HandSource source;
                source.kind = HandSource::Kind::Criteria;
                env.sources[pair.first] = std::move(source);
            }
            return env;
        }

        // --- the ask (schema 3.1 + 3.2) ------------------------------------------------

        /** The claims ledger, derived from the board: card id -> holding hands
         *  (schema 3.5). */
        std::unordered_map<std::string, int> claims() const
        {
            std::unordered_map<std::string, int> counts;
            for (const auto& pair : boardContents_)
            {
                for (const auto& id : pair.second) ++counts[id];
            }
            return counts;
        }

        static double copiesOf(const Card& card)
        {
            return card.copies.has_value() ? *card.copies : 1;
        }

        /** Is this card scarce across flows (design/shared-scarcity.md)? The
         *  deck says what the pile is for and the card may override it. The
         *  deck's flag hoists out of the card loop: the ask runs this per card
         *  per deal. */
        static bool cardIsShared(const Card& card, bool deckShared)
        {
            return card.shared.has_value() ? *card.shared : deckShared;
        }

        /** How many hands ACROSS EVERY FLOW may hold this at once; defaults to
         *  copies. */
        static double sharedCap(const Card& card)
        {
            if (card.sharedCopies.has_value()) return *card.sharedCopies;
            return copiesOf(card);
        }

    public:
        /** Every card id on THIS flow's board, one entry per holding hand. The
         *  engine sums these across live flows for the shared ledger. */
        std::vector<std::string> heldCardIds() const
        {
            std::vector<std::string> out;
            for (const auto& pair : boardContents_)
            {
                for (const auto& id : pair.second) out.push_back(id);
            }
            return out;
        }

    private:
        /** The claims step (3.1 step 6) for one card, as the verdict that
         *  refused it or nullopt for available. Two caps apply to a shared card
         *  and they are different statements, so they get different verdicts:
         *  copies is your own board filling up, sharedCopies is somebody else
         *  already holding it, and a participant told "claimed" about a card on
         *  another person's table would read it as a fault. */
        std::optional<TraceVerdict> claimVerdict(
            const Card& card, bool shared,
            const std::unordered_map<std::string, int>& mine,
            const std::unordered_map<std::string, int>& world) const
        {
            auto mineIt = mine.find(card.id);
            if ((mineIt == mine.end() ? 0 : mineIt->second) >= copiesOf(card)) return TraceVerdict::Claimed;
            if (shared)
            {
                auto worldIt = world.find(card.id);
                if ((worldIt == world.end() ? 0 : worldIt->second) >= sharedCap(card)) return TraceVerdict::ClaimedElsewhere;
            }
            return std::nullopt;
        }

        /** Tag matching (schema 3.1 step 3): for every bound group the card
         *  lists the bound tag or omits the group (wildcard); the home group
         *  inverts - a homed card requires a matching home binding (schema 2.4). */
        bool tagsMatch(const Card& card, const OrderedMap<std::string, std::string>& boundTags) const
        {
            const std::vector<std::string>* home = card.tags.get(PLACE_GROUP);
            if (home && !home->empty())
            {
                const std::string* bound = boundTags.get(PLACE_GROUP);
                if (!bound || std::find(home->begin(), home->end(), *bound) == home->end()) return false;
            }
            for (const auto& pair : boundTags)
            {
                if (pair.first == PLACE_GROUP) continue;
                const std::vector<std::string>* tags = card.tags.get(pair.first);
                if (!tags)
                {
                    // Omission is a wildcard unless the group says otherwise.
                    if (engine_->requiredGroups_.count(pair.first) != 0) return false;
                    continue;
                }
                if (std::find(tags->begin(), tags->end(), pair.second) == tags->end()) return false;
            }
            return true;
        }

        /** Run one ask: availability filter then ranking. `claimed` decides
         *  the claims step (step 6) per card. `trace` (when a subscriber
         *  exists) collects the per-card verdicts. */
        RunAskResult runAsk(
            const AskDescriptor& ask,
            const std::function<std::optional<TraceVerdict>(const Card&, bool)>& claimed,
            std::vector<TraceCard>* trace)
        {
            const Box& box = *ask.box;
            RunAskResult result;
            result.handEnv = buildHandEnv(ask);
            const HandEnv& handEnv = result.handEnv;
            auto verdict = [trace](const std::string& id, TraceVerdict v)
            {
                if (trace)
                {
                    TraceCard tc;
                    tc.id = id;
                    tc.verdict = v;
                    trace->push_back(std::move(tc));
                }
            };

            // The hand's condition: ask-constant, evaluated once (schema 3.1 step 4).
            std::string handWhere = "hand " + (ask.hand ? EffectiveGameId(*ask.hand) : std::string()) + " condition";
            {
                EvalContext ctx = evalCtx(box, nullptr, handEnv);
                if (!passes(ask.condition, ctx, handWhere))
                {
                    return result;
                }
            }

            // Deck gates: evaluated once per ask, in deck (id) order (schema 2.5).
            std::unordered_map<std::string, bool> gateOk;
            for (const auto& deck : box.decks)
            {
                EvalContext ctx = evalCtx(box, &deck, handEnv);
                gateOk[deck.id] = passes(deck.condition, ctx, "deck " + deck.gameId + " gate");
            }

            double boxTurn = turnCounts_.getOr(box.id, 0);
            std::vector<Scored> scored;
            for (const auto& deck : box.decks)
            {
                // ONE context per deck, not per card: box, deck and handEnv do not
                // vary inside this loop, and a condition is a read-only gate
                // (schema 3.1). Reference: engine.ts runAsk, and
                // storylets-new/design/port-review-2026-08.md.
                EvalContext deckCtx = evalCtx(box, &deck, handEnv);
                const bool deckShared = deck.shared.has_value() ? *deck.shared : false;
                for (const auto& card : deck.cards)
                {
                    const bool shared = cardIsShared(card, deckShared);
                    if (!gateOk[deck.id])
                    {
                        verdict(card.id, TraceVerdict::DeckGate);
                        continue;
                    }
                    // Taken out of the world by somebody's shared one-shot.
                    // Checked before this flow's own clock, because "cooldown"
                    // would point the reader at a turn counter that has nothing
                    // to do with it.
                    if (shared && engine_->isTaken(card.id))
                    {
                        verdict(card.id, TraceVerdict::Taken);
                        continue;
                    }
                    if (cooldowns_.getOr(card.id, 0) > boxTurn)
                    {
                        verdict(card.id, TraceVerdict::Cooldown);
                        continue;
                    }
                    if (!tagsMatch(card, handEnv.boundTags))
                    {
                        verdict(card.id, TraceVerdict::Tags);
                        continue;
                    }
                    EvalContext& ctx = deckCtx;
                    // The label is only read when an eval THROWS and only when
                    // tracing, and each build here was a std::string concatenation
                    // per card - a heap allocation on the path that matters.
                    if (card.condition && !passes(card.condition, ctx,
                        tracing() ? "card " + card.gameId + " condition" : std::string()))
                    {
                        verdict(card.id, TraceVerdict::Condition);
                        continue;
                    }
                    std::optional<TraceVerdict> refused = claimed(card, shared);   // claims, last (3.1 step 6)
                    if (refused.has_value())
                    {
                        verdict(card.id, *refused);
                        continue;
                    }

                    double priority;
                    if (!card.priorityExpr)
                    {
                        priority = card.priorityNumber.has_value() ? *card.priorityNumber : 0;
                    }
                    else
                    {
                        try
                        {
                            StoryletValue v = eval(card.priorityExpr, ctx);
                            if (!v.isNumber())
                            {
                                verdict(card.id, TraceVerdict::Priority);
                                continue;
                            }
                            priority = v.asNumber();
                        }
                        catch (const std::exception& e)
                        {
                            if (tracing())
                            {
                                TraceEvent evt;
                                evt.kind = TraceEvent::Kind::Diagnostic;
                                evt.where = "card " + card.gameId + " priority";
                                evt.message = e.what();
                                emit(std::move(evt));
                            }
                            verdict(card.id, TraceVerdict::Priority);
                            continue;
                        }
                    }
                    double spec = 0;
                    if (box.ranking.specificity && card.condition)
                    {
                        spec = MatchedSpecificity(card.condition->ast, [&ctx](const AstPtr& n)
                        {
                            try
                            {
                                return conditionPasses(Evaluate(n, ctx, StoryletsDialect()));
                            }
                            catch (const std::exception&)
                            {
                                return false;
                            }
                        });
                    }
                    Scored s;
                    s.entry = CardEntry{&card, &deck, &box};
                    s.priority = priority;
                    s.spec = spec;
                    scored.push_back(std::move(s));
                }
            }

            // STABLE sort (priority desc -> specificity desc; std::stable_sort,
            // never a bare std::sort over candidates - schema 3.2).
            std::stable_sort(scored.begin(), scored.end(), [](const Scored& a, const Scored& b)
            {
                if (a.priority != b.priority) return a.priority > b.priority;
                return a.spec > b.spec;
            });
            // Seeded shuffle of each maximal tie run; runs of 1 consume no draws.
            size_t i = 0;
            while (i < scored.size())
            {
                size_t j = i + 1;
                while (j < scored.size()
                    && scored[j].priority == scored[i].priority
                    && scored[j].spec == scored[i].spec) ++j;
                if (j - i > 1)
                {
                    std::vector<Scored> run(scored.begin() + static_cast<ptrdiff_t>(i),
                        scored.begin() + static_cast<ptrdiff_t>(j));
                    ShuffleInPlace(run, prng_);
                    for (size_t k = 0; k < run.size(); ++k) scored[i + k] = run[k];
                }
                i = j;
            }
            if (trace)
            {
                for (const auto& s : scored)
                {
                    TraceCard tc;
                    tc.id = s.entry.card->id;
                    tc.verdict = TraceVerdict::Dealt;
                    tc.priority = s.priority;
                    tc.specificity = s.spec;
                    trace->push_back(std::move(tc));
                }
            }
            for (const auto& s : scored) result.ordered.push_back(s.entry);
            return result;
        }

        /** Flip eligible-but-not-taken trace entries to "capped". */
        static void capTrace(std::vector<TraceCard>& trace, const std::unordered_set<std::string>& taken)
        {
            for (auto& entry : trace)
            {
                if (entry.verdict == TraceVerdict::Dealt && taken.count(entry.id) == 0)
                {
                    entry.verdict = TraceVerdict::Capped;
                }
            }
        }

        static DealtCard view(const CardEntry& entry)
        {
            const Card& card = *entry.card;
            DealtCard v;
            v.id = card.id;
            v.gameId = EffectiveGameId(card);
            v.title = card.title;
            v.purpose = card.purpose;
            v.fields = card.fields;
            return v;
        }

        double handCapacity(const Hand& hand) const
        {
            if (hand.slots.has_value()) return *hand.slots;
            std::optional<double> declared;
            if (!hand.templateId.empty())
            {
                const HandTemplate* const* t = engine_->templatesById_.get(hand.templateId);
                if (t) declared = (*t)->slots;
            }
            else if (hand.rule)
            {
                declared = hand.rule->slots;
            }
            return !declared.has_value() || std::isinf(*declared)
                ? std::numeric_limits<double>::infinity()
                : *declared;
        }

        const HandInBox& resolveHand(const std::string& handRef) const
        {
            const HandInBox* found = engine_->handsByGameId_.get(handRef);
            if (!found) found = engine_->handsById_.get(handRef);
            if (!found) throw StoryletError("unknown hand \"" + handRef + "\"");
            return *found;
        }

        /** Resolve a played/inspected card within a hand on the board. */
        ResolvedDealt resolveDealt(const std::string& cardId, const std::string& handRef) const
        {
            const CardEntry* entry = engine_->cardsById_.get(cardId);
            if (!entry) entry = engine_->cardsByGameId_.get(cardId);
            if (!entry) throw StoryletError("unknown card \"" + cardId + "\"");
            const HandInBox& found = resolveHand(handRef);
            std::vector<std::string> contents = boardContents_.getOr(found.hand->id, {});
            if (std::find(contents.begin(), contents.end(), entry->card->id) == contents.end())
            {
                throw StoryletError("card \"" + EffectiveGameId(*entry->card)
                    + "\" is not dealt to hand \"" + EffectiveGameId(*found.hand) + "\"");
            }
            ResolvedDealt resolved;
            resolved.entry = *entry;
            resolved.ask = askForHand(*found.hand, *found.box);
            return resolved;
        }

        /** Land one change in whichever partition declares the name: the
         *  flow's bag when the property is per-flow, the shared bag when it
         *  is shared. Returns the resolved store path (for the trace) and
         *  the value it replaced (for the log's "0 -> 1" reading). */
        WriteResult landIn(const std::string& kind, const std::string& ownerId,
            const std::string& name, const StoryletValue& value, const std::string& path)
        {
            PropertyBag* own = kind == "story" ? stores_.story.get()
                : const_cast<PropertyBag*>(bagOf(kindOf(stores_, kind), ownerId));
            PropertyBag* shared = kind == "story" ? engine_->shared_.story.get()
                : const_cast<PropertyBag*>(bagOf(kindOf(engine_->shared_, kind), ownerId));
            PropertyBag* bag = own && own->get(name).has_value() ? own
                : shared && shared->get(name).has_value() ? shared
                : nullptr;
            if (!bag) throw StoryletError("no property at \"" + path + "\"");
            // An engine write: the bag's subscribers fire (the firing rule).
            BagChange change = bag->set(name, value);
            WriteResult result;
            result.path = path;
            result.prev = change.prev;
            return result;
        }

        WriteResult applyWrite(
            const std::string& target,
            const StoryletValue& value,
            const CardEntry& entry,
            const HandEnv& handEnv)
        {
            std::string scope, name;
            if (!parseChangeTarget(target, scope, name))
            {
                throw StoryletError("bad change target \"" + target + "\"");
            }
            if (scope == "world")
            {
                if (!engine_->worldCanSet())
                {
                    throw StoryletError("@world." + name + " cannot be written: the host bound @world read-only");
                }
                WriteResult result;
                result.path = "world." + name;
                result.prev = engine_->worldGet(name);
                engine_->worldSet(name, value);
                return result;
            }
            if (scope == "story") return landIn("story", std::string(), name, value, "story." + name);
            if (scope == "box") return landIn("box", entry.box->id, name, value, "box." + entry.box->id + "." + name);
            if (scope == "deck") return landIn("deck", entry.deck->id, name, value, "deck." + entry.deck->id + "." + name);
            if (scope == "hand")
            {
                // Write-back routing (schema 3.6): the composed name remembers
                // its source store; writes to criteria/chosen-tag names are errors.
                auto source = handEnv.sources.find(name);
                if (source == handEnv.sources.end())
                {
                    throw StoryletError("@hand." + name + " is not composed in this ask");
                }
                if (source->second.kind == HandSource::Kind::Criteria)
                {
                    throw StoryletError("@hand." + name + " is a chosen tag / criteria name and cannot be written");
                }
                const char* kindName = source->second.kind == HandSource::Kind::Value ? "value" : "hand";
                return landIn(kindName, source->second.id, name, value,
                    std::string(kindName) + "." + source->second.id + "." + name);
            }
            throw StoryletError("bad change target scope \"@" + scope + "\"");
        }

        /** ^@([a-z]+)\.([A-Za-z_][A-Za-z0-9_-]*)$ without a regex engine. */
        static bool parseChangeTarget(const std::string& target, std::string& scope, std::string& name)
        {
            if (target.size() < 4 || target[0] != '@') return false;
            size_t dot = target.find('.');
            if (dot == std::string::npos || dot < 2 || dot + 1 >= target.size()) return false;
            scope = target.substr(1, dot - 1);
            for (char c : scope)
            {
                if (c < 'a' || c > 'z') return false;
            }
            name = target.substr(dot + 1);
            auto nameStart = [](char c)
            {
                return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_';
            };
            auto namePart = [&nameStart](char c)
            {
                return nameStart(c) || (c >= '0' && c <= '9') || c == '-';
            };
            if (!nameStart(name[0])) return false;
            for (size_t i = 1; i < name.size(); ++i)
            {
                if (!namePart(name[i])) return false;
            }
            return true;
        }

        static void loadKind(
            OrderedMap<std::string, std::shared_ptr<PropertyBag>>& stores,
            const OrderedMap<std::string, OrderedMap<std::string, StoryletValue>>& saved)
        {
            for (const auto& pair : saved)
            {
                const std::shared_ptr<PropertyBag>* bag = stores.get(pair.first);
                if (bag) (*bag)->load(pair.second);
            }
        }

        // --- state ------------------------------------------------------------------

        void assertOpen() const
        {
            if (closed_) throw StoryletError("flow \"" + id_ + "\" is closed");
        }

        Engine* engine_ = nullptr;
        std::string id_;
        bool closed_ = false;

        Mulberry32 prng_;
        /** Per-box turn counters, keyed by box id (schema 3.4), PER FLOW. */
        OrderedMap<std::string, double> turnCounts_;
        OrderedMap<std::string, double> cooldowns_;
        /** The board: hand contents (card ids, dealt order), keyed by hand id. */
        OrderedMap<std::string, std::vector<std::string>> boardContents_;
        std::vector<PlayRecord> playLog_;
        // --- play-history indexes ------------------------------------------
        // A pure summary of playLog_, maintained where it is appended and
        // rebuilt where it is replaced. The four history host functions used
        // to SCAN the whole log on every call, once per candidate card per
        // ask, so dealing was O(candidates x play log) and a shipped game got
        // slower the longer somebody played it. Measured in the JS reference
        // (2000 cards): count_played went 0.8ms -> 27.9ms as the log reached
        // 4000 plays, and 0.8ms flat afterwards. Not saved: the log is the
        // record, this is derived.
        //
        // Records are held BY VALUE, not as pointers into playLog_: a
        // push_back can reallocate the vector, and a stored pointer would then
        // dangle. PlayRecord is two strings and a double.
        //
        // The tag keys are the played card's OWN (group id, tag id) pairs,
        // which keeps the box-local rule: a group NAME resolves inside the
        // asking box, so a card from another box carries different ids and
        // cannot match, exactly as the old per-record inTag decided.
        std::unordered_map<std::string, double> playCount_;
        std::unordered_map<std::string, PlayRecord> lastPlayOf_;
        std::unordered_map<std::string, double> tagPlayCount_;
        std::unordered_map<std::string, PlayRecord> lastPlayInTag_;

        /** The per-flow property partitions (the not-shared halves). */
        detail::Partition stores_;

        std::vector<TraceHandler> traceHandlers_;
        uint64_t nextTraceId_ = 1;
        std::vector<LogEntry> logEntries_;
        int64_t logSeq_ = 0;

        /** Box id -> that box's host (see makeHost); history and PRNG are
         *  this flow's. */
        OrderedMap<std::string, StoryletsHost> hostsByBox_;

        friend class Engine;

    public:
        // --- state access (host surface + test tooling) ---------------------------

        /** Every box, bundle order: identity + THIS flow's clock (parity
         *  member). */
        std::vector<BoxView> listBoxes() const
        {
            assertOpen();
            std::vector<BoxView> boxes;
            for (const auto& box : engine_->bundle_->boxes)
            {
                BoxView v;
                v.id = box.id;
                v.gameId = EffectiveGameId(box);
                v.title = box.title;
                v.turn = turnCounts_.getOr(box.id, 0);
                boxes.push_back(std::move(v));
            }
            return boxes;
        }

        /** THIS flow's kernel bags with their store path prefixes (the state
         *  logger's mount surface; parity member). The shared bags are the
         *  engine's listBags; flows are rebuilt by loadGame, so consumers
         *  re-enumerate after a load. */
        std::vector<BagMount> listBags() const
        {
            assertOpen();
            std::vector<BagMount> mounts;
            mounts.push_back({"story", stores_.story});
            for (const auto& pair : stores_.box) mounts.push_back({"box." + pair.first, pair.second});
            for (const auto& pair : stores_.deck) mounts.push_back({"deck." + pair.first, pair.second});
            for (const auto& pair : stores_.hand) mounts.push_back({"hand." + pair.first, pair.second});
            for (const auto& pair : stores_.value) mounts.push_back({"value." + pair.first, pair.second});
            return mounts;
        }

        /** The flow's FULL merged view as examiner rows: @world read through
         *  the engine's resolver, then per scope the shared values and this
         *  flow's own. Bundle order. */
        std::vector<PropertyRow> listProperties() const
        {
            assertOpen();
            std::vector<PropertyRow> rows;
            addWorldRows(rows);
            auto add = [&rows](const std::string& prefix, const PropertyBag* bag)
            {
                if (!bag) return;
                for (const auto& row : bag->rows())
                {
                    // The bag composes the address from its own pathPrefix, so the row
                    // arrives complete and this field-by-field copy is gone - including
                    // the `r.stages = row.stages;` that appeared twice in it.
                    rows.push_back(row);
                }
            };
            add("story", engine_->shared_.story.get());
            add("story", stores_.story.get());
            auto addKind = [&](const char* kind,
                const OrderedMap<std::string, std::shared_ptr<PropertyBag>>& shared,
                const OrderedMap<std::string, std::shared_ptr<PropertyBag>>& own)
            {
                std::vector<std::string> ids = shared.keys();
                for (const auto& id : own.keys())
                {
                    if (std::find(ids.begin(), ids.end(), id) == ids.end()) ids.push_back(id);
                }
                for (const auto& id : ids)
                {
                    add(std::string(kind) + "." + id, bagOf(shared, id));
                    add(std::string(kind) + "." + id, bagOf(own, id));
                }
            };
            addKind("box", engine_->shared_.box, stores_.box);
            addKind("deck", engine_->shared_.deck, stores_.deck);
            addKind("hand", engine_->shared_.hand, stores_.hand);
            addKind("value", engine_->shared_.value, stores_.value);
            return rows;
        }

        /** Read by path: "world.x", "story.gold", "value.v_docks.danger",
         *  "box.b_x.heat" - the flow's merged view, routed by the
         *  declaration's sharing. */
        StoryletValue getProperty(const std::string& path) const
        {
            assertOpen();
            std::vector<std::string> parts = splitPath(path);
            std::optional<StoryletValue> value;
            if (parts.size() == 2 && parts[0] == "world")
            {
                value = engine_->worldGet(parts[1]);
            }
            else if (parts.size() == 2 && parts[0] == "story")
            {
                value = stores_.story->get(parts[1]);
                if (!value.has_value()) value = engine_->shared_.story->get(parts[1]);
            }
            else if (parts.size() == 3
                && (parts[0] == "box" || parts[0] == "deck" || parts[0] == "hand" || parts[0] == "value"))
            {
                const PropertyBag* own = bagOf(kindOf(stores_, parts[0]), parts[1]);
                const PropertyBag* shared = bagOf(kindOf(engine_->shared_, parts[0]), parts[1]);
                if (!own && !shared) throw StoryletError("no " + parts[0] + " store \"" + parts[1] + "\"");
                if (own) value = own->get(parts[2]);
                if (!value.has_value() && shared) value = shared->get(parts[2]);
            }
            else
            {
                throw StoryletError("bad property path \"" + path + "\"");
            }
            if (!value.has_value()) throw StoryletError("no property at \"" + path + "\"");
            return *value;
        }

        void setProperty(const std::string& path, const StoryletValue& value)
        {
            assertOpen();
            std::vector<std::string> parts = splitPath(path);
            if (parts.size() == 2 && parts[0] == "world")
            {
                if (!engine_->worldCanSet())
                {
                    throw StoryletError("@world is read-only here: the host bound no write");
                }
                engine_->worldSet(parts[1], value);
                return;
            }
            PropertyBag* own = nullptr;
            PropertyBag* shared = nullptr;
            std::string name;
            if (parts.size() == 2 && parts[0] == "story")
            {
                own = stores_.story.get();
                shared = engine_->shared_.story.get();
                name = parts[1];
            }
            else if (parts.size() == 3
                && (parts[0] == "box" || parts[0] == "deck" || parts[0] == "hand" || parts[0] == "value"))
            {
                own = const_cast<PropertyBag*>(bagOf(kindOf(stores_, parts[0]), parts[1]));
                shared = const_cast<PropertyBag*>(bagOf(kindOf(engine_->shared_, parts[0]), parts[1]));
                if (!own && !shared) throw StoryletError("no " + parts[0] + " store \"" + parts[1] + "\"");
                name = parts[2];
            }
            else
            {
                throw StoryletError("bad property path \"" + path + "\"");
            }
            PropertyBag* bag = own && own->get(name).has_value() ? own
                : shared && shared->get(name).has_value() ? shared
                : nullptr;
            if (!bag) throw StoryletError("no property at \"" + path + "\"");
            // A host write: silent under the firing rule (no subscriber
            // feedback loop), but visible to the bag's audit hook.
            bag->set(name, value, /*silent=*/true, "host setProperty");
        }

        void addWorldRows(std::vector<PropertyRow>& rows) const
        {
            for (const auto& d : engine_->bundle_->world.properties)
            {
                PropertyRow r;
                r.path = "world." + d.name;
                r.name = d.name;
                r.type = d.type;
                std::optional<StoryletValue> value = engine_->worldGet(d.name);
                r.value = value.has_value() ? *value : d.defaultOrTypeDefault();
                r.defaultValue = d.defaultOrTypeDefault();
                r.values = d.values;
            r.stages = d.stages;
                r.stages = d.stages;
                r.writable = engine_->worldCanSet();
                rows.push_back(std::move(r));
            }
        }

        // --- persistence (schema 4) ------------------------------------------------

        /** This flow's blob inside the engine's envelope (StoryletValue is a
         *  value type, so a container-deep copy is the TS structuredClone). */
        FlowSave snapshot() const
        {
            FlowSave save;
            save.prng = prng_.state();
            save.props.story = stores_.story->save();
            for (const auto& pair : stores_.box) save.props.box.set(pair.first, pair.second->save());
            for (const auto& pair : stores_.deck) save.props.deck.set(pair.first, pair.second->save());
            for (const auto& pair : stores_.hand) save.props.hand.set(pair.first, pair.second->save());
            for (const auto& pair : stores_.value) save.props.value.set(pair.first, pair.second->save());
            for (const auto& pair : turnCounts_) save.turns.set(pair.first, pair.second);
            for (const auto& pair : cooldowns_) save.cooldowns.set(pair.first, pair.second);
            for (const auto& pair : boardContents_) save.board.set(pair.first, pair.second);
            save.playLog = playLog_;
            return save;
        }

        /** Restore a freshly opened flow from its blob (loadGame). Orphaned
         *  keys (deleted entities) drop; new declarations keep defaults. */
        void restore(const FlowSave& saved)
        {
            stores_.story->load(saved.props.story);
            loadKind(stores_.box, saved.props.box);
            loadKind(stores_.deck, saved.props.deck);
            loadKind(stores_.hand, saved.props.hand);
            loadKind(stores_.value, saved.props.value);
            turnCounts_.clear();
            for (const auto& box : engine_->bundle_->boxes) turnCounts_.set(box.id, 0);
            for (const auto& pair : saved.turns)
            {
                if (turnCounts_.contains(pair.first)) turnCounts_.set(pair.first, pair.second);
            }
            prng_.setState(saved.prng);
            cooldowns_.clear();
            for (const auto& pair : saved.cooldowns) cooldowns_.set(pair.first, pair.second);
            playLog_ = saved.playLog;
            rebuildPlayIndex();
            boardContents_.clear();
            for (const auto& pair : saved.board)
            {
                if (!engine_->handsById_.contains(pair.first)) continue;
                std::vector<std::string> ids;
                for (const auto& id : pair.second)
                {
                    if (engine_->cardsById_.contains(id)) ids.push_back(id);
                }
                boardContents_.set(pair.first, std::move(ids));
            }
            for (const auto& handId : engine_->handsById_.keys())
            {
                if (!boardContents_.contains(handId)) boardContents_.set(handId, {});
            }
        }
    };

    // --- Engine methods that need the complete Flow ------------------------------

    inline Engine::Engine(BundlePtr bundle, const EngineOptions& opts)
        : bundle_(std::move(bundle)), seed_(opts.seed), onReplacedFlow_(opts.onReplacedFlow)
    {
        if (opts.log) logCap_ = opts.logCap;
        if (opts.world.has_value()) hostWorld_ = opts.world;
        for (const auto& box : bundle_->boxes)
        {
            boxesById_.set(box.id, &box);
            boxesByGameId_.set(EffectiveGameId(box), &box);
            for (const auto& group : box.tagGroups)
            {
                groupsById_.set(group.id, detail::GroupInBox{&group, &box});
                if (group.required) requiredGroups_.insert(group.id);
            }
            for (const auto& deck : box.decks)
            {
                if (deck.shared) hasShared_ = true;
                for (const auto& card : deck.cards)
                {
                    detail::CardEntry entry{&card, &deck, &box};
                    cardsById_.set(card.id, entry);
                    cardsByGameId_.set(EffectiveGameId(card), entry);
                    if (card.shared && *card.shared) hasShared_ = true;
                }
            }
            for (const auto& t : box.handTemplates)
            {
                templatesById_.set(t.id, &t);
            }
            for (const auto& hand : box.hands)
            {
                detail::HandInBox entry{&hand, &box};
                handsById_.set(hand.id, entry);
                handsByGameId_.set(EffectiveGameId(hand), entry);
            }
        }
        initLadders();
        // The per-flow halves, precomputed once (a bundle never changes).
        flowDecls_.story = half("story", bundle_->story.properties, false);
        for (const auto& box : bundle_->boxes)
        {
            flowDecls_.box.set(box.id, half("box", box.properties, false));
            for (const auto& deck : box.decks)
            {
                flowDecls_.deck.set(deck.id, half("deck", deck.properties, false));
            }
            for (const auto& hand : box.hands)
            {
                flowDecls_.hand.set(hand.id, half("hand", handDecls(hand), false));
            }
            for (const auto& group : box.tagGroups)
            {
                for (const auto& tag : group.tags)
                {
                    flowDecls_.value.set(tag.id, half("value", tag.properties, false));
                }
            }
        }
        initShared();
    }

    inline void Engine::initLadders()
    {
        auto grab = [this](const std::vector<PropertyDecl>& decls, std::unordered_map<std::string, std::vector<std::string>>& out)
        {
            for (const auto& d : decls)
            {
                if (d.type == PropertyTypes::Quality && d.stages.has_value()) { out[d.name] = *d.stages; hasQualities_ = true; }
            }
        };
        grab(bundle_->world.properties, worldLadders_);
        grab(bundle_->story.properties, storyLadders_);
        for (const auto& box : bundle_->boxes)
        {
            grab(box.properties, boxLadders_[box.id]);
            for (const auto& deck : box.decks) grab(deck.properties, deckLadders_[deck.id]);
            for (const auto& group : box.tagGroups)
            {
                for (const auto& tag : group.tags) grab(tag.properties, valueLadders_[tag.id]);
            }
            for (const auto& hand : box.hands) grab(handDecls(hand), handLadders_[hand.id]);
        }
    }

    inline FlowPtr Engine::openFlow(const std::string& id, const OpenFlowOptions& opts)
    {
        const FlowPtr* existing = flows_.get(id);
        if (existing)
        {
            // Say so BEFORE the old flow goes inert, while its board is readable.
            const int dealt = static_cast<int>((*existing)->heldCardIds().size());
            if (dealt > 0 && onReplacedFlow_) onReplacedFlow_(id, dealt);
            (*existing)->markClosed();
        }
        FlowPtr flow = std::make_shared<Flow>(this, id, opts.seed.has_value() ? *opts.seed : seed_);
        flows_.set(id, flow);
        return flow;
    }

    inline void Engine::closeFlow(const std::string& id)
    {
        const FlowPtr* found = flows_.get(id);
        if (!found) return;
        FlowPtr flow = *found;
        flows_.remove(id);
        flow->markClosed();
    }

    inline void Engine::reset()
    {
        for (const auto& pair : flows_) pair.second->markClosed();
        flows_.clear();
        spent_.clear();
        // The log is a run-lifetime utility and is not saved; a reset is a new run.
        engineLog_.clear();
        initShared();
    }

    inline std::vector<std::string> Engine::spentIds() const
    {
        std::vector<std::string> ids(spent_.begin(), spent_.end());
        std::sort(ids.begin(), ids.end());
        return ids;
    }

    inline std::unordered_map<std::string, int> Engine::sharedClaims() const
    {
        std::unordered_map<std::string, int> counts;
        for (const auto& pair : flows_)
        {
            for (const auto& id : pair.second->heldCardIds()) ++counts[id];
        }
        return counts;
    }

    inline StoryletValue Engine::getProperty(const std::string& path) const
    {
        std::vector<std::string> parts = Flow::splitPath(path);
        if (parts.size() == 2 && parts[0] == "world")
        {
            std::optional<StoryletValue> wv = worldGet(parts[1]);
            if (!wv.has_value()) throw StoryletError("no property at \"" + path + "\"");
            return *wv;
        }
        if (parts.size() == 2 && parts[0] == "story")
        {
            std::optional<StoryletValue> sv = shared_.story->get(parts[1]);
            if (sv.has_value()) return *sv;
            for (const auto& d : flowDecls_.story)
            {
                if (d.name == parts[1])
                {
                    throw StoryletError("\"" + path + "\" is per-flow state - read it on a Flow, not the Engine");
                }
            }
            throw StoryletError("no property at \"" + path + "\"");
        }
        if (parts.size() == 3
            && (parts[0] == "box" || parts[0] == "deck" || parts[0] == "hand" || parts[0] == "value"))
        {
            const OrderedMap<std::string, std::shared_ptr<PropertyBag>>& sharedKind = Flow::kindOf(shared_, parts[0]);
            const OrderedMap<std::string, std::vector<PropertyDecl>>& flowKind =
                parts[0] == "box" ? flowDecls_.box
                : parts[0] == "deck" ? flowDecls_.deck
                : parts[0] == "hand" ? flowDecls_.hand
                : flowDecls_.value;
            const std::shared_ptr<PropertyBag>* bag = sharedKind.get(parts[1]);
            if (bag)
            {
                std::optional<StoryletValue> v = (*bag)->get(parts[2]);
                if (v.has_value()) return *v;
            }
            const std::vector<PropertyDecl>* decls = flowKind.get(parts[1]);
            if (decls)
            {
                for (const auto& d : *decls)
                {
                    if (d.name == parts[2])
                    {
                        throw StoryletError("\"" + path + "\" is per-flow state - read it on a Flow, not the Engine");
                    }
                }
            }
            if (!bag && !decls) throw StoryletError("no " + parts[0] + " store \"" + parts[1] + "\"");
            throw StoryletError("no property at \"" + path + "\"");
        }
        throw StoryletError("bad property path \"" + path + "\"");
    }

    inline void Engine::setProperty(const std::string& path, const StoryletValue& value)
    {
        std::vector<std::string> parts = Flow::splitPath(path);
        if (parts.size() == 2 && parts[0] == "world")
        {
            if (!worldCanSet()) throw StoryletError("@world is read-only here: the host bound no write");
            worldSet(parts[1], value);
            return;
        }
        // Reuse the read-side routing: a per-flow or unknown ref throws the
        // same message before anything is written.
        getProperty(path);
        PropertyBag* bag = parts.size() == 2 ? shared_.story.get()
            : Flow::kindOf(shared_, parts[0]).get(parts[1])->get();
        bag->set(parts.back(), value, /*silent=*/true, "host setProperty");
    }

    inline std::vector<PropertyRow> Engine::listProperties() const
    {
        std::vector<PropertyRow> rows;
        for (const auto& d : bundle_->world.properties)
        {
            PropertyRow r;
            r.path = "world." + d.name;
            r.name = d.name;
            r.type = d.type;
            std::optional<StoryletValue> value = worldGet(d.name);
            r.value = value.has_value() ? *value : d.defaultOrTypeDefault();
            r.defaultValue = d.defaultOrTypeDefault();
            r.values = d.values;
            r.stages = d.stages;
            r.writable = worldCanSet();
            rows.push_back(std::move(r));
        }
        auto add = [&rows](const std::string& prefix, const PropertyBag& bag)
        {
            // The bag composes the address from its own pathPrefix: the row arrives complete.
            for (const auto& row : bag.rows()) rows.push_back(row);
        };
        add("story", *shared_.story);
        for (const auto& pair : shared_.box) add("box." + pair.first, *pair.second);
        for (const auto& pair : shared_.deck) add("deck." + pair.first, *pair.second);
        for (const auto& pair : shared_.hand) add("hand." + pair.first, *pair.second);
        for (const auto& pair : shared_.value) add("value." + pair.first, *pair.second);
        return rows;
    }

    inline SaveEnvelope Engine::saveGame() const
    {
        SaveEnvelope envelope;
        envelope.schema = SAVE_SCHEMA;
        envelope.content = bundle_->content;
        envelope.shared.props.story = shared_.story->save();
        for (const auto& pair : shared_.box) envelope.shared.props.box.set(pair.first, pair.second->save());
        for (const auto& pair : shared_.deck) envelope.shared.props.deck.set(pair.first, pair.second->save());
        for (const auto& pair : shared_.hand) envelope.shared.props.hand.set(pair.first, pair.second->save());
        for (const auto& pair : shared_.value) envelope.shared.props.value.set(pair.first, pair.second->save());
        envelope.shared.spent = spentIds();
        for (const auto& pair : flows_) envelope.flows.set(pair.first, pair.second->snapshot());
        return envelope;
    }

    inline void Engine::loadGame(const SaveEnvelope& envelope)
    {
        if (envelope.content.project != bundle_->content.project)
        {
            throw StoryletError("save is for project \"" + envelope.content.project
                + "\", bundle is \"" + bundle_->content.project + "\"");
        }
        reset();
        shared_.story->load(envelope.shared.props.story);
        Flow::loadKind(shared_.box, envelope.shared.props.box);
        Flow::loadKind(shared_.deck, envelope.shared.props.deck);
        Flow::loadKind(shared_.hand, envelope.shared.props.hand);
        Flow::loadKind(shared_.value, envelope.shared.props.value);
        for (const auto& id : envelope.shared.spent) spent_.insert(id);
        for (const auto& pair : envelope.flows)
        {
            openFlow(pair.first)->restore(pair.second);
        }
    }
}
