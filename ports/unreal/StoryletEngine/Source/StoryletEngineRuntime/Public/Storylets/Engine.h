// The Engine + Flow: the world + flow manager and the personal playthrough
// (design/flows.md; the shape is Patter's), transliterated from the
// reference runtime (packages/runtime/src/engine.ts) and held to the
// conformance corpus. An Engine owns the bundle, the lookups, the SHARED
// property partitions and the @world seam; a Flow owns its own PRNG, clocks,
// cooldowns, board, claims, play history and per-flow partitions. Every name
// is shared XOR per-flow by declaration, so a read is a union of two bags and
// a write routes by name. No default flow, no ambient flow: openFlow(id)
// is the only way in, an existing id is REPLACED, closed handles are
// INERT, and engine-level reads of per-flow refs throw the teaching error.
//
// One registry per game (patterkit design/one-registry-handover.md): every
// property bag that declares something lives in ONE ScopeRegistry, the game's
// (EngineOptions::registry) or, without one, the engine's own. The shared
// @story registers under `story`, every other bag under a key starting
// `storylets/`, which no expression can name. saveGame() carries what is NOT
// a property, plus the registry's values only when the engine made the
// registry itself. @world is the game's: a resolver it binds (never saved), a
// scope it registers in its registry, or, for a standalone engine, a
// self-backed bag the registry stores and saves.
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
//   - the PROJECT MAP (design/project-map-contract.md 3) is one zone group
//     above the boxes, in Bundle::map->group and in no box's tagGroups. A box
//     that opts in (usesMap) sees its name beside its own groups', so its
//     hands bind zones and its cards are tagged with them by id exactly as
//     with a box group. Each zone is ONE value bag, keyed by the tag's id like
//     any tag's, so a zone property is one value whichever box's hand is
//     dealt to it; the `shared` flag still decides per-flow against one for
//     the engine. What the boxes on a map do NOT share: a hand deals only
//     from its own box's decks, and play history stays the asking box's
//     (D7). A bundle that breaks the map's rules is refused at construction
//     (3.8) rather than half-played.
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
#include "Storylets/Kernel.h"   // the shared kernel (Expr/), its names in `storylets`, and kernelCall
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
        /** The host's @world binding: the values the game owns and the story
         *  reads (and, where `set` is given, writes). Engine-level, shared by
         *  all flows, never saved: the game keeps these values. Absent, a
         *  standalone engine self-backs @world from the declared defaults, as a
         *  property its registry stores and saves. A game running several
         *  engines registers @world in its registry itself instead. */
        std::optional<WorldResolver> world;
        /** The game's registry: ONE per game, holding every engine's
         *  properties except those the game keeps itself, saved once. Given
         *  one, the engine registers its own scopes in it (@story under
         *  `story`, every other bag under a key starting `storylets/`, and
         *  @world if `world` is set), reads every other scope from it, and
         *  saveGame() leaves the property values to the game. @world is then
         *  the game's to register: owned if the registry should store it,
         *  foreign if the game keeps it. Null, the engine makes its own
         *  registry and acts as its own game: it self-backs @world, and
         *  saveGame() carries the registry's values too. Held shared, so a
         *  game and each engine it runs keep the one registry alive between
         *  them. */
        std::shared_ptr<ScopeRegistry> registry;
        /** Diagnostics hook (opt-in, dev only): fired when openFlow REPLACES a
         *  flow that still had cards dealt (flow id, count). Behaviour is
         *  unchanged; this makes observable the host that calls openFlow straight
         *  after loadGame and discards the restored hand - getFlow is the call.
         *  Parity with the JS runtime's onReplacedFlow. Zero cost when unset. */
        std::function<void(const std::string&, int)> onReplacedFlow;
    };

    /** The schema tag every durable half carries, so the shape can change later
     *  and a runtime can tell which one it was given. */
    inline const char* const DURABLE_SCHEMA = "storylets/durable@1";

    /**
     * One DURABLE HALF (ruling H, 2026-10-06): what outlives a run. The
     * engine's half (Engine::saveDurable) is the installation's memory, a
     * flow's half (Flow::saveDurable) is the player's pocket, and the two have
     * one shape.
     *
     * Keyed the way everything host-facing is, because a half is meant to
     * cross builds: a value by its property ADDRESS, exactly as
     * listProperties() prints it and setProperty takes it (`story.souls`,
     * `hand.the-elder.met`, `value.harbour/docks.lamps`), and a spend by the
     * card's GAMEID. A save keys by internal id so it survives a rename; a
     * durable half keys by name so a person can read it, and a rename shows up
     * in the report instead. serializeDurable / deserializeDurable
     * (Storylets/Save.h) are its string boundary.
     */
    struct DurableSave
    {
        /** DURABLE_SCHEMA when written; anything else is refused on load. */
        std::string schema = DURABLE_SCHEMA;
        /** The build it was taken from: a load reports drift against it, and
         *  refuses another project's. */
        BundleContent content;
        /** Every durable property on this half, by address, keys sorted. */
        OrderedMap<std::string, StoryletValue> values;
        /** The durable `redraw: never` spends on this half, by card gameId,
         *  sorted. */
        std::vector<std::string> spent;
        /** Addresses this half carries with a value no property can hold: a
         *  JSON null, an object, or an array of anything but strings. Only
         *  deserializeDurable fills it (saveDurable never writes one), so that
         *  a hand-edited or foreign half is reported rather than refused: a
         *  load files each one as JS files a value its declaration does not
         *  take, retyped where the address is durable on that side and dropped
         *  where it is not, and writes nothing for it. */
        std::vector<std::string> unreadable;
    };

    struct OpenFlowOptions
    {
        /** Seed for this flow's PRNG (absent = the engine's seed). */
        std::optional<double> seed;
        /**
         * Open this flow AS IT WAS: a blob from saveFlow, applied to the freshly
         * opened (or replaced) flow before the handle comes back
         * (design/engine-server.md 4.1).
         *
         * An option on openFlow rather than a Flow::restore verb on purpose:
         * restoring INTO a running flow is the trap hosts keep falling into
         * (openFlow REPLACES), and "open this flow as it was" is one act. Drift
         * is tolerated exactly as loadGame tolerates it, with one addition,
         * because this restore lands in a LIVE engine: a shared card whose world
         * copies are all held by the OTHER open flows is not put back, and is
         * reported as claimed-elsewhere. Ask previewFlowRestore first to see
         * that coming.
         */
        std::optional<FlowSave> restore;
        /**
         * Open this flow with its POCKET in: a durable half from
         * Flow::saveDurable, written into the fresh flow before the handle
         * comes back (ruling H). The flow starts as any new flow does, on its
         * own seed and clocks, with the pocket's values laid over its defaults
         * and its durable spends spent. What no longer fits this build is
         * reported through onRestoreReport, as loadDurable reports the
         * engine's half.
         *
         * Refused together with `restore`: a restore already carries the
         * flow's durable values, so a pocket beside it would be a second answer
         * for the same property, and which one won would be a rule nobody could
         * see.
         */
        std::optional<DurableSave> durable;
        /** Handed the report of a `restore` or a `durable` as it happens. For a
         *  restore it is the same report previewFlowRestore returns for the
         *  same blob. Ignored without either; the report has nowhere else to
         *  go, since openFlow returns the handle. */
        std::function<void(const LoadReport&)> onRestoreReport;
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
        /** Outcome-template data, the names declared by the box's
         *  outcomeFields. Handed over as the bundle wrote it, never read by
         *  the engine; empty when the outcome carries none. */
        OrderedMap<std::string, StoryletValue> fields;
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
        /** The card's GAMEID (design/engine-server.md 4.4). */
        std::string id;
        TraceVerdict verdict = TraceVerdict::Dealt;
        std::optional<double> priority;
        std::optional<double> specificity;
    };

    /** One event on the deal/play log, as a single tagged struct (the C++
     *  shape of the reference's event-type union; the kind is the verb, so a
     *  peek is distinguishable from a deal when reading a run back). Only
     *  the fields the kind names are meaningful.
     *
     *  IDENTITY IS BY GAMEID throughout (design/engine-server.md 4.4). It was
     *  mixed until then: Deal's hand and Peek's box were gameIds while Evict's
     *  hand, Evict's and Play's card and every TraceCard::id were internal ids,
     *  so every consumer outside the engine - the Board, the four examiners,
     *  the Live Link, a wire a kiosk reads - mapped one to the other itself. */
    struct TraceEvent
    {
        enum class Kind { Deal, Peek, Evict, Play, Write, Turns, Diagnostic };

        Kind kind = Kind::Deal;
        /** Deal / Evict: hand gameId. */
        std::string hand;
        /** Peek / Turns: box gameId. */
        std::string box;
        /** Evict / Play: card gameId. A card the build no longer has (Evict's
         *  "vanished") has no gameId left, so it is named by the id the board
         *  carried - the rule a load report has always used. */
        std::string card;
        /** Play: outcome gameId. */
        std::string outcome;
        /** Evict: a verdict wire name, or "hand-condition" / "vanished". */
        std::string reason;
        /** Write: the authored target and the resolved store location, in the
         *  address grammar getProperty takes - the owner segment is its gameId
         *  (4.4). A routed @hand write shows where it actually went (schema
         *  3.6). */
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

    /** One kernel bag with its store path prefix (world / story /
     *  box.<gameId> / deck.<gameId> / hand.<gameId> / value.<gameId>, the
     *  owner named as an address names it - 4.4): the state logger's mount surface
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

        /** A group by internal id. `box` is null for the project map's
         *  group, which belongs to no box. */
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

        /** The four owned property scopes: the ones whose address carries an
         *  owner segment. @story has no owner and @world is the host's. */
        inline bool IsOwnedScope(const std::string& scope)
        {
            return scope == "box" || scope == "deck" || scope == "hand" || scope == "value";
        }

        /** Is `key` an array index as a JS object orders its keys: the canonical
         *  decimal of an integer from 0 to 2^32 - 2 ("7", "42"; never "07",
         *  "-1" or "4294967295")? */
        inline bool IsJsIndexKey(const std::string& key, uint64_t& out)
        {
            if (key.empty() || key.size() > 10 || (key.size() > 1 && key[0] == '0')) return false;
            uint64_t v = 0;
            for (char c : key)
            {
                if (c < '0' || c > '9') return false;
                v = v * 10 + static_cast<uint64_t>(c - '0');
            }
            if (v > 4294967294ULL) return false;
            out = v;
            return true;
        }

        /** Keys in the order a JS object holds them (ruling E): integer-like
         *  keys first, ascending, then the rest in insertion order. JS order is
         *  the contract wherever the reference writes an object keyed by flow
         *  id or hand gameId (a save's flows, the order a load reopens them,
         *  the dealt slice and the board), because any JS reading a save sees
         *  it that way anyway: JSON.parse reorders them. */
        inline std::vector<std::string> JsKeyOrder(std::vector<std::string> keys)
        {
            std::vector<std::pair<uint64_t, std::string>> indexed;
            std::vector<std::string> rest;
            for (auto& key : keys)
            {
                uint64_t v = 0;
                if (IsJsIndexKey(key, v)) indexed.emplace_back(v, std::move(key));
                else rest.push_back(std::move(key));
            }
            if (indexed.empty()) return rest;
            std::sort(indexed.begin(), indexed.end(),
                [](const std::pair<uint64_t, std::string>& a, const std::pair<uint64_t, std::string>& b) { return a.first < b.first; });
            std::vector<std::string> out;
            out.reserve(indexed.size() + rest.size());
            for (auto& pair : indexed) out.push_back(std::move(pair.second));
            for (auto& key : rest) out.push_back(std::move(key));
            return out;
        }

        /** An OrderedMap re-keyed into JS order (JsKeyOrder), values moved. */
        template <typename V>
        OrderedMap<std::string, V> InJsOrder(OrderedMap<std::string, V> map)
        {
            const std::vector<std::string> keys = map.keys();
            std::vector<std::string> ordered = JsKeyOrder(keys);
            if (ordered == keys) return map;
            OrderedMap<std::string, V> out;
            for (const auto& key : ordered) out.set(key, std::move(*map.get(key)));
            return out;
        }

        /** The trace handlers' identities (ruling F): identity -> the id it
         *  is registered under. See Engine::subscribeTrace. */
        using TraceIdentities = std::vector<std::pair<const void*, uint64_t>>;

        /** The id `identity` is already registered under, or 0. */
        inline uint64_t RegisteredAs(const TraceIdentities& identities, const void* identity)
        {
            if (!identity) return 0;
            for (const auto& pair : identities)
            {
                if (pair.first == identity) return pair.second;
            }
            return 0;
        }

        inline void ForgetIdentity(TraceIdentities& identities, uint64_t id)
        {
            identities.erase(std::remove_if(identities.begin(), identities.end(),
                [id](const std::pair<const void*, uint64_t>& pair) { return pair.second == id; }), identities.end());
        }

        /** The one kind switch: an owned scope word to that member of anything
         *  laid out per kind (a Partition, a PropsPartition, a FlowDecls, the
         *  OwnerIndexes), const when the argument is. Anything that is not
         *  box, deck or hand answers "value", as each of the nine copies this
         *  replaced did; every caller has already checked IsOwnedScope or
         *  walks the four kinds itself. */
        template <typename T>
        auto KindOf(T& perKind, const std::string& kind) -> decltype((perKind.value))
        {
            if (kind == "box") return perKind.box;
            if (kind == "deck") return perKind.deck;
            if (kind == "hand") return perKind.hand;
            return perKind.value;
        }

        /**
         * The owner segment of a property address, both ways round
         * (design/engine-server.md 4.4).
         *
         * `gameId` maps the internal id everything INSIDE the engine is keyed
         * by - the bags, the save envelope, the ladders - to the id an ADDRESS
         * uses; `id` maps back. Both are built in bundle order and a repeated
         * gameId does NOT overwrite the first: box, hand and card gameIds are
         * unique bundle-wide, but a TAG's is unique only within its group, and a
         * group's only within its box, so two boxes may each name a tag
         * "docks". "value.docks" names the first of the two, and the second
         * stays reachable by its internal id - which is the one part of the
         * internal-id form that cannot be retired on the same timetable as the
         * rest.
         */
        struct OwnerIndex
        {
            OrderedMap<std::string, std::string> gameId;   // internal id -> the owner segment printed
            OrderedMap<std::string, std::string> id;       // owner segment -> internal id (first in bundle order wins)
            /** A short form more than one owner answers to -> the qualified
             *  candidates, in bundle order. Only the value scope can have one
             *  (a tag's gameId is unique within its group alone), and it is
             *  REFUSED rather than resolved to the first. */
            OrderedMap<std::string, std::vector<std::string>> repeated;
            /** A box-qualified segment that names a project-map zone
             *  ("box/quay") -> the zone's own segment ("quay"), the one an
             *  address must use instead. REFUSED, never resolved: the zone
             *  belongs to no box (design/project-map-contract.md 3.4). Value
             *  scope only; empty when the bundle has no map. */
            OrderedMap<std::string, std::string> zoneQualified;
        };

        /** One index per owned scope, reached by the scope word the address
         *  carries (KindOf). */
        struct OwnerIndexes
        {
            OwnerIndex box;
            OwnerIndex deck;
            OwnerIndex hand;
            OwnerIndex value;
        };

        /** Index one owner both ways. OrderedMap::set is LAST-write-wins, so
         *  the gameId -> id direction is guarded rather than set: first in
         *  bundle order wins. Box, deck, hand and card gameIds are unique
         *  bundle-wide, so for those three scopes the guard never fires. */
        template <typename T>
        void IndexOwner(OwnerIndex& index, const T& entity)
        {
            const std::string gameId = EffectiveGameId(entity);
            index.gameId.set(entity.id, gameId);
            if (!index.id.contains(gameId)) index.id.set(gameId, entity.id);
        }

        /**
         * The value scope's index, whole: the segment each tag PRINTS, every
         * segment an address ACCEPTS, and the gameIds that need qualifying.
         *
         * A TAG's gameId is unique only within its group, and a group's only
         * within its box, so two boxes may each name a tag "docks" - as
         * ordinary as two boxes each having a "zone" group - and
         * "value.docks.danger" then names two stores. The address is
         * "value.<boxGameId>/<tagGameId>.<name>" wherever that happens, with
         * the slash INSIDE the owner segment so the address still splits into
         * three on the dot. The qualified form is always accepted; the short
         * form is accepted while one tag carries the gameId and refused when
         * more do (design/engine-server.md 4.4). Built from the whole bundle
         * rather than tag by tag, because whether a tag's own gameId is enough
         * is a question about the OTHER boxes.
         *
         * A ZONE of the project map (design/project-map-contract.md 3.4) is the
         * one tag with no qualified form: it belongs to no box, so it prints and
         * is accepted as "value.<zoneGameId>.<name>" whichever boxes use it,
         * after the box tags and never in `repeated`. Every box-qualified form
         * of it goes in `zoneQualified`, to be refused naming the short form.
         */
        template <typename BundleT>
        void IndexValueOwners(OwnerIndex& index, const BundleT& bundle)
        {
            std::vector<std::string> ids;
            std::vector<std::string> gameIds;
            std::vector<std::string> qualified;
            for (const auto& box : bundle.boxes)
            {
                const std::string boxGameId = EffectiveGameId(box);
                for (const auto& group : box.tagGroups)
                {
                    for (const auto& tag : group.tags)
                    {
                        const std::string gameId = EffectiveGameId(tag);
                        ids.push_back(tag.id);
                        gameIds.push_back(gameId);
                        qualified.push_back(boxGameId + "/" + gameId);
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
            OrderedMap<std::string, std::vector<std::string>> forms;
            for (size_t i = 0; i < ids.size(); ++i)
            {
                if (!forms.contains(gameIds[i])) forms.set(gameIds[i], std::vector<std::string>());
                std::vector<std::string>& list = *forms.get(gameIds[i]);
                bool seen = false;
                for (const auto& q : list) if (q == qualified[i]) { seen = true; break; }
                if (!seen) list.push_back(qualified[i]);
            }
            for (size_t i = 0; i < ids.size(); ++i)
            {
                const std::vector<std::string>& candidates = *forms.get(gameIds[i]);
                const bool ambiguous = candidates.size() > 1;
                index.gameId.set(ids[i], ambiguous ? qualified[i] : gameIds[i]);
                if (!index.id.contains(qualified[i])) index.id.set(qualified[i], ids[i]);
                if (!ambiguous && !index.id.contains(gameIds[i])) index.id.set(gameIds[i], ids[i]);
                if (ambiguous) index.repeated.set(gameIds[i], candidates);
            }
            // The zones. A zone whose gameId a box tag also uses is a bundle the
            // engine refuses at construction; should one reach here anyway, the
            // box tag keeps the short form it already had and the zone does not
            // take it over silently.
            if (!bundle.map.has_value()) return;
            for (const auto& tag : bundle.map->group.tags)
            {
                const std::string gameId = EffectiveGameId(tag);
                index.gameId.set(tag.id, gameId);
                if (!index.id.contains(gameId)) index.id.set(gameId, tag.id);
                for (const auto& box : bundle.boxes)
                {
                    index.zoneQualified.set(EffectiveGameId(box) + "/" + gameId, gameId);
                }
            }
        }

        /**
         * Refuse, at construction, a bundle this engine cannot read faithfully
         * (design/project-map-contract.md 3.8). Throws one StoryletError naming
         * every problem found, each naming the box and the group or tag at
         * fault.
         *
         * The compiler refuses all of these first. The engine checks again
         * because it cannot tell a hand-built or stale bundle from a compiled
         * one, and the alternative is the silent half-working the server audit
         * found twice: a hand whose bound group is looked up in the wrong place
         * comes back empty, and an old runtime given a map bundle deals
         * plausibly while every zone value is missing. Only what would make the
         * engine's OWN resolution ambiguous or wrong is refused here; the
         * compiler's bundle-wide group-name rule is stricter.
         */
        inline void RefuseUnreadableBundle(const Bundle& bundle)
        {
            // The schema tag (D4). Checked alone and first: a bundle of a schema
            // this runtime does not know may not have any of the shape the rest
            // reads.
            if (!IsSupportedBundleSchema(bundle.schema))
            {
                throw StoryletError("unsupported bundle schema: "
                    + (bundle.schema.empty() ? std::string("(none)") : bundle.schema)
                    + " (this runtime reads " + BUNDLE_SCHEMA_V0 + " and " + BUNDLE_SCHEMA + ")");
            }
            std::vector<std::string> problems;
            const TagGroup* map = bundle.map.has_value() ? &bundle.map->group : nullptr;
            const std::string mapName = map ? EffectiveGameId(*map) : std::string();
            if (map && mapName == PLACE_GROUP)
            {
                problems.push_back(std::string("the project map's tag group is called \"") + PLACE_GROUP
                    + "\", which is reserved for a box's own hands");
            }
            // Every box tag gameId, for the zone-name rule: a zone's address has
            // no qualified form to fall back on (3.4), so any box tag sharing it
            // anywhere makes "value.<zone>.<name>" ambiguous. First in bundle
            // order is the one a refusal names.
            OrderedMap<std::string, std::pair<std::string, std::string>> boxTags;
            for (const Box& box : bundle.boxes)
            {
                for (const TagGroup& group : box.tagGroups)
                {
                    for (const Tag& tag : group.tags)
                    {
                        const std::string gameId = EffectiveGameId(tag);
                        if (!boxTags.contains(gameId))
                        {
                            boxTags.set(gameId, std::make_pair(EffectiveGameId(box), EffectiveGameId(group)));
                        }
                    }
                }
            }
            if (map)
            {
                for (const Tag& tag : map->tags)
                {
                    const std::string zone = EffectiveGameId(tag);
                    const std::pair<std::string, std::string>* clash = boxTags.get(zone);
                    if (!clash) continue;
                    problems.push_back("the project map's zone \"" + zone + "\" has the name of tag \"" + zone
                        + "\" in box \"" + clash->first + "\", group \"" + clash->second
                        + "\", so \"value." + zone + ".<name>\" would name two things");
                }
            }
            for (const Box& box : bundle.boxes)
            {
                const std::string boxName = EffectiveGameId(box);
                if (box.usesMap)
                {
                    if (!map)
                    {
                        problems.push_back("box \"" + boxName + "\" uses the project map, but the bundle has no map");
                        continue;
                    }
                    // One namespace in an opted-in box (3.1): a box group with the
                    // map's name would make every name-based lookup there a coin
                    // toss.
                    for (const TagGroup& group : box.tagGroups)
                    {
                        if (EffectiveGameId(group) != mapName) continue;
                        problems.push_back("box \"" + boxName + "\" uses the project map and declares its own tag group \""
                            + mapName + "\", the map's name");
                        break;
                    }
                    continue;
                }
                if (!map) continue;
                // A box NOT on the map may not reference its group at all: every
                // route a reference takes, card tags, template bindings and
                // holes, a hand's chosen tags and a rule's bindings, by the
                // group's id as written.
                auto names = [&](const std::string& where)
                {
                    problems.push_back("box \"" + boxName + "\" is not on the project map, but " + where
                        + " names the map's tag group \"" + mapName + "\"");
                };
                for (const Deck& deck : box.decks)
                {
                    for (const Card& card : deck.cards)
                    {
                        if (card.tags.contains(map->id)) names("card \"" + EffectiveGameId(card) + "\"");
                    }
                }
                for (const HandTemplate& t : box.handTemplates)
                {
                    const bool chooses = std::find(t.chooses.begin(), t.chooses.end(), map->id) != t.chooses.end();
                    if (t.bindings.contains(map->id) || chooses) names("hand template \"" + EffectiveGameId(t) + "\"");
                }
                for (const Hand& hand : box.hands)
                {
                    const bool rule = hand.rule && hand.rule->bindings.contains(map->id);
                    if (hand.chosen.contains(map->id) || rule) names("hand \"" + EffectiveGameId(hand) + "\"");
                }
            }
            if (problems.empty()) return;
            std::string message = "bundle refused: ";
            for (size_t i = 0; i < problems.size(); ++i)
            {
                if (i > 0) message += "; ";
                message += problems[i];
            }
            throw StoryletError(message);
        }

        // --- the load report (design/engine-server.md 4.9) --------------------
        //
        // One walk, two entry points. previewLoad runs it and returns the
        // report; loadGame runs it, returns the same report and then applies the
        // CLEANED blob the walk produced. Two implementations of "what does this
        // save cost" would drift the first time one of them was fixed, so there
        // is one, and the apply half consumes its output rather than repeating
        // its decisions.

        /** The report under construction: unsorted, until FinishReport orders it. */
        struct ReportDraft
        {
            std::vector<LoadEviction> evicted;
            std::vector<LoadCooldown> droppedCooldowns;
            std::vector<std::string> droppedSpent;
            std::vector<LoadProperty> droppedProperties;
            std::vector<LoadProperty> defaultedProperties;
            std::vector<LoadProperty> retypedProperties;
        };

        /** The sort key separator: a UNIT SEPARATOR, because it cannot occur in
         *  an id, a gameId or a property name. */
        inline const char* const ReportSep = "\x1f";

        inline bool Contains(const std::optional<std::vector<std::string>>& list, const std::string& item)
        {
            if (!list.has_value()) return true;   // no vocabulary constrains nothing
            return std::find(list->begin(), list->end(), item) != list->end();
        }

        /**
         * Does a saved value still fit its declaration?
         *
         * The type first, then the declaration's own vocabulary: an enum value
         * or a quality stage the edit struck out is still a string of the right
         * type and still no longer a legal value. A declaration with no
         * vocabulary constrains nothing, so anything of the right type fits.
         */
        inline bool ValueFits(const PropertyDecl& decl, const StoryletValue& value)
        {
            if (decl.type == PropertyTypes::Boolean) return value.isBool();
            if (decl.type == PropertyTypes::Number) return value.isNumber();
            if (decl.type == PropertyTypes::String) return value.isString();
            if (decl.type == PropertyTypes::Enum) return value.isString() && Contains(decl.values, value.asString());
            if (decl.type == PropertyTypes::Quality) return value.isString() && Contains(decl.stages, value.asString());
            if (decl.type == PropertyTypes::Flags)
            {
                if (!value.isFlags()) return false;
                for (const auto& f : value.asFlags()) if (!Contains(decl.values, f)) return false;
                return true;
            }
            return true;
        }

        /** Walk one bag's worth of saved values against one bag's worth of
         *  declarations: report the orphans, the newcomers and the misfits, and
         *  return the values that survive. */
        inline OrderedMap<std::string, StoryletValue> WalkScope(
            const std::vector<PropertyDecl>* decls,
            const OrderedMap<std::string, StoryletValue>* saved,
            const std::string& prefix, const std::string& flow, ReportDraft& draft)
        {
            std::unordered_map<std::string, const PropertyDecl*> byName;
            if (decls) for (const auto& d : *decls) byName[d.name] = &d;
            OrderedMap<std::string, StoryletValue> clean;
            if (saved)
            {
                for (const auto& pair : *saved)
                {
                    auto found = byName.find(pair.first);
                    if (found == byName.end())
                    {
                        draft.droppedProperties.push_back(LoadProperty{flow, prefix + pair.first});
                        continue;
                    }
                    if (!ValueFits(*found->second, pair.second))
                    {
                        draft.retypedProperties.push_back(LoadProperty{flow, prefix + pair.first});
                        continue;
                    }
                    clean.set(pair.first, pair.second);
                }
            }
            if (decls)
            {
                for (const auto& d : *decls)
                {
                    if (!saved || !saved->contains(d.name))
                    {
                        draft.defaultedProperties.push_back(LoadProperty{flow, prefix + d.name});
                    }
                }
            }
            return clean;
        }

        inline std::string JoinKey(const std::vector<std::string>& parts)
        {
            std::string out;
            for (size_t i = 0; i < parts.size(); ++i)
            {
                if (i) out += ReportSep;
                out += parts[i];
            }
            return out;
        }

        /** Order the draft and answer the identity questions. `saved` is the
         *  content block the save carries; for a single-flow restore there is
         *  none, so the caller passes the bundle's own and no drift is
         *  reported. */
        inline LoadReport FinishReport(const BundleContent& bundle, const BundleContent& saved,
            const std::vector<std::string>& flows, ReportDraft& draft)
        {
            std::sort(draft.evicted.begin(), draft.evicted.end(),
                [](const LoadEviction& a, const LoadEviction& b)
                {
                    return JoinKey({a.flow, a.hand, a.card, a.reason}) < JoinKey({b.flow, b.hand, b.card, b.reason});
                });
            std::sort(draft.droppedCooldowns.begin(), draft.droppedCooldowns.end(),
                [](const LoadCooldown& a, const LoadCooldown& b)
                {
                    return JoinKey({a.flow, a.card}) < JoinKey({b.flow, b.card});
                });
            std::sort(draft.droppedSpent.begin(), draft.droppedSpent.end());
            const auto byPath = [](const LoadProperty& a, const LoadProperty& b)
            {
                return JoinKey({a.flow, a.path}) < JoinKey({b.flow, b.path});
            };
            std::sort(draft.droppedProperties.begin(), draft.droppedProperties.end(), byPath);
            std::sort(draft.defaultedProperties.begin(), draft.defaultedProperties.end(), byPath);
            std::sort(draft.retypedProperties.begin(), draft.retypedProperties.end(), byPath);

            LoadReport report;
            const bool drift = saved.version != bundle.version || saved.hash != bundle.hash;
            // `flows` is what the load restores, not something it had to change,
            // so it never makes a report inexact.
            report.exact = !drift && draft.evicted.empty() && draft.droppedCooldowns.empty()
                && draft.droppedSpent.empty() && draft.droppedProperties.empty()
                && draft.defaultedProperties.empty() && draft.retypedProperties.empty();
            report.project = bundle.project;
            report.version = LoadIdentity{saved.version, bundle.version};
            report.hash = LoadIdentity{saved.hash, bundle.hash};
            report.flows = flows;
            report.evicted = std::move(draft.evicted);
            report.droppedCooldowns = std::move(draft.droppedCooldowns);
            report.droppedSpent = std::move(draft.droppedSpent);
            report.droppedProperties = std::move(draft.droppedProperties);
            report.defaultedProperties = std::move(draft.defaultedProperties);
            report.retypedProperties = std::move(draft.retypedProperties);
            return report;
        }

        // --- the registry keys (patterkit design/one-registry-handover.md) -----

        /** The owner label on everything this engine registers: named in a
         *  clash error and carried on the registry's examiner rows. */
        inline const char* const RegistryOwner = "Storylet Engine";

        /** Identity: storylets property names are case-significant as authored. */
        inline std::string IdentityName(const std::string& n) { return n; }

        inline std::string ReplaceAll(std::string text, const std::string& from, const std::string& to)
        {
            size_t at = 0;
            while ((at = text.find(from, at)) != std::string::npos)
            {
                text.replace(at, from.size(), to);
                at += to.size();
            }
            return text;
        }

        /** An id as it sits in a registry key: `%` then `/` escaped, so no two
         *  keys can meet. Every runtime writes the same keys: they are in the
         *  save. Owners are keyed by INTERNAL id, as the save always was, so a
         *  save survives a rename. */
        inline std::string EscapeKeyPart(const std::string& id)
        {
            return ReplaceAll(ReplaceAll(id, "%", "%25"), "/", "%2F");
        }

        inline std::string UnescapeKeyPart(const std::string& id)
        {
            return ReplaceAll(ReplaceAll(id, "%2F", "/"), "%25", "%");
        }

        /** A shared box, deck, hand, or value bag's key. */
        inline std::string SharedKey(const std::string& kind, const std::string& id)
        {
            return "storylets/" + kind + "/" + EscapeKeyPart(id);
        }

        /** Every key a flow's bags register under starts with this. */
        inline std::string FlowPrefix(const std::string& flowId)
        {
            return "storylets/flow/" + EscapeKeyPart(flowId) + "/";
        }

        /** A flow's own bag's key: its @story, or a box, deck, hand, or value bag. */
        inline std::string FlowKey(const std::string& flowId, const std::string& kind, const std::string& id = std::string())
        {
            return kind == "story" ? FlowPrefix(flowId) + "story" : FlowPrefix(flowId) + kind + "/" + EscapeKeyPart(id);
        }

        /** A registry section's values: registry key -> name -> value. */
        using Sections = OrderedMap<std::string, OrderedMap<std::string, StoryletValue>>;

        inline std::vector<std::string> SplitKey(const std::string& key)
        {
            std::vector<std::string> parts;
            size_t start = 0;
            while (true)
            {
                const size_t slash = key.find('/', start);
                if (slash == std::string::npos)
                {
                    parts.push_back(key.substr(start));
                    return parts;
                }
                parts.push_back(key.substr(start, slash - start));
                start = slash + 1;
            }
        }

        /** A registry save's sections sorted back into partitions, for the load
         *  walk: the shared ones, each flow's (only the flows the save restores;
         *  the rest are dropped), and everything that is not this engine's,
         *  passed through. The TypeScript reference's four patterns, matched
         *  without <regex>, which the std core deliberately avoids. */
        struct MovedValues
        {
            PropsPartition shared;
            OrderedMap<std::string, PropsPartition> flows;
            Sections rest;
        };

        inline MovedValues PartitionsFromSections(const Sections& sections, const std::unordered_set<std::string>& flowIds)
        {
            MovedValues moved;
            auto flowOf = [&moved, &flowIds](const std::string& escaped) -> PropsPartition*
            {
                const std::string id = UnescapeKeyPart(escaped);
                if (flowIds.count(id) == 0) return nullptr;
                if (!moved.flows.contains(id)) moved.flows.set(id, PropsPartition());
                return moved.flows.get(id);
            };
            auto isKind = [](const std::string& k) { return IsOwnedScope(k); };
            for (const auto& pair : sections)
            {
                const std::string& key = pair.first;
                if (key == "story")
                {
                    moved.shared.story = pair.second;
                    continue;
                }
                if (key.compare(0, 10, "storylets/") != 0)
                {
                    moved.rest.set(key, pair.second);
                    continue;
                }
                const std::vector<std::string> parts = SplitKey(key);
                bool wellFormed = true;   // every segment is [^/]+
                for (const auto& part : parts) if (part.empty()) wellFormed = false;
                if (!wellFormed) continue;
                if (parts.size() == 3 && isKind(parts[1]))
                {
                    KindOf(moved.shared, parts[1]).set(UnescapeKeyPart(parts[2]), pair.second);
                }
                else if (parts.size() == 4 && parts[1] == "flow" && parts[3] == "story")
                {
                    if (PropsPartition* p = flowOf(parts[2])) p->story = pair.second;
                }
                else if (parts.size() == 5 && parts[1] == "flow" && isKind(parts[3]))
                {
                    if (PropsPartition* p = flowOf(parts[2])) KindOf(*p, parts[3]).set(UnescapeKeyPart(parts[4]), pair.second);
                }
                // Anything else under `storylets/` is this engine's and no
                // bag's any more: dropped.
            }
            return moved;
        }

        /** A cleaned partition as registry sections, keyed the way its bags
         *  register. Empty sections are left out: they would load nothing, and a
         *  section for a bag that never registers would wait in the registry for
         *  ever. */
        inline void SectionsOf(const PropsPartition& p,
            const std::function<std::string(const std::string&, const std::string&)>& keyOf, Sections& out)
        {
            if (p.story.size() > 0) out.set(keyOf("story", std::string()), p.story);
            for (const char* kind : {"box", "deck", "hand", "value"})
            {
                for (const auto& pair : KindOf(p, kind))
                {
                    if (pair.second.size() > 0) out.set(keyOf(kind, pair.first), pair.second);
                }
            }
        }

        /** @world through the host's resolver, as the registry takes a foreign
         *  scope. `set` left empty is a read-only binding. */
        class WorldResolverScope : public IScopeResolver
        {
        public:
            explicit WorldResolverScope(WorldResolver resolver) : resolver_(std::move(resolver)) {}
            std::optional<StoryletValue> get(const std::string& name) const override
            {
                return resolver_.get ? resolver_.get(name) : std::nullopt;
            }
            bool canSet() const override { return static_cast<bool>(resolver_.set); }
            void set(const std::string& name, const StoryletValue& value) override { resolver_.set(name, value); }
        private:
            WorldResolver resolver_;
        };

        /** A declaration list as the registry and the bag take it. */
        inline std::vector<ScopeDeclaration> PlainDecls(const std::vector<PropertyDecl>& decls)
        {
            return std::vector<ScopeDeclaration>(decls.begin(), decls.end());
        }

        // --- durable state (ruling H, 2026-10-06) ------------------------------

        /** A card whose spend outlives the run: `redraw: never`, with `durable`
         *  on the card or, failing that, its deck, the same fall-through
         *  `shared` has. Only `never` can cross a run boundary: a finite
         *  cooldown is an absolute turn of a clock that restarts with the run. */
        inline bool CardIsDurable(const Card& card, const Deck& deck)
        {
            return card.redraw.kind == RedrawPolicy::Kind::Never
                && card.durable.value_or(deck.durable.value_or(false));
        }

        /** One durable declaration on one side of the sharing flag, with the
         *  address a durable half keys it by and where its bag is. */
        struct DurableProp
        {
            std::string address;
            /** "story", or the owned scope word. */
            std::string kind;
            /** The owner's internal id; empty for `story`. */
            std::string owner;
            PropertyDecl decl;
        };

        /** The durable declarations and durable cards on each side, precomputed
         *  once from the two declaration halves and the decks. */
        struct DurableIndex
        {
            std::vector<DurableProp> shared;
            std::vector<DurableProp> flow;
            std::vector<CardEntry> sharedCards;
            std::vector<CardEntry> flowCards;
        };

        /** What a durable half will write, decided before anything is written. */
        struct DurablePlan
        {
            /** Index into the side's DurableProp list, and the value it takes,
             *  in the order the half carried them. */
            std::vector<std::pair<size_t, StoryletValue>> values;
            /** Internal card ids to spend. */
            std::vector<std::string> cards;
        };

        /** The bag a durable declaration lives in on one side; null for an
         *  owner that side has no bag for. */
        inline PropertyBag* DurableBag(const Partition& p, const DurableProp& prop)
        {
            if (prop.kind == "story") return p.story.get();
            const std::shared_ptr<PropertyBag>* bag = KindOf(p, prop.kind).get(prop.owner);
            return bag ? bag->get() : nullptr;
        }

        /** One half's values, keys in byte order so the same state writes the
         *  same text. */
        inline OrderedMap<std::string, StoryletValue> DurableValues(const Partition& p, const std::vector<DurableProp>& props)
        {
            std::vector<std::pair<std::string, StoryletValue>> entries;
            for (const DurableProp& prop : props)
            {
                const PropertyBag* bag = DurableBag(p, prop);
                std::optional<StoryletValue> value = bag ? bag->get(prop.decl.name) : std::nullopt;
                if (value.has_value()) entries.emplace_back(prop.address, std::move(*value));
            }
            std::sort(entries.begin(), entries.end(),
                [](const std::pair<std::string, StoryletValue>& a, const std::pair<std::string, StoryletValue>& b)
                {
                    return a.first < b.first;
                });
            OrderedMap<std::string, StoryletValue> out;
            for (auto& entry : entries) out.set(entry.first, std::move(entry.second));
            return out;
        }

        /** A host write of one durable value: silent, as every host write is,
         *  and past a `writable: false`, which is the story's promise and not
         *  the game's. */
        inline void PutDurable(PropertyBag* bag, const std::string& name, const StoryletValue& value)
        {
            if (bag) bag->set(name, value, /*silent=*/true, "host durable", /*host=*/true);
        }
    }

    class Flow;
    using FlowPtr = std::shared_ptr<Flow>;

    /** The world + flow manager (design/flows.md; the shape is Patter's):
     *  owns the bundle, every lookup built from it, the SHARED property
     *  partitions and the @world seam; ALL play happens on a Flow from
     *  openFlow(id). Every bag that declares something is registered in the
     *  game's one ScopeRegistry (EngineOptions::registry) or the engine's own. */
    class Engine
    {
    public:
        /** Throws, leaving the game's registry as it was, when a token this
         *  engine registers (`story`, or `world` with a resolver) is already
         *  another's: the error names who holds it. */
        explicit Engine(BundlePtr bundle, const EngineOptions& opts = {});

        /** Closes every flow and takes this engine's bags out of the registry
         *  (an engine goes away: its bags go with it). */
        ~Engine();

        Engine(const Engine&) = delete;
        Engine& operator=(const Engine&) = delete;

        /** The registry this engine's bags live in: the game's, or the one it
         *  made because it was given none. */
        const std::shared_ptr<ScopeRegistry>& registry() const { return registry_; }

        /** True when the engine made its registry itself (no registry option):
         *  it is then its own game, and saveGame() carries the values. */
        bool ownsRegistry() const { return ownsRegistry_; }

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

        /** Close every flow (their bags leave the registry), forget spent cards
         *  and the run's log, and reseed the shared state to its defaults in
         *  place (the self-backed @world included; a host-bound @world is the
         *  host's). Values loaded into the registry for this engine's bags and
         *  not yet claimed are dropped; every other engine's stay. */
        void reset();

        // --- shared scarcity (design/shared-scarcity.md) ----------------------

        /** Cards a shared `redraw: never` has taken out of the world, by card
         *  id. The claim ledger is DERIVED from live boards and needs no
         *  storage; this one is durable, so it rides the save. */
        bool isTaken(const std::string& cardId) const { return spent_.count(cardId) > 0; }

        /** Shared claims across every LIVE flow, card id -> holders. Derived,
         *  which is what makes closeFlow and the openFlow replace release what
         *  a flow was holding: its board leaves the map with it. */
        std::unordered_map<std::string, int> sharedClaims() const;

        /** The same ledger with one name left out: what the REST of the world
         *  holds, which is the question a resume under that name has to ask. */
        std::unordered_map<std::string, int> sharedClaimsExcept(const std::string& id) const;

    private:
        /** The one walk behind both: every live flow's board, but `except`. */
        std::unordered_map<std::string, int> claimsHeld(const std::string* except) const;

        /** Internal: take a shared one-shot out of the world, as its play does
         *  (a Flow, which is a friend, calls it). Keyed by internal id. A host
         *  carries spends across a run with saveDurable and loadDurable, which
         *  speak gameIds and check that the card is still one that may be
         *  carried (ruling H). */
        void markTaken(const std::string& cardId) { spent_.insert(cardId); }

    public:

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
         *  "box.village.heat" (when shared) - the owner segment is its GAMEID
         *  (design/engine-server.md 4.4), and its internal id is accepted for
         *  this release with a diagnostic naming the address to move to. A ref
         *  that resolves PER-FLOW throws, naming the fix (Patter's teaching
         *  rule). Another engine's game-wide scope in the registry reads by its
         *  path too ("patter.gold"): every engine reads every scope. */
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
            for (const auto& pair : shared_.box) mounts.push_back({addressOf("box", pair.first), pair.second});
            for (const auto& pair : shared_.deck) mounts.push_back({addressOf("deck", pair.first), pair.second});
            for (const auto& pair : shared_.hand) mounts.push_back({addressOf("hand", pair.first), pair.second});
            for (const auto& pair : shared_.value) mounts.push_back({addressOf("value", pair.first), pair.second});
            return mounts;
        }

        /** Every flow's trace, one stream, each event tagged with its flow id
         *  - the tools' one stream. Returns the unsubscribe.
         *
         *  The unsubscribe captures this engine by raw pointer: call it while
         *  the engine is alive, or not at all (an engine that goes away takes
         *  its handlers with it). It is safe from inside a handler, since
         *  delivery runs over a copy of the handler list.
         *
         *  The same handler subscribed twice is registered once (ruling F; JS
         *  keeps its handlers in a Set). A std::function has no identity to
         *  compare (and target() needs RTTI, which Unreal builds without), so
         *  the handler's identity is the caller's to give: `identity`, any
         *  address that stands for the handler (the object it belongs to, the
         *  function it wraps). Subscribing an identity already registered
         *  hands back an unsubscribe for that one registration, and either
         *  unsubscribe removes it. Without one, every subscribe is its own
         *  registration, as each new closure is its own handler in JS. */
        std::function<void()> subscribeTrace(std::function<void(const std::string&, const TraceEvent&)> handler,
            const void* identity = nullptr)
        {
            uint64_t id = detail::RegisteredAs(engineTraceIdentities_, identity);
            if (id == 0)
            {
                id = nextEngineTraceId_++;
                engineTraceHandlers_.push_back({id, std::move(handler)});
                if (identity) engineTraceIdentities_.emplace_back(identity, id);
            }
            return [this, id]()
            {
                detail::ForgetIdentity(engineTraceIdentities_, id);
                engineTraceHandlers_.erase(
                    std::remove_if(engineTraceHandlers_.begin(), engineTraceHandlers_.end(),
                        [id](const EngineTraceHandler& h) { return h.first == id; }),
                    engineTraceHandlers_.end());
            };
        }

        /** The whole engine's NON-property state, one envelope
         *  (storylets/save@2): the spent cards once, then every live flow
         *  (board, clocks, cooldowns, PRNG, play log) keyed by its id. The
         *  property values are the registry's: a standalone engine (one that
         *  made its own registry) carries them here under `registry`,
         *  self-backed @world included; a game that passed a registry saves it
         *  once itself, beside each engine's envelope. */
        SaveEnvelope saveGame() const;

        /** ONE flow's blob, to park a visit that is walking away: the shape
         *  the envelope carries per flow, plus the flow's properties, and the
         *  same shape openFlow's `restore` option takes back
         *  (design/engine-server.md 4.1). Parked whole, properties included: a
         *  parked flow's bags leave the registry when it closes, so its values
         *  have to travel with it. Saving the whole envelope to park one of
         *  four hundred players is wrong in cost and in meaning. Throws for a
         *  name that is not open - a closed flow has nothing left to save. */
        FlowSave saveFlow(const std::string& id) const;

        /** What loadGame(envelope) would do that is not a plain restore, without
         *  doing any of it (design/engine-server.md 4.9). Pure: nothing on this
         *  engine moves. A project mismatch is refused here exactly as loadGame
         *  refuses it - it is the one thing neither call will tolerate. */
        LoadReport previewLoad(const SaveEnvelope& envelope) const;

        /** What openFlow(id, { restore: saved }) would do to a flow of that
         *  name, without doing it: the same report shape, since a visit parked
         *  under one build and resumed under the next raises the same questions.
         *  Pure. */
        LoadReport previewFlowRestore(const std::string& id, const FlowSave& saved) const;

        /** Restore: shared state once, then every flow REBUILT from its
         *  blob. Handles held from before the load are closed and inert;
         *  take fresh ones from getFlow()/flows(). Takes storylets/save@2 and
         *  storylets/save@1 alike.
         *
         *  Property values come from the registry. An envelope that carries
         *  them (a standalone engine's, or a version 1 envelope) has them
         *  walked, cleaned, and moved into the registry here, over fresh
         *  defaults. Otherwise the game loads its registry itself, before or
         *  after this call: each flow's bags are handed back to the registry
         *  with their values, and the restored flows claim them. The report then
         *  covers only what this envelope holds; the registry's own load rule
         *  applies to the values.
         *
         *  Returns the report previewLoad would have given for this envelope:
         *  the drift tolerance that makes a load forgiving is what hides its
         *  cost, so the cost comes back with the load whether or not anybody
         *  looked first. */
        LoadReport loadGame(const SaveEnvelope& envelope);

        // --- durable state (ruling H, 2026-10-06) ----------------------------

        /** The engine's DURABLE HALF, the installation's memory: every shared
         *  `durable` property's value by its address, and every shared durable
         *  one-shot that has been spent, by card gameId. What a new run starts
         *  from, through loadDurable; a flow's own half is
         *  Flow::saveDurable. */
        DurableSave saveDurable() const;

        /**
         * Write the engine's durable half into this engine, a fresh one at the
         * top of a new run. Every shared durable property takes the memory's
         * value, or its default where the memory carries none that fits, and
         * every spend the memory lists is taken out of the world. Nothing else
         * is touched: not a run-scoped value, not a flow, not a spend the
         * memory does not name.
         *
         * Returns the report loadGame would give, for this half: an address
         * this build does not declare durable and shared is dropped, a value
         * its declaration no longer takes is retyped, a durable declaration the
         * memory lacks is defaulted, and a spend for a card that is no longer a
         * shared durable one-shot is a dropped spent card. Another project's
         * memory, or an unknown schema, is refused before anything moves.
         */
        LoadReport loadDurable(const DurableSave& memory);

        // --- the @world seam (used by flows and hosts alike) -----------------

        /** @world, read through the registry by name (the scope's own
         *  normalisation), so a @world the game registered folded to lower case
         *  still answers the names as authored. Nothing registered under
         *  `world` reads as unset. */
        std::optional<StoryletValue> worldGet(const std::string& name) const
        {
            return registry_->get("world", name);
        }

        /** The story's promise about a @world value (writable == false on its declaration),
         *  kept at runtime as the compiler keeps it at publish. Asked by a flow's outcome
         *  write; the host's own setProperty never asks. */
        bool worldReadOnly(const std::string& name) const
        {
            for (const auto& d : bundle_->world.properties)
                if (d.name == name) return d.writable.has_value() && !*d.writable;
            return false;
        }

        bool worldCanSet() const
        {
            return hostWorld_.has_value() ? static_cast<bool>(hostWorld_->set) : true;
        }

        /** The @world WRITE seam, through the registry. `host` says the caller is
         *  the GAME's own surface - setProperty and the tooling built on it - which
         *  the shared kernel lets past a `writable: false` (scoperegistry 0.6.0):
         *  that flag is the story's promise, not the game's. The story's refusal is
         *  worldReadOnly, asked before this seam is reached. A BOUND resolver is
         *  opaque - it takes a name and a value and keeps whatever rule the game
         *  has - so it is always written as the host, and the flag only reaches a
         *  @world the registry stores. A refusal is the kernel's RegistryError,
         *  rethrown as StoryletError. */
        void worldSet(const std::string& name, const StoryletValue& value, bool host = false)
        {
            kernelCall([&] { registry_->set("world", name, value, hostWorld_.has_value() ? true : host); });
        }

        /** What hotSwap hands back: the replacement engine, and the report its
         *  load produced. */
        struct HotSwapResult
        {
            std::unique_ptr<Engine> engine;
            LoadReport report;
        };

        /**
         * Live bundle refresh: rebuild on an edited bundle with the whole run
         * carried over, and return the replacement with the report its load
         * produced. The replacement is built from a copy of the options this
         * engine was built with (seed, log, world, onReplacedFlow); `change`,
         * when given, edits that copy first, so only what it changes differs
         * (`[](EngineOptions& o) { o.seed = 7; }` keeps the rest). It always
         * lands on this engine's registry, or a new one of its own when this
         * engine made its own: the registry is not the caller's to change here,
         * so a `registry` that `change` sets is ignored.
         *
         * Standalone, that is a save and a load into a new engine, and this one
         * is left untouched (discard it). With the game's registry the two cannot
         * both hold the same keys, so this engine is spent afterwards (its flows
         * closed, the replacement holding everything on the same registry): it
         * carries its own values into the snapshot, steps out of the registry,
         * and the replacement loads them the way a standalone save loads: so the
         * report covers the properties the edit dropped, defaulted, or retyped,
         * and a dropped property is dropped rather than kept. Values the game
         * loaded that were still waiting for a flow of this engine carry across
         * as they were, and nothing belonging to any other engine is touched. A
         * save for another project is refused before anything moves; if the
         * rebuild fails for any other reason, this engine takes its
         * registrations back and is left exactly as it was. A refusal is a
         * StoryletError (or the replacement's own EvalError), never the kernel's.
         */
        HotSwapResult hotSwap(BundlePtr bundle, const std::function<void(EngineOptions&)>& change = {});

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
        // The owner segment of that prefix is the owner's GAMEID (4.4); the map it is
        // keyed under is still the internal id, because a save must survive a rename.
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
                // templatesById_ holds every template in every box, indexed
                // before anything asks, so a miss is a template the bundle does
                // not have: it declares nothing.
                const HandTemplate* const* known = templatesById_.get(hand.templateId);
                return known ? (*known)->properties : empty;
            }
            return hand.properties;
        }

        /**
         * One owned property's ADDRESS, owner segment and all: "box.village"
         * (design/engine-server.md 4.4). The name is pasted on by the caller,
         * because a bag's path prefix wants the separator and a trace path does
         * not.
         *
         * The stores, the save envelope and the ladders stay keyed by internal
         * id - a save must survive a rename, which is the whole reason ids
         * exist - so this is the one place the two vocabularies meet, and it is
         * a formatter, never a lookup key. An owner the build no longer has (a
         * save that outlived an edit) keeps the id it arrived with: there is no
         * gameId left to give it, which is the rule a load report's evictions
         * have always used.
         */
        std::string addressOf(const std::string& kind, const std::string& id) const
        {
            const std::string* gameId = detail::KindOf(owners_, kind).gameId.get(id);
            return kind + "." + (gameId ? *gameId : id);
        }

        /**
         * Resolve a property address's owner segment to the internal id the
         * stores are keyed by. `outLegacy` says the caller used the pre-4.4
         * form - an internal id where a gameId belongs - which resolves for
         * THIS release and earns a diagnostic; the next lockstep release
         * refuses it, in every scope including "value". False when the segment
         * names no owner at all, which is the caller's "no <kind> store"
         * error, and false too for an ambiguous short form, which is
         * deliberately not in the id map: see ownerOrThrow.
         */
        bool resolveOwner(const std::string& kind, const std::string& segment,
            std::string& outId, bool& outLegacy) const
        {
            const detail::OwnerIndex& index = detail::KindOf(owners_, kind);
            const std::string* byGameId = index.id.get(segment);
            if (byGameId)
            {
                outId = *byGameId;
                outLegacy = false;
                return true;
            }
            // A gameId that equals its id took the branch above, so anything
            // reaching here and known as an id is genuinely the old spelling.
            if (index.gameId.contains(segment))
            {
                outId = segment;
                outLegacy = true;
                return true;
            }
            return false;
        }

        /** What an ambiguous short-form value address is told: the candidates,
         *  in full, because "that names two tags" without them leaves a host
         *  reading a bundle it did not write to find out which boxes. */
        std::string ambiguousAddressMessage(const std::string& segment, const std::string& name,
            const std::vector<std::string>& candidates) const
        {
            std::string list;
            for (size_t i = 0; i < candidates.size(); ++i)
            {
                if (i > 0) list += (i + 1 == candidates.size() ? " or " : ", ");
                list += "\"value." + candidates[i] + "." + name + "\"";
            }
            return "\"value." + segment + "." + name + "\" names a tag in "
                + std::to_string(candidates.size()) + " boxes; write " + list;
        }

        /** Resolve or refuse: the two refusals every property address shares,
         *  in one place, so the engine's own surface and a flow's answer with
         *  the same words. */
        std::string ownerOrThrow(const std::string& kind, const std::string& segment,
            const std::string& name, bool& outLegacy) const
        {
            const std::vector<std::string>* candidates = detail::KindOf(owners_, kind).repeated.get(segment);
            if (candidates) throw StoryletError(ambiguousAddressMessage(segment, name, *candidates));
            // A box-qualified form of a project-map zone: never accepted,
            // because the zone belongs to no box (design/project-map-contract.md
            // 3.4). The refusal names the address that works.
            const std::string* zone = detail::KindOf(owners_, kind).zoneQualified.get(segment);
            if (zone)
            {
                throw StoryletError("\"value." + segment + "." + name + "\": \"" + *zone
                    + "\" is a zone of the project map, which belongs to no box; write \"value."
                    + *zone + "." + name + "\"");
            }
            std::string id;
            if (!resolveOwner(kind, segment, id, outLegacy))
            {
                throw StoryletError("no " + kind + " store \"" + segment + "\"");
            }
            return id;
        }

        /** What a legacy address is told. It NAMES the address to move to,
         *  because "that form is deprecated" without the replacement leaves a
         *  host grepping a bundle for ids it never chose. */
        std::string legacyAddressMessage(const std::string& kind, const std::string& segment,
            const std::string& name) const
        {
            return "\"" + kind + "." + segment + "." + name + "\" names the " + kind
                + " by its internal id; write \"" + addressOf(kind, segment) + "." + name + "\". "
                + "The internal-id form is refused after the next release.";
        }

        /** The engine's own surface has no flow, so an engine-level diagnostic
         *  carries the EMPTY flow id - the same way a LoadReport's shared half
         *  carries no flow. It reaches the run log and the engine tap; there is
         *  nowhere else for it to go, and it fires only on a legacy address.
         *  const because getProperty is, with Flow::diagnose's own const_cast
         *  and for the same reason. */
        void diagnose(const std::string& message) const
        {
            TraceEvent evt;
            evt.kind = TraceEvent::Kind::Diagnostic;
            evt.where = "property address";
            evt.message = message;
            const_cast<Engine*>(this)->emitEngine("", evt, std::nullopt);
        }

        /** One owned-scope address, resolved: the store's internal id, and
         *  whether the caller spelled the owner the pre-4.4 way. Resolved ONCE
         *  per call and handed to whichever half needs it, so the read that
         *  refuses a write and the write itself can never disagree about which
         *  store an address names. */
        struct OwnedAddress
        {
            std::string kind;
            std::string segment;
            std::string id;
            std::string name;
            bool legacy = false;
        };

        /** Resolve an owned-scope path ("box.village.heat") for both property
         *  verbs, diagnostic and all. Throws for an owner segment that names
         *  nothing at all, and for a short-form value segment that names a tag
         *  in more than one box. */
        OwnedAddress resolveOwned(const std::vector<std::string>& parts) const
        {
            OwnedAddress owned;
            owned.kind = parts[0];
            owned.segment = parts[1];
            owned.name = parts[2];
            owned.id = ownerOrThrow(owned.kind, owned.segment, owned.name, owned.legacy);
            if (owned.legacy) diagnose(legacyAddressMessage(owned.kind, owned.segment, owned.name));
            return owned;
        }

        /** The read half of getProperty, over an owner segment already
         *  resolved. setProperty routes its refusals through this same call. */
        StoryletValue readShared(const std::string& path, const std::vector<std::string>& parts,
            const std::optional<OwnedAddress>& owned) const;

        /** Build the shared stores, once, for the engine's life: reset and
         *  loads reseed the bags in place, so the registry never sees them come
         *  and go. */
        void initShared()
        {
            detail::Partition shared;
            shared.story = bagFromDecls(half("story", bundle_->story.properties, true), "story.");
            for (const auto& box : bundle_->boxes)
            {
                shared.box.set(box.id, bagFromDecls(half("box", box.properties, true), addressOf("box", box.id) + "."));
                for (const auto& deck : box.decks)
                {
                    shared.deck.set(deck.id, bagFromDecls(half("deck", deck.properties, true), addressOf("deck", deck.id) + "."));
                }
                for (const auto& hand : box.hands)
                {
                    shared.hand.set(hand.id, bagFromDecls(half("hand", handDecls(hand), true), addressOf("hand", hand.id) + "."));
                }
                for (const auto& group : box.tagGroups)
                {
                    for (const auto& tag : group.tags)
                    {
                        shared.value.set(tag.id, bagFromDecls(half("value", tag.properties, true), addressOf("value", tag.id) + "."));
                    }
                }
            }
            // The project map's zones ONCE (design/project-map-contract.md 3.3):
            // a zone is one bag per partition, whichever boxes' hands are dealt
            // to it.
            if (bundle_->map.has_value())
            {
                for (const auto& tag : bundle_->map->group.tags)
                {
                    shared.value.set(tag.id, bagFromDecls(half("value", tag.properties, true), addressOf("value", tag.id) + "."));
                }
            }
            shared_ = std::move(shared);
            registerShared();
        }

        /** Register the shared bags and @world. On a throw (a token another
         *  engine or the game already holds), whatever this registered comes
         *  out again, keeping its values, so a clash leaves the game's registry
         *  as it was; then the error goes on. */
        void registerShared()
        {
            ScopeRegistry& reg = *registry_;
            std::vector<std::string> registered;
            try
            {
                // `story` is this engine's token whether or not the bundle
                // declares a shared @story property: registering it is what makes
                // a clash show at once. Claims values the game loaded first.
                reg.mountOwned("story", shared_.story, std::string(detail::RegistryOwner));
                registered.push_back("story");
                for (const char* kind : {"box", "deck", "hand", "value"})
                {
                    for (const auto& pair : detail::KindOf(shared_, kind))
                    {
                        if (pair.second->declarations().empty()) continue;   // holds nothing: not registered
                        const std::string key = detail::SharedKey(kind, pair.first);
                        reg.mountOwned(key, pair.second, std::string(detail::RegistryOwner));
                        registered.push_back(key);
                    }
                }
                const std::vector<ScopeDeclaration> worldDecls = detail::PlainDecls(bundle_->world.properties);
                if (hostWorld_.has_value())
                {
                    // The game keeps these values: an external scope, never saved.
                    ForeignScopeOptions options;
                    options.normalise = &detail::IdentityName;
                    options.owner = std::string(detail::RegistryOwner);
                    reg.defineForeign("world", std::make_shared<detail::WorldResolverScope>(*hostWorld_), &worldDecls, options);
                    registered.push_back("world");
                }
                else if (ownsRegistry_ && (selfWorld_ || !reg.has("world")))
                {
                    // Standalone: self-backed from the declared defaults,
                    // DECLARATIONS AND ALL, as a property the registry stores and
                    // SAVES (only a resolver the game binds is external). The bag
                    // keeps `writable: false` so an examiner still reads it there,
                    // and the kernel lets a host write past it, which is what the
                    // game's own surface passes.
                    OwnedScopeOptions options;
                    options.normalise = &detail::IdentityName;
                    options.pathPrefix = std::string("world.");
                    options.owner = std::string(detail::RegistryOwner);
                    reg.defineOwned("world", worldDecls, options);
                    registered.push_back("world");
                    selfWorld_ = true;
                }
                // Given the game's registry and no resolver, @world is the game's
                // to register: this engine registers nothing for it.
            }
            catch (...)
            {
                // The clash itself is the kernel's RegistryError, rethrown as StoryletError.
                for (const auto& key : registered) reg.remove(key, /*keep=*/true);
                rethrowKernelError();
            }
            registered_ = std::move(registered);
        }

        /** Every shared bag back to its declared defaults, in place (the
         *  registry keeps them registered), the self-backed @world included. */
        void reseedShared()
        {
            const std::vector<ScopeDeclaration> story = detail::PlainDecls(sharedDecls_.story);
            shared_.story->reseed(&story);
            for (const char* kind : {"box", "deck", "hand", "value"})
            {
                const OrderedMap<std::string, std::vector<PropertyDecl>>& decls = detail::KindOf(sharedDecls_, kind);
                for (const auto& pair : detail::KindOf(shared_, kind))
                {
                    const std::vector<PropertyDecl>* found = decls.get(pair.first);
                    const std::vector<ScopeDeclaration> plain = found ? detail::PlainDecls(*found) : std::vector<ScopeDeclaration>();
                    pair.second->reseed(&plain);
                }
            }
            if (selfWorld_)
            {
                registry_->reseedOwned("world", detail::PlainDecls(bundle_->world.properties));
            }
        }

        /** Every OTHER scope in the registry, as an eval context sees it (instance
         *  keys left out: `storylets/deck/x`, another engine's, is no expression
         *  token), rebuilt only when the registry's set of scopes moves. The
         *  values stay live: a context holds the bags, not copies. */
        struct RegistryView
        {
            std::unordered_map<std::string, std::shared_ptr<const IScopeSource>> scopes;
            std::function<const std::vector<std::string>*(const std::string&, const std::string&)> qualities;
        };

        const RegistryView& registryView() const
        {
            if (registry_->revision() != viewRevision_)
            {
                EvalContext ctx = registry_->toEvalContext();
                RegistryView view;
                for (const auto& pair : ctx.scopes)
                {
                    if (pair.first.find('/') == std::string::npos) view.scopes.emplace(pair.first, pair.second);
                }
                view.qualities = ctx.qualities;
                view_ = std::move(view);
                viewRevision_ = registry_->revision();
            }
            return view_;
        }

        /** openFlow, and loadGame's rebuild. `claim` says the new flow's bags
         *  take the values the registry holds for them (a load); a fresh open
         *  is a reset of that name, so anything waiting for it is discarded
         *  first. */
        FlowPtr open(const std::string& id, const OpenFlowOptions& opts, bool claim);

        /** End the run: clear the log, close every flow, forget spent cards.
         *  Each flow's bags leave the registry; `keepFlows` names the flows
         *  whose values are kept there for the flow that replaces them (a load
         *  into the game's registry). */
        void dropRun(const std::unordered_set<std::string>* keepFlows);

        void initLadders();

        /** Content that names another engine's scope (`@patter.visits`) runs
         *  only where that engine is on this registry: without it every read
         *  would answer false and every write fail, so the flow is refused as it
         *  opens (loadGame's rebuild included) and a save as it loads, before
         *  anything changes. By then a game has built all of its engines,
         *  whatever order it built them in. The same message on every runtime. */
        void assertExternalScopes() const
        {
            for (const std::string& token : bundle_->externalScopes)
            {
                if (!registry_->has(token))
                {
                    throw StoryletError("this content names @" + token
                        + ", which no engine on this registry registered: give every engine the game's one registry");
                }
            }
        }

        void emitEngine(const std::string& flowId, const TraceEvent& evt, std::optional<double> turn)
        {
            // Retain first, then notify: the run's log is the record,
            // subscribers are the live view, and a handler that reads log()
            // should see its own event.
            if (logCap_.has_value())
            {
                // Clamped as the flow log is: a negative cap empties the log, as
                // JS's slice does, where the bare cast read it as a size beyond
                // any vector and never trimmed at all.
                const size_t cap = static_cast<size_t>(std::max(*logCap_, 0));
                EngineLogEntry entry;
                entry.event = evt;
                entry.flow = flowId;
                entry.seq = engineSeq_++;
                entry.turn = turn;
                engineLog_.push_back(std::move(entry));
                if (engineLog_.size() > cap)
                {
                    engineLog_.erase(engineLog_.begin(),
                        engineLog_.begin() + static_cast<ptrdiff_t>(engineLog_.size() - cap));
                }
            }
            std::vector<EngineTraceHandler> handlers = engineTraceHandlers_;
            for (const auto& handler : handlers) handler.second(flowId, evt);
        }

        bool engineTracing() const { return !engineTraceHandlers_.empty(); }

        BundlePtr bundle_;
        /** The options this engine was built with: hotSwap builds its replacement from them. */
        EngineOptions creationOptions_;
        double seed_ = 0;
        std::function<void(const std::string&, int)> onReplacedFlow_;
        std::optional<int> logCap_;
        std::optional<WorldResolver> hostWorld_;
        /** The game's one registry (or the engine's own, when it is standalone). */
        std::shared_ptr<ScopeRegistry> registry_;
        /** True when the engine made the registry: saveGame() then carries its values. */
        bool ownsRegistry_ = false;
        /** True when the engine self-backed @world (standalone, no resolver bound). */
        bool selfWorld_ = false;
        /** The keys the engine itself registered (flows keep their own), in order. */
        std::vector<std::string> registered_;
        /** The @world rows that open both listProperties, the engine's and a
         *  flow's: read through the resolver, in declaration order. */
        void addWorldRows(std::vector<PropertyRow>& rows) const;
        /** saveGame's `registry` section, in the order a load rebuilds it. */
        OrderedMap<std::string, OrderedMap<std::string, StoryletValue>> registrySection() const;
        mutable int viewRevision_ = -1;
        mutable RegistryView view_;
        /** The walk both entry points share, and what the apply half writes. */
        struct LoadPlan
        {
            LoadReport report;
            /** The cleaned property values to move into the registry, when the
             *  envelope carries any. */
            std::optional<detail::Sections> sections;
            std::vector<std::string> spent;
            OrderedMap<std::string, FlowSave> flows;
        };
        void assertSameProject(const SaveEnvelope& envelope) const;
        LoadPlan planLoad(const SaveEnvelope& envelope) const;
        /** One flow's walk. `otherClaims` is the rest of the world's shared
         *  ledger and is present only for a SINGLE-flow restore into a live
         *  engine: a whole-envelope load rebuilds every flow from one consistent
         *  moment, so there is nobody else to compete with. */
        FlowSave planFlowRestore(const std::string& id, const FlowSave& saved,
            const std::unordered_map<std::string, int>* otherClaims, detail::ReportDraft& draft) const;
        /** The scope walk over all five scopes of one partition. */
        PropsPartition walkPartition(const detail::FlowDecls& decls, const PropsPartition* values,
            const std::string& flow, detail::ReportDraft& draft) const;

        /** Every durable declaration in one side's halves, in bundle order.
         *  Where two owners print the same address (two groups in one box
         *  naming a tag alike, the residual the compiler is closing) the first
         *  answers, which is the rule resolveOwner keeps for the same address. */
        std::vector<detail::DurableProp> durableProps(const detail::FlowDecls& decls) const;

        /** The two refusals every durable load shares, made before anything
         *  moves: a shape this runtime does not know, and another project's
         *  state. */
        void assertDurable(const DurableSave& save) const;

        /**
         * Walk one durable half against this build's durable declarations and
         * durable cards on one side (`flow` names the flow for a pocket;
         * absent, it is the engine's memory), filing what does not fit in the
         * load report's own fields. Pure: the caller writes the plan.
         *
         * A value lands only at an address this build declares DURABLE ON THIS
         * SIDE: a renamed property, one no longer durable, and one that moved
         * to the other side of `shared` are all dropped, since this half would
         * never have carried them. A value its declaration no longer takes is
         * retyped and takes the default; a durable declaration the half does
         * not carry is defaulted. A spend lands only on a card that is still a
         * durable one-shot on this side, and is otherwise a dropped cooldown (a
         * pocket's spends are cooldowns) or a dropped spent card (a memory's
         * are the engine's spent set), named by the gameId the half carried.
         */
        detail::DurablePlan planDurable(const std::vector<detail::DurableProp>& props,
            const std::vector<detail::CardEntry>& cards, const DurableSave& save,
            const std::optional<std::string>& flow, detail::ReportDraft& draft) const;

        /** The durable declarations and durable cards on each side, built once
         *  at construction (a bundle never changes). */
        detail::DurableIndex durable_;

        detail::Partition shared_;
        detail::FlowDecls flowDecls_;
        /** The shared halves, the same way. Not used to build anything - the
         *  shared bags are built straight from the bundle - but a load report
         *  has to say what the shared side WOULD hold without building a bag,
         *  which is what makes previewLoad pure. */
        detail::FlowDecls sharedDecls_;
        OrderedMap<std::string, FlowPtr> flows_;
        /** The shared spend ledger; see isTaken / markTaken. */
        std::unordered_set<std::string> spent_;
        std::vector<EngineLogEntry> engineLog_;
        int64_t engineSeq_ = 0;
        std::vector<std::string> spentIds() const;
        std::vector<EngineTraceHandler> engineTraceHandlers_;
        detail::TraceIdentities engineTraceIdentities_;
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
        /** The owner segment of a property address, both ways round (4.4). */
        detail::OwnerIndexes owners_;
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
            for (const auto& pair : fd.box) stores_.box.set(pair.first, Engine::bagFromDecls(pair.second, engine_->addressOf("box", pair.first) + "."));
            for (const auto& pair : fd.deck) stores_.deck.set(pair.first, Engine::bagFromDecls(pair.second, engine_->addressOf("deck", pair.first) + "."));
            for (const auto& pair : fd.hand) stores_.hand.set(pair.first, Engine::bagFromDecls(pair.second, engine_->addressOf("hand", pair.first) + "."));
            for (const auto& pair : fd.value) stores_.value.set(pair.first, Engine::bagFromDecls(pair.second, engine_->addressOf("value", pair.first) + "."));
            // Register the bags: each claims whatever the registry holds for its
            // key (a load); openFlow discarded that first for a fresh flow.
            registerBags();
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

        /** @internal - the handle goes inert and the flow's bags leave the
         *  registry, their values with them. It also lets go of its trace
         *  handlers: a closed flow never emits again, and a handler holding the
         *  flow's shared_ptr would otherwise keep it alive for good. */
        void markClosed()
        {
            releaseBags(false);
            closed_ = true;
            // Last, through a local: dropping a handler can drop the last
            // reference to this flow, so nothing touches it afterwards.
            std::vector<TraceHandler> handlers;
            handlers.swap(traceHandlers_);
        }

        /** @internal - take this flow's bags out of the registry; with `keep`,
         *  their values wait there for the flow that replaces this one (a load
         *  into the game's registry, a live swap). Idempotent. */
        void releaseBags(bool keep)
        {
            for (const auto& key : registered_)
            {
                if (engine_->registry_->has(key)) engine_->registry_->remove(key, keep);
            }
            registered_.clear();
        }

        /** @internal - register every bag that declares something under this
         *  flow's keys (`storylets/flow/<id>/...`), each claiming the values the
         *  registry holds for it. A throw takes back what this registered,
         *  keeping its values, and goes on. */
        void registerBags()
        {
            ScopeRegistry& reg = *engine_->registry_;
            std::vector<std::string> registered;
            auto put = [&reg, &registered](const std::string& key, const std::shared_ptr<PropertyBag>& bag)
            {
                if (bag->declarations().empty()) return;   // holds nothing: not registered
                reg.mountOwned(key, bag, std::string(detail::RegistryOwner));
                registered.push_back(key);
            };
            try
            {
                put(detail::FlowKey(id_, "story"), stores_.story);
                for (const char* kind : {"box", "deck", "hand", "value"})
                {
                    for (const auto& pair : detail::KindOf(stores_, kind)) put(detail::FlowKey(id_, kind, pair.first), pair.second);
                }
            }
            catch (...)
            {
                // The clash itself is the kernel's RegistryError, rethrown as StoryletError.
                for (const auto& key : registered) reg.remove(key, /*keep=*/true);
                rethrowKernelError();
            }
            registered_ = std::move(registered);
        }

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
         *  all.
         *
         *  The unsubscribe captures this flow by raw pointer: call it while
         *  the flow object is alive (a FlowPtr held keeps it so, closed or
         *  not), or not at all. It is safe from inside a handler, since
         *  delivery runs over a copy of the handler list. The same `identity`
         *  subscribed twice is registered once (ruling F), as on
         *  Engine::subscribeTrace, which says what an identity is and why. */
        std::function<void()> subscribeTrace(std::function<void(const TraceEvent&)> handler,
            const void* identity = nullptr)
        {
            uint64_t id = detail::RegisteredAs(traceIdentities_, identity);
            if (id == 0)
            {
                id = nextTraceId_++;
                traceHandlers_.push_back({id, std::move(handler)});
                if (identity) traceIdentities_.emplace_back(identity, id);
            }
            return [this, id]()
            {
                detail::ForgetIdentity(traceIdentities_, id);
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
         *  claims respected, nothing registered, no random draw consumed
         *  (ruling A), nothing left behind but the trace line. You can never
         *  play a card you only peeked. At most `n` cards, none when `n` is
         *  below one; every card when it is absent. */
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
            // A peek consumes no draws (ruling A): it ranks with a throwaway
            // copy of this flow's generator, the tie shuffle and any random()
            // in a condition alike, and the real one is put back however the
            // ask ends. So it still answers as a deal would now, and any
            // number of peeks leaves the next deal unchanged.
            RunAskResult run;
            {
                struct RestorePrng
                {
                    Mulberry32& prng;
                    const Mulberry32 saved;
                    ~RestorePrng() { prng = saved; }
                } restore{prng_, prng_};
                run = runAsk(ask, claimed, trace);
            }
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
                // Keyed by GAMEID, as the trace rows are (4.4).
                std::unordered_set<std::string> taken;
                for (const auto& e : listed) taken.insert(EffectiveGameId(*e.card));
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
            std::vector<DealtCard>* cards = result.get(gameId);
            return cards ? std::move(*cards) : std::vector<DealtCard>{};
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
                // ONE context per deck, built for its gate and reused for every
                // card condition in it: box, deck and handEnv do not vary, and a
                // condition is a read-only gate (runAsk does the same). Keyed by
                // deck id, so a seated card whose deck is not in this box finds
                // no gate and is refused as before.
                std::unordered_map<std::string, bool> gateOk;
                std::unordered_map<std::string, EvalContext> deckCtx;
                for (const auto& deck : box.decks)
                {
                    EvalContext& ctx = deckCtx.emplace(deck.id, evalCtx(box, &deck, handEnv)).first->second;
                    gateOk[deck.id] = passes(deck.condition, ctx);
                }
                double boxTurn = turnCounts_.getOr(box.id, 0);
                // Trace events fire after the state they report has landed (a
                // handler reading the board sees the eviction), so they are
                // collected here and emitted once the survivors are set.
                // The card is named by gameId (4.4). A card the build no longer
                // has - the "vanished" branch below - has no gameId left, so it
                // is named by the id the board carries, which is the rule a load
                // report has always used for the same reason.
                std::vector<std::pair<std::string, std::string>> evicted;
                auto evict = [&](const std::string& cardId, const std::string& reason)
                {
                    const CardEntry* known = engine_->cardsById_.get(cardId);
                    evicted.emplace_back(known ? EffectiveGameId(*known->card) : cardId, reason);
                    return false;
                };
                // A COPY: a condition can emit a diagnostic, and a trace handler
                // re-entering the flow can replace this hand's vector, which a
                // pointer into the board would then read freed.
                const std::vector<std::string> contents = boardContents_.getOr(hand.id, {});
                std::vector<std::string> survivors;
                for (const auto& cardId : contents)
                {
                    bool keep = [&]()
                    {
                        if (!conditionOk) return evict(cardId, "hand-condition");
                        const CardEntry* entry = engine_->cardsById_.get(cardId);
                        if (!entry) return evict(cardId, "vanished");   // edited content: dropped
                        // Its deck is in ANOTHER box now (a load, resume or hot swap
                        // into an edited build): gone from this hand's box, as a
                        // deleted card is (ruling D), and asked before the gate,
                        // which has no entry for a deck of another box.
                        if (entry->box->id != box.id) return evict(cardId, "vanished");
                        if (!gateOk[entry->deck->id]) return evict(cardId, VerdictWire(TraceVerdict::DeckGate));
                        // Taken out of the world by somebody's shared one-shot
                        // (ruling C): checked where the fill checks it, after the
                        // gate and before this flow's own clock, so a card one
                        // playthrough holds goes once another has spent it, as a
                        // cooldown would evict it.
                        const bool deckShared = entry->deck->shared.has_value() && *entry->deck->shared;
                        if (cardIsShared(*entry->card, deckShared) && engine_->isTaken(cardId))
                        {
                            return evict(cardId, VerdictWire(TraceVerdict::Taken));
                        }
                        if (cooldowns_.getOr(cardId, 0) > boxTurn) return evict(cardId, VerdictWire(TraceVerdict::Cooldown));
                        if (!tagsMatch(*entry->card, handEnv.boundTags)) return evict(cardId, VerdictWire(TraceVerdict::Tags));
                        // No condition passes outright, so no context and no
                        // label; the label is only read by a diagnostic, which
                        // only fires when something traces.
                        if (entry->card->condition && !passes(entry->card->condition, deckCtx.at(entry->deck->id),
                            tracing() ? "card " + entry->card->gameId + " condition" : std::string()))
                        {
                            return evict(cardId, VerdictWire(TraceVerdict::Condition));
                        }
                        return true;
                    }();
                    if (keep) survivors.push_back(cardId);
                }
                boardContents_.set(hand.id, std::move(survivors));
                if (tracing())
                {
                    for (const auto& e : evicted)
                    {
                        TraceEvent evt;
                        evt.kind = TraceEvent::Kind::Evict;
                        evt.hand = EffectiveGameId(hand);
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
                // Sized through a pointer: a full hand, the common case, copies
                // nothing. The copy below is taken before runAsk, whose
                // diagnostics can re-enter the flow, and is the vector the hand
                // ends up holding.
                const std::vector<std::string>* held = boardContents_.get(hand.id);
                double free = handCapacity(hand) - static_cast<double>(held ? held->size() : 0);
                if (free <= 0) continue;
                std::vector<std::string> contents = held ? *held : std::vector<std::string>();
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
                // `added` is what the BOARD holds (internal ids); `taking` is
                // the same cards as the trace names them (gameIds). The two must
                // move together or every dealt card silently reads as capped.
                std::unordered_set<std::string> taking;
                const size_t kept = contents.size();
                contents.reserve(kept + take);
                for (size_t i = 0; i < take; ++i)
                {
                    contents.push_back(run.ordered[i].card->id);
                    if (trace) taking.insert(EffectiveGameId(*run.ordered[i].card));
                }
                for (size_t i = kept; i < contents.size(); ++i) { ++claimCounts[contents[i]]; ++worldClaims[contents[i]]; }
                boardContents_.set(hand.id, std::move(contents));
                // Emitted after the hand is set: a handler reading board() sees the deal.
                if (trace)
                {
                    capTrace(*trace, taking);
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
                const std::vector<std::string>* ids = boardContents_.get(handInBox.hand->id);
                std::vector<DealtCard> cards;
                if (ids)
                {
                    cards.reserve(ids->size());
                    for (const auto& id : *ids) cards.push_back(view(engine_->cardsById_.at(id)));
                }
                result.set(EffectiveGameId(*handInBox.hand), std::move(cards));
            }
            // Keyed by hand gameId in JS object order (ruling E), not the
            // shuffled order the hands were dealt in.
            return detail::InJsOrder(std::move(result));
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
            return detail::InJsOrder(std::move(result));   // JS object order (ruling E)
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
                v.fields = o.fields;
                views.push_back(std::move(v));
            }
            return views;
        }

        /** Apply an outcome (schema 3.7): the card must sit in a hand on the
         *  board (you never play a card from inside the deck). All or nothing
         *  (ruling B): a gated-shut outcome, a bad or refused write target, or
         *  a write the landing refuses leaves every value as it was, logs no
         *  play, advances no turn and keeps the card in its hand.
         *
         *  A card with NO outcomes is played with none, named as "" (the
         *  no-outcome-play brief, 2026-09-14): a masthead, a notice, a codex
         *  entry, whose play means "shown". It is everything a play is except
         *  the writes: the play log and the history functions count it, the
         *  box's turn moves by the usual rule, the redraw rests it and it
         *  leaves its hand. "" is the one spelling in all four runtimes,
         *  because a Blueprint pin cannot be absent. Only the empty-for-empty
         *  case is new: "" on a card that has outcomes is refused, and a named
         *  outcome on a card with none is refused as before. */
        void play(
            const std::string& cardId,
            const std::string& outcomeGameId,
            const std::string& from,
            const PlayOptions& opts = {})
        {
            assertOpen();
            ResolvedDealt resolved = resolveDealt(cardId, from);
            const CardEntry& entry = resolved.entry;
            const bool bare = outcomeGameId.empty();
            if (bare && !entry.card->outcomes.empty())
            {
                std::string named;
                for (const auto& o : entry.card->outcomes)
                {
                    if (!named.empty()) named += ", ";
                    named += EffectiveGameId(o);
                }
                throw StoryletError("card \"" + EffectiveGameId(*entry.card)
                    + "\" has outcomes (" + named + "); name the one played");
            }
            const Outcome* outcome = nullptr;
            if (!bare)
            {
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
            }

            HandEnv handEnv = buildHandEnv(resolved.ask);
            EvalContext ctx = evalCtx(*entry.box, entry.deck, handEnv);
            if (outcome && !passes(outcome->condition, ctx))
            {
                throw StoryletError("outcome \"" + outcomeGameId + "\" on \""
                    + EffectiveGameId(*entry.card) + "\" is gated shut");
            }

            // The played card's box's clock advances (schema 3.4); computed up
            // front so the play and its writes log as one action, one turn stamp.
            //
            // A TIMED box (design/engine-server.md 4.8) defaults to advancing
            // NOTHING: its clock is time, the host ticks it, and a play is not a
            // tick. A call that names advanceTurns still gets what it asked for,
            // in either kind of box, because the call says otherwise. This is the
            // whole of turn's effect on the engine: the seconds are never read.
            const double perPlay = entry.box->turnSeconds.has_value()
                ? 0.0 : engine_->bundle_->settings.playAdvancesTurns;
            double newTurn = turnCounts_.getOr(entry.box->id, 0)
                + (opts.advanceTurns.has_value() ? *opts.advanceTurns : perPlay);

            // A play is all-or-nothing (ruling B). Every target is resolved and
            // checked first, writing nothing, so any refusal the engine can know
            // in advance comes before a single write lands. Then every
            // right-hand side evaluates against PRE-play state (schema 3.7),
            // then the writes land. A refusal only the landing can meet (another
            // engine's read-only property, a host resolver that throws) puts
            // back, silently, what had already landed. The write events fire
            // once every write is in.
            std::vector<WritePlan> plans;
            std::vector<StoryletValue> values;
            if (outcome)
            {
                plans.reserve(outcome->changes.size());
                values.reserve(outcome->changes.size());
                for (const auto& change : outcome->changes) plans.push_back(planWrite(change.first, entry, handEnv));
                for (const auto& change : outcome->changes) values.push_back(eval(change.second, ctx));
            }
            std::vector<std::optional<StoryletValue>> prevs;
            prevs.reserve(plans.size());
            try
            {
                for (size_t i = 0; i < plans.size(); ++i) prevs.push_back(landWrite(plans[i], values[i]));
            }
            catch (...)
            {
                for (size_t i = prevs.size(); i-- > 0;) undoWrite(plans[i], prevs[i]);
                throw;
            }
            if (tracing())
            {
                for (size_t i = 0; i < plans.size(); ++i)
                {
                    TraceEvent evt;
                    evt.kind = TraceEvent::Kind::Write;
                    evt.target = plans[i].target;
                    evt.path = plans[i].path;
                    evt.value = values[i];
                    evt.prev = prevs[i];
                    emit(std::move(evt), newTurn);
                }
            }

            const std::string outcomeId = outcome ? EffectiveGameId(*outcome) : std::string();
            PlayRecord record;
            record.card = EffectiveGameId(*entry.card);
            record.outcome = outcomeId;
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
            if (std::vector<std::string>* held = boardContents_.get(handId))
            {
                held->erase(std::remove(held->begin(), held->end(), entry.card->id), held->end());
            }
            else
            {
                boardContents_.set(handId, {});
            }
            turnCounts_.set(entry.box->id, newTurn);
            // Emitted last: a handler reading the board and the clock sees the play.
            if (tracing())
            {
                TraceEvent evt;
                evt.kind = TraceEvent::Kind::Play;
                evt.card = EffectiveGameId(*entry.card);
                evt.outcome = outcomeId;
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

        /** One change target, resolved and checked but not yet written: where
         *  the value will land, named for the trace. */
        struct WritePlan
        {
            enum class Kind { World, Bag, Scope };
            Kind kind = Kind::Bag;
            std::string target;
            std::string path;
            std::string scope;
            std::string name;
            PropertyBag* bag = nullptr;
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

        /** The play-history indexes' key for one (box, group, tag) triple.
         *
         *  The BOX is in it because play history is box-specific
         *  (design/project-map-contract.md 3.7, D7, ruled 2026-10-01):
         *  count_played_in asks about the asking box's own plays. A box group
         *  was already box-unique, so its key never needed the box; a
         *  project-map zone is one tag every opted-in box tags its cards with,
         *  and without the box a play of a newspaper at the quay in one box
         *  would count as an encounter at the quay in another.
         *
         *  A unit separator (U+001F) joins them: ids are letters, digits and
         *  underscores, so a control character cannot occur in one and two
         *  triples can never collide into one key. Not NUL, which GDScript
         *  will not carry in a string, and the four runtimes keep one
         *  spelling. */
        static std::string tagKey(const std::string& boxId, const std::string& groupId, const std::string& tagId)
        {
            std::string key = boxId;
            key.push_back('\x1f');
            key.append(groupId);
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
                    // Keyed by the PLAYED card's box: history is box-specific (D7).
                    const std::string key = tagKey(entry->box->id, groupId, tagId);
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
         *  box.
         *
         *  A box on the project map sees ONE namespace: its own groups, then
         *  the map's group (design/project-map-contract.md 3.1). A box that
         *  has not opted in does not see the map's name at all, so a peek
         *  naming it there is the ordinary unknown-group refusal. Own groups
         *  first is stated for determinism only: a bundle that loads never has
         *  the two share a name. */
        const TagGroup* groupInBox(const Box& box, const std::string& reference) const
        {
            const std::vector<const TagGroup*> groups = GroupsOfBox(*engine_->bundle_, box);
            for (const TagGroup* group : groups)
            {
                if (EffectiveGameId(*group) == reference) return group;
            }
            for (const TagGroup* group : groups)
            {
                if (group->id == reference) return group;
            }
            return nullptr;
        }

        /** A group NAME and tag name resolved in THIS box, as the index's key,
         *  with this box in it: a zone's plays in another box are not this
         *  box's history (D7). False when either is unknown here, which is the
         *  old per-record `false` and reads as "never". Resolved once per call,
         *  where inTag used to resolve it again for every record in the log. */
        bool keyOf(const Box& box, const std::string& group, const std::string& tag,
            std::string& outKey) const
        {
            // Memoised: the answer is the bundle's, which never changes under a
            // flow, and the lookup behind it (every group the box sees, then
            // every tag in the one found) ran once per candidate card per ask.
            // A miss is remembered as "", which no resolved key can be (it
            // always holds two separators).
            const std::string asked = tagKey(box.id, group, tag);
            auto memo = tagKeyMemo_.find(asked);
            if (memo == tagKeyMemo_.end())
            {
                std::string resolved;
                if (const TagGroup* found = groupInBox(box, group))
                {
                    for (const auto& candidate : found->tags)
                    {
                        if (candidate.gameId == tag)
                        {
                            resolved = tagKey(box.id, found->id, candidate.id);
                            break;
                        }
                    }
                }
                memo = tagKeyMemo_.emplace(asked, std::move(resolved)).first;
            }
            if (memo->second.empty()) return false;
            outKey = memo->second;
            return true;
        }

        /** One host per box: the play-history functions take a BARE group name
         *  with no box, so they resolve it in the box whose ask is being
         *  evaluated, and they count only that box's own plays (the box is in
         *  the index key). That was automatic while every group was a box's; a
         *  project-map zone is shared, and its history is still not
         *  (design/project-map-contract.md 3.7, D7). */
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
            const Engine::RegistryView& others = engine_->registryView();
            EvalContext ctx;
            if (engine_->hasQualities_ || others.qualities)
            {
                // The quality channel, answering for THIS ask's box and deck.
                // Only wired when a quality exists, so a bundle without one
                // evaluates byte-identically to before the feature; another
                // engine's ladders answer for its own scopes.
                const std::string boxId = box.id;
                const std::string deckId = deck ? deck->id : std::string();
                const HandEnv* env = &handEnv;
                auto otherLadders = others.qualities;
                ctx.qualities = [this, boxId, deckId, env, otherLadders](const std::string& scope, const std::string& name) -> const std::vector<std::string>*
                {
                    auto find = [&name](const std::unordered_map<std::string, std::vector<std::string>>& m) -> const std::vector<std::string>*
                    {
                        auto it = m.find(name);
                        return it == m.end() ? nullptr : &it->second;
                    };
                    if (scope == "world")
                    {
                        const std::vector<std::string>* own = find(engine_->worldLadders_);
                        return own || !otherLadders ? own : otherLadders(scope, name);
                    }
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
                    return otherLadders ? otherLadders(scope, name) : nullptr;
                };
            }
            const StoryletsHost* host = hostsByBox_.get(box.id);
            if (!host) throw StoryletError("unknown box \"" + box.id + "\"");
            ctx.host = host;
            // Every other engine's game-wide scope first (every engine reads every
            // scope); this engine's own tokens are its merged views, over the top.
            ctx.scopes = others.scopes;
            ctx.scopes["world"] = std::make_shared<WorldScope>(engine_);
            ctx.scopes["story"] = std::make_shared<PairScope>(stores_.story.get(), engine_->shared_.story.get());
            ctx.scopes["box"] = std::make_shared<PairScope>(bagOf(stores_.box, box.id), bagOf(engine_->shared_.box, box.id));
            ctx.scopes["deck"] = deck
                ? std::static_pointer_cast<IScopeSource>(std::make_shared<PairScope>(bagOf(stores_.deck, deck->id), bagOf(engine_->shared_.deck, deck->id)))
                : std::static_pointer_cast<IScopeSource>(std::make_shared<BagScope>(emptyBag()));
            ctx.scopes["hand"] = std::make_shared<BagScope>(handEnv.bag);
            return ctx;
        }

        /** A refusal from the evaluator is the kernel's ExprError, rethrown as EvalError. */
        StoryletValue eval(const ExpressionPtr& expr, EvalContext& ctx) const
        {
            return kernelCall([&] { return Evaluate(expr->ast, ctx, StoryletsDialect()); });
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
                bindNamed(hand, hand.chosen, ask);
                ask.condition = t.condition;
            }
            else if (hand.rule)
            {
                bindNamed(hand, hand.rule->bindings, ask);
                ask.condition = hand.rule->condition;
            }
            ask.boundTags.set(PLACE_GROUP, hand.id);
            bindStateGroups(box, ask);
            return ask;
        }

        /** A template hand's chosen tags and a rule hand's bindings, the one
         *  loop: each binds its group and names it in @hand, so a card reading
         *  @hand.<group> does not care HOW it was bound, and a hole filled
         *  from a property rather than with a tag is resolved now, before tag
         *  composition (4.6). */
        void bindNamed(const Hand& hand, const OrderedMap<std::string, std::string>& bindings, AskDescriptor& ask) const
        {
            for (const auto& pair : bindings)
            {
                if (IsHoleRef(pair.second))
                {
                    fillHoleFromProperty(hand, pair.first, pair.second, ask);
                    continue;
                }
                ask.boundTags.set(pair.first, pair.second);
                const GroupInBox* group = engine_->groupsById_.get(pair.first);
                const Tag* tag = group ? tagById(*group->group, pair.second) : nullptr;
                if (group && tag)
                {
                    ask.askNames.set(EffectiveGameId(*group->group), EffectiveGameId(*tag));
                }
            }
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

        /** Fill one hole from the property its value names: the hand that moves
         *  (design/engine-server.md 4.6).
         *
         *  The semantics are bindStateGroups' below, word for word, applied per
         *  HOLE instead of per group: resolved at ask time, and a value naming
         *  no tag leaves the hole UNBOUND (a wildcard) with a diagnostic rather
         *  than dealing a silently empty hand. What is added is the @hand
         *  scope - the asking hand's OWN declared state, read from the flow's
         *  merged view, so a shared declaration moves the hole for every flow
         *  and a per-flow one moves it for this flow alone.
         *
         *  Read BEFORE tag composition, which is what makes it safe: the @hand
         *  bag a card sees is built from the bound tags, so resolving a hole
         *  from it would be circular. A hand's own declarations are not. */
        void fillHoleFromProperty(const Hand& hand, const std::string& groupId,
                                  const std::string& ref, AskDescriptor& ask) const
        {
            const GroupInBox* found = engine_->groupsById_.get(groupId);
            const std::string groupName = found ? EffectiveGameId(*found->group) : groupId;
            const std::string where = "hand " + EffectiveGameId(hand) + ", tag group " + groupName;
            std::string scope, name;
            if (!ParseHoleRef(ref, scope, name))
            {
                diagnose(where, "\"" + ref + "\" is not a @hand, @world or @story property reference");
                return;
            }
            if (!found)
            {
                diagnose(where, "\"" + ref + "\" fills a tag group that is not in this box");
                return;
            }
            std::optional<StoryletValue> value;
            if (scope == "hand")
            {
                // The merged view: the flow's own bag first, the shared bag
                // behind it. Names are disjoint, so "first" is routing.
                const PropertyBag* own = bagOf(stores_.hand, hand.id);
                const PropertyBag* shared = bagOf(engine_->shared_.hand, hand.id);
                if (own) value = own->get(name);
                if (!value.has_value() && shared) value = shared->get(name);
            }
            else
            {
                // ANY failure reads as undeclared, as JS's bare catch does: a
                // host @world resolver that throws is the game's error, and it
                // must surface as this diagnostic rather than escape the deal.
                try { value = getProperty(scope + "." + name); }
                catch (...) { value.reset(); }
            }
            if (!value.has_value())
            {
                diagnose(where, "\"" + ref + "\" names a property that is not declared");
                return;
            }
            std::string wanted;
            const Tag* tag = tagForValue(*found->group, *value, wanted);
            if (!tag)
            {
                diagnose(where, ref + " is \"" + wanted + "\", which is not one of the tags of \"" + groupName + "\"");
                return;
            }
            ask.boundTags.set(groupId, tag->id);
            ask.askNames.set(groupName, EffectiveGameId(*tag));
        }

        /** Bind every state-bound group in the box from the property it names.
         *  Runs after the hand's own bindings and never overwrites one: an
         *  explicit binding beats a default. A value naming no tag leaves the
         *  group UNBOUND (a wildcard) with a diagnostic, because a silently
         *  empty hand reads as content that does not exist. */
        void bindStateGroups(const Box& box, AskDescriptor& ask) const
        {
            // The box's own groups and, when it is on the project map, the
            // map's group: a boundBy there binds in every opted-in box (3.2).
            for (const TagGroup* groupPtr : GroupsOfBox(*engine_->bundle_, box))
            {
                const TagGroup& group = *groupPtr;
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
                // ANY failure, a throwing host @world resolver included, as
                // JS's bare catch: see fillHoleFromProperty.
                try { value = getProperty(scope + "." + name); }
                catch (...)
                {
                    diagnose("tag group " + EffectiveGameId(group),
                        "boundBy \"" + ref + "\" names a property that is not declared");
                    continue;
                }
                std::string wanted;
                const Tag* tag = tagForValue(group, value, wanted);
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

        /** The tag a property value names in a group, by gameId, for a filled
         *  hole and a boundBy alike; null when it names none. `outWanted` is the
         *  value as text, which the diagnostic for a miss quotes: JS String(),
         *  so 2 is "2" and ["act1"] is "act1", never JSON's quoted forms. */
        static const Tag* tagForValue(const TagGroup& group, const StoryletValue& value, std::string& outWanted)
        {
            outWanted = value.toDisplayString();
            for (const auto& t : group.tags)
            {
                if (EffectiveGameId(t) == outWanted) return &t;
            }
            return nullptr;
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
            // Identity on the trace is by gameId (4.4), so the helper takes the
            // CARD rather than an id: every call site had one in hand, and
            // taking the id was the whole of how the two vocabularies got mixed.
            auto verdict = [trace](const Card& card, TraceVerdict v)
            {
                if (trace)
                {
                    TraceCard tc;
                    tc.id = EffectiveGameId(card);
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
            // ONE context per deck, not per card, and the gate's own context is
            // the cards' too: box, deck and handEnv do not vary across either,
            // and a condition is a read-only gate (schema 3.1). Reference:
            // engine.ts runAsk, and storylets-new/design/port-review-2026-08.md.
            const size_t deckCount = box.decks.size();
            std::vector<EvalContext> deckCtxs;
            std::vector<char> gateOk;
            deckCtxs.reserve(deckCount);
            gateOk.reserve(deckCount);
            size_t cardCount = 0;
            for (const auto& deck : box.decks)
            {
                deckCtxs.push_back(evalCtx(box, &deck, handEnv));
                gateOk.push_back(passes(deck.condition, deckCtxs.back(), "deck " + deck.gameId + " gate") ? 1 : 0);
                cardCount += deck.cards.size();
            }

            double boxTurn = turnCounts_.getOr(box.id, 0);
            std::vector<Scored> scored;
            scored.reserve(cardCount);
            if (trace) trace->reserve(trace->size() + cardCount);
            for (size_t d = 0; d < deckCount; ++d)
            {
                const Deck& deck = box.decks[d];
                EvalContext& deckCtx = deckCtxs[d];
                const bool deckShared = deck.shared.has_value() ? *deck.shared : false;
                for (const auto& card : deck.cards)
                {
                    const bool shared = cardIsShared(card, deckShared);
                    if (!gateOk[d])
                    {
                        verdict(card, TraceVerdict::DeckGate);
                        continue;
                    }
                    // Taken out of the world by somebody's shared one-shot.
                    // Checked before this flow's own clock, because "cooldown"
                    // would point the reader at a turn counter that has nothing
                    // to do with it.
                    if (shared && engine_->isTaken(card.id))
                    {
                        verdict(card, TraceVerdict::Taken);
                        continue;
                    }
                    if (cooldowns_.getOr(card.id, 0) > boxTurn)
                    {
                        verdict(card, TraceVerdict::Cooldown);
                        continue;
                    }
                    if (!tagsMatch(card, handEnv.boundTags))
                    {
                        verdict(card, TraceVerdict::Tags);
                        continue;
                    }
                    EvalContext& ctx = deckCtx;
                    // The label is only read when an eval THROWS and only when
                    // tracing, and each build here was a std::string concatenation
                    // per card - a heap allocation on the path that matters.
                    if (card.condition && !passes(card.condition, ctx,
                        tracing() ? "card " + card.gameId + " condition" : std::string()))
                    {
                        verdict(card, TraceVerdict::Condition);
                        continue;
                    }
                    std::optional<TraceVerdict> refused = claimed(card, shared);   // claims, last (3.1 step 6)
                    if (refused.has_value())
                    {
                        verdict(card, *refused);
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
                            // NaN (overflow, Inf - Inf, a host value) ranks
                            // nowhere: refused as a non-number is (ruling G),
                            // with no diagnostic, since nothing threw.
                            if (!v.isNumber() || std::isnan(v.asNumber()))
                            {
                                verdict(card, TraceVerdict::Priority);
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
                            verdict(card, TraceVerdict::Priority);
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
                    tc.id = EffectiveGameId(*s.entry.card);
                    tc.verdict = TraceVerdict::Dealt;
                    tc.priority = s.priority;
                    tc.specificity = s.spec;
                    trace->push_back(std::move(tc));
                }
            }
            result.ordered.reserve(scored.size());
            for (const auto& s : scored) result.ordered.push_back(s.entry);
            return result;
        }

        /** Flip eligible-but-not-taken trace entries to "capped". `taken` is
         *  keyed by GAMEID, as the trace rows are (4.4): the two must move
         *  together or every dealt card silently reads as capped. */
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
            const std::vector<std::string>* contents = boardContents_.get(found.hand->id);
            if (!contents || std::find(contents->begin(), contents->end(), entry->card->id) == contents->end())
            {
                throw StoryletError("card \"" + EffectiveGameId(*entry->card)
                    + "\" is not dealt to hand \"" + EffectiveGameId(*found.hand) + "\"");
            }
            ResolvedDealt resolved;
            resolved.entry = *entry;
            resolved.ask = askForHand(*found.hand, *found.box);
            return resolved;
        }

        /** One owned property's address, owner segment and all (4.4). */
        std::string address(const std::string& kind, const std::string& id) const
        {
            return engine_->addressOf(kind, id);
        }

        /** The internal id an owned-scope address names, diagnosing the pre-4.4
         *  internal-id form on the way past (4.4). Throws for an owner segment
         *  that names nothing at all, and for a short-form value segment that
         *  names a tag in more than one box. */
        std::string ownerId(const std::string& kind, const std::string& segment,
            const std::string& name) const
        {
            bool legacy = false;
            const std::string id = engine_->ownerOrThrow(kind, segment, name, legacy);
            if (legacy) diagnose("property address", engine_->legacyAddressMessage(kind, segment, name));
            return id;
        }

        /** Find the bag that declares one change's name: the flow's bag when
         *  the property is per-flow, the shared bag when it is shared. Writes
         *  nothing; throws when no bag declares the name or its declaration is
         *  `writable: false`, the kernel's refusal asked BEFORE any write lands
         *  rather than met half way through a play (ruling B). */
        WritePlan planBag(const std::string& target, const std::string& kind, const std::string& ownerId,
            const std::string& name, const std::string& path)
        {
            PropertyBag* own = kind == "story" ? stores_.story.get()
                : const_cast<PropertyBag*>(bagOf(detail::KindOf(stores_, kind), ownerId));
            PropertyBag* shared = kind == "story" ? engine_->shared_.story.get()
                : const_cast<PropertyBag*>(bagOf(detail::KindOf(engine_->shared_, kind), ownerId));
            PropertyBag* bag = own && own->get(name).has_value() ? own
                : shared && shared->get(name).has_value() ? shared
                : nullptr;
            if (!bag) throw StoryletError("no property at \"" + path + "\"");
            for (const auto& d : bag->declarations())
            {
                if (d.name == name && d.writable.has_value() && !*d.writable)
                {
                    throw StoryletError("'" + name + "' is read-only");
                }
            }
            WritePlan plan;
            plan.kind = WritePlan::Kind::Bag;
            plan.target = target;
            plan.path = path;
            plan.name = name;
            plan.bag = bag;
            return plan;
        }

        /** Resolve and check one change target, writing nothing: every refusal
         *  a write can meet that the engine can know in advance is met HERE, so
         *  a play checks all its targets before any write lands (ruling B). */
        WritePlan planWrite(const std::string& target, const CardEntry& entry, const HandEnv& handEnv)
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
                if (engine_->worldReadOnly(name))
                {
                    throw StoryletError("'@world." + name + "' is read-only (writable: false)");
                }
                WritePlan plan;
                plan.kind = WritePlan::Kind::World;
                plan.target = target;
                plan.path = "world." + name;
                plan.name = name;
                return plan;
            }
            if (scope == "story") return planBag(target, "story", std::string(), name, "story." + name);
            if (scope == "box") return planBag(target, "box", entry.box->id, name, address("box", entry.box->id) + "." + name);
            if (scope == "deck") return planBag(target, "deck", entry.deck->id, name, address("deck", entry.deck->id) + "." + name);
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
                return planBag(target, kindName, source->second.id, name,
                    address(kindName, source->second.id) + "." + name);
            }
            // Another engine's game-wide scope (`@patter.x`): the family's shared
            // vocabulary lets a card write it, and the registry keeps that
            // engine's rules, met as the write lands (a read-only property is
            // refused there, the kernel's RegistryError rethrown as
            // StoryletError, and the play puts back what had landed).
            if (engine_->registry_->has(scope))
            {
                WritePlan plan;
                plan.kind = WritePlan::Kind::Scope;
                plan.target = target;
                plan.path = scope + "." + name;
                plan.scope = scope;
                plan.name = name;
                return plan;
            }
            const std::vector<std::string>& external = engine_->bundle_->externalScopes;
            if (std::find(external.begin(), external.end(), scope) != external.end())
            {
                throw StoryletError("@" + scope + "." + name + " cannot be written: no engine on this registry registered @" + scope);
            }
            throw StoryletError("bad change target scope \"@" + scope + "\"");
        }

        /** Land one planned write; returns the value it replaced (for the
         *  log's "0 -> 1" reading, and for putting it back). An engine write:
         *  the bag's subscribers fire (the firing rule), and a refusal is the
         *  kernel's RegistryError, rethrown as StoryletError. */
        std::optional<StoryletValue> landWrite(const WritePlan& plan, const StoryletValue& value)
        {
            switch (plan.kind)
            {
                case WritePlan::Kind::World:
                {
                    std::optional<StoryletValue> prev = engine_->worldGet(plan.name);
                    engine_->worldSet(plan.name, value);
                    return prev;
                }
                case WritePlan::Kind::Bag:
                    return kernelCall([&] { return plan.bag->set(plan.name, value); }).prev;
                default:
                {
                    ScopeRegistry& reg = *engine_->registry_;
                    std::optional<StoryletValue> prev = reg.get(plan.scope, plan.name);
                    kernelCall([&] { reg.set(plan.scope, plan.name, value); });
                    return prev;
                }
            }
        }

        /** Put back one landed write after a later one was refused: as the
         *  host, silently, so the play leaves no trace. Nothing to put back
         *  where there was no value before. */
        void undoWrite(const WritePlan& plan, const std::optional<StoryletValue>& prev)
        {
            if (!prev.has_value()) return;
            switch (plan.kind)
            {
                case WritePlan::Kind::World:
                    engine_->worldSet(plan.name, *prev, /*host=*/true);
                    return;
                case WritePlan::Kind::Bag:
                    plan.bag->set(plan.name, *prev, /*silent=*/true, "play refused", /*host=*/true);
                    return;
                default:
                    kernelCall([&] { engine_->registry_->set(plan.scope, plan.name, *prev, /*host=*/true); });
                    return;
            }
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
        /** keyOf's answers: (box id, group name, tag name) -> the index key, or
         *  "" for a pair this box does not know. Derived from the bundle alone. */
        mutable std::unordered_map<std::string, std::string> tagKeyMemo_;

        /** The per-flow property partitions (the not-shared halves), each bag
         *  that declares something registered under this flow's keys. */
        detail::Partition stores_;
        std::vector<std::string> registered_;

        std::vector<TraceHandler> traceHandlers_;
        detail::TraceIdentities traceIdentities_;
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
            for (const auto& pair : stores_.box) mounts.push_back({address("box", pair.first), pair.second});
            for (const auto& pair : stores_.deck) mounts.push_back({address("deck", pair.first), pair.second});
            for (const auto& pair : stores_.hand) mounts.push_back({address("hand", pair.first), pair.second});
            for (const auto& pair : stores_.value) mounts.push_back({address("value", pair.first), pair.second});
            return mounts;
        }

        /** The flow's FULL merged view as examiner rows: @world read through
         *  the engine's resolver, then per scope the shared values and this
         *  flow's own. Bundle order. */
        std::vector<PropertyRow> listProperties() const
        {
            assertOpen();
            std::vector<PropertyRow> rows;
            engine_->addWorldRows(rows);
            // No path prefix passed in: the bag composes the address from its
            // own pathPrefix, so the row arrives complete - which is also why
            // the field-by-field copy this used to do is gone, including the
            // `r.stages = row.stages;` that appeared twice in it.
            auto add = [&rows](const PropertyBag* bag)
            {
                if (!bag) return;
                for (const auto& row : bag->rows()) rows.push_back(row);
            };
            add(engine_->shared_.story.get());
            add(stores_.story.get());
            auto addKind = [&](
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
                    add(bagOf(shared, id));
                    add(bagOf(own, id));
                }
            };
            addKind(engine_->shared_.box, stores_.box);
            addKind(engine_->shared_.deck, stores_.deck);
            addKind(engine_->shared_.hand, stores_.hand);
            addKind(engine_->shared_.value, stores_.value);
            return rows;
        }

        /** Read by path: "world.x", "story.gold", "value.docks.danger",
         *  "box.village.heat", "deck.wares.n", "hand.the-elder.zone" - the
         *  flow's merged view, routed by the declaration's sharing.
         *
         *  The owner segment is the entity's GAMEID, the name it is called by
         *  everywhere else (4.4). Its internal id is accepted for this release
         *  and earns a diagnostic naming the address to move to; the next
         *  lockstep release refuses it. */
        StoryletValue getProperty(const std::string& path) const
        {
            assertOpen();
            std::vector<std::string> parts = splitPath(path);
            std::optional<StoryletValue> value;
            if (parts.size() == 2 && parts[0] == "world")
            {
                value = engine_->worldGet(parts[1]);
            }
            else if (parts.size() == 2 && parts[0] != "story" && engine_->registry_->has(parts[0]))
            {
                // Another engine's game-wide scope (`patter.gold`): every engine
                // reads every scope.
                value = engine_->registry_->get(parts[0], parts[1]);
            }
            else if (parts.size() == 2 && parts[0] == "story")
            {
                value = stores_.story->get(parts[1]);
                if (!value.has_value()) value = engine_->shared_.story->get(parts[1]);
            }
            else if (parts.size() == 3 && detail::IsOwnedScope(parts[0]))
            {
                const std::string id = ownerId(parts[0], parts[1], parts[2]);
                const PropertyBag* own = bagOf(detail::KindOf(stores_, parts[0]), id);
                const PropertyBag* shared = bagOf(detail::KindOf(engine_->shared_, parts[0]), id);
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
                engine_->worldSet(parts[1], value, /*host=*/true);
                return;
            }
            if (parts.size() == 2 && parts[0] != "story" && engine_->registry_->has(parts[0]))
            {
                // Another engine's game-wide scope, written as the host. A refusal (a scope
                // lent with no setter) is the kernel's RegistryError, rethrown as StoryletError.
                kernelCall([&] { engine_->registry_->set(parts[0], parts[1], value, /*host=*/true); });
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
            else if (parts.size() == 3 && detail::IsOwnedScope(parts[0]))
            {
                const std::string id = ownerId(parts[0], parts[1], parts[2]);
                own = const_cast<PropertyBag*>(bagOf(detail::KindOf(stores_, parts[0]), id));
                shared = const_cast<PropertyBag*>(bagOf(detail::KindOf(engine_->shared_, parts[0]), id));
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
            // A HOST write: silent under the firing rule (no subscriber feedback
            // loop), visible to the audit hook, and flagged host so a
            // `writable: false` does not refuse the game its own value.
            bag->set(name, value, /*silent=*/true, "host setProperty", /*host=*/true);
        }

        // --- persistence (schema 4) ------------------------------------------------

        /** This flow's DURABLE HALF, the player's pocket (ruling H): every
         *  per-flow `durable` property's value by its address, and every
         *  per-flow durable one-shot this flow has spent, by card gameId. A
         *  later run opens the player's flow with it, through openFlow's
         *  `durable`; the shared half is Engine::saveDurable. A copy:
         *  StoryletValue is a value type. */
        DurableSave saveDurable() const
        {
            assertOpen();
            DurableSave pocket;
            pocket.content = engine_->bundle_->content;
            pocket.values = detail::DurableValues(stores_, engine_->durable_.flow);
            for (const CardEntry& entry : engine_->durable_.flowCards)
            {
                const double* cooldown = cooldowns_.get(entry.card->id);
                if (cooldown && *cooldown == MAX_SAFE_INTEGER) pocket.spent.push_back(EffectiveGameId(*entry.card));
            }
            std::sort(pocket.spent.begin(), pocket.spent.end());
            return pocket;
        }

    private:
        /** Internal: write a planned pocket into this freshly opened flow
         *  (openFlow's `durable`, which has already checked and planned it). Its
         *  bags hold their defaults, so only what the plan carries is written. */
        void writeDurable(const detail::DurablePlan& plan)
        {
            const std::vector<detail::DurableProp>& props = engine_->durable_.flow;
            for (const auto& pair : plan.values)
            {
                const detail::DurableProp& prop = props[pair.first];
                detail::PutDurable(detail::DurableBag(stores_, prop), prop.decl.name, pair.second);
            }
            for (const std::string& cardId : plan.cards) cooldowns_.set(cardId, MAX_SAFE_INTEGER);
        }

        /** Internal: this flow's blob, inside the engine's envelope without its
         *  properties (the registry has them), or parked whole by saveFlow
         *  (StoryletValue is a value type, so a container-deep copy is the TS
         *  structuredClone). Engine-side plumbing; a host parks a flow with
         *  Engine::saveFlow. */
        FlowSave snapshot(bool withProps) const
        {
            FlowSave save;
            save.prng = prng_.state();
            if (withProps)
            {
                PropsPartition props;
                props.story = stores_.story->save();
                for (const auto& pair : stores_.box) props.box.set(pair.first, pair.second->save());
                for (const auto& pair : stores_.deck) props.deck.set(pair.first, pair.second->save());
                for (const auto& pair : stores_.hand) props.hand.set(pair.first, pair.second->save());
                for (const auto& pair : stores_.value) props.value.set(pair.first, pair.second->save());
                save.props = std::move(props);
            }
            for (const auto& pair : turnCounts_) save.turns.set(pair.first, pair.second);
            for (const auto& pair : cooldowns_) save.cooldowns.set(pair.first, pair.second);
            for (const auto& pair : boardContents_) save.board.set(pair.first, pair.second);
            save.playLog = playLog_;
            return save;
        }

        /** Internal: restore a freshly opened flow from its blob (loadGame, and
         *  openFlow's `restore`, both of which clean the blob first). Orphaned
         *  keys (deleted entities) drop; new declarations keep defaults.
         *  Engine-side plumbing that skips the checks a restore through openFlow
         *  makes, which is why a host resumes a flow through openFlow and never
         *  through this. */
        void restore(const FlowSave& saved)
        {
            if (saved.props.has_value())
            {
                stores_.story->load(saved.props->story);
                loadKind(stores_.box, saved.props->box);
                loadKind(stores_.deck, saved.props->deck);
                loadKind(stores_.hand, saved.props->hand);
                loadKind(stores_.value, saved.props->value);
            }
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
        : bundle_(std::move(bundle)), creationOptions_(opts), seed_(opts.seed), onReplacedFlow_(opts.onReplacedFlow)
    {
        // First, before anything is indexed or registered: a bundle this engine
        // cannot read faithfully is refused whole (design/project-map-contract.md
        // 3.8), and a refusal must leave the game's registry untouched.
        if (!bundle_) throw StoryletError("the engine needs a bundle");
        detail::RefuseUnreadableBundle(*bundle_);
        if (opts.log) logCap_ = opts.logCap;
        if (opts.world.has_value()) hostWorld_ = opts.world;
        registry_ = opts.registry ? opts.registry : std::make_shared<ScopeRegistry>();
        ownsRegistry_ = !opts.registry;
        // The value scope's segments come off the whole bundle at once (a tag
        // gameId is only unique within its group), so they are built before the
        // walk rather than tag by tag inside it.
        detail::IndexValueOwners(owners_.value, *bundle_);
        for (const auto& box : bundle_->boxes)
        {
            boxesById_.set(box.id, &box);
            boxesByGameId_.set(EffectiveGameId(box), &box);
            detail::IndexOwner(owners_.box, box);
            for (const auto& group : box.tagGroups)
            {
                groupsById_.set(group.id, detail::GroupInBox{&group, &box});
                if (group.required) requiredGroups_.insert(group.id);
            }
            for (const auto& deck : box.decks)
            {
                detail::IndexOwner(owners_.deck, deck);
                // TRUE, not merely present: a deck that says `shared: false`
                // shares nothing, and must not cost every deal the ledger walks.
                if (deck.shared.has_value() && *deck.shared) hasShared_ = true;
                for (const auto& card : deck.cards)
                {
                    detail::CardEntry entry{&card, &deck, &box};
                    cardsById_.set(card.id, entry);
                    cardsByGameId_.set(EffectiveGameId(card), entry);
                    if (card.shared.has_value() && *card.shared) hasShared_ = true;
                    if (detail::CardIsDurable(card, deck))
                    {
                        const bool shared = Flow::cardIsShared(card, deck.shared.has_value() && *deck.shared);
                        (shared ? durable_.sharedCards : durable_.flowCards).push_back(entry);
                    }
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
                detail::IndexOwner(owners_.hand, hand);
            }
        }
        // The project map's group: by id like any group, so a hand's binding, a
        // filled hole and tag matching need no logic of their own for it. Which
        // boxes may NAME it is groupInBox's business (3.1); which may reference
        // it at all was settled by the refusal above.
        if (bundle_->map.has_value())
        {
            const TagGroup& group = bundle_->map->group;
            groupsById_.set(group.id, detail::GroupInBox{&group, nullptr});
            if (group.required) requiredGroups_.insert(group.id);
        }
        initLadders();
        // Both halves, precomputed once (a bundle never changes): each openFlow
        // builds its bags from the per-flow half, and a load report asks either
        // half what it declares without building anything at all.
        flowDecls_.story = half("story", bundle_->story.properties, false);
        sharedDecls_.story = half("story", bundle_->story.properties, true);
        for (const auto& box : bundle_->boxes)
        {
            flowDecls_.box.set(box.id, half("box", box.properties, false));
            sharedDecls_.box.set(box.id, half("box", box.properties, true));
            for (const auto& deck : box.decks)
            {
                flowDecls_.deck.set(deck.id, half("deck", deck.properties, false));
                sharedDecls_.deck.set(deck.id, half("deck", deck.properties, true));
            }
            for (const auto& hand : box.hands)
            {
                flowDecls_.hand.set(hand.id, half("hand", handDecls(hand), false));
                sharedDecls_.hand.set(hand.id, half("hand", handDecls(hand), true));
            }
            for (const auto& group : box.tagGroups)
            {
                for (const auto& tag : group.tags)
                {
                    flowDecls_.value.set(tag.id, half("value", tag.properties, false));
                    sharedDecls_.value.set(tag.id, half("value", tag.properties, true));
                }
            }
        }
        // The zones, once, after every box: the order the bags are built in.
        if (bundle_->map.has_value())
        {
            for (const auto& tag : bundle_->map->group.tags)
            {
                flowDecls_.value.set(tag.id, half("value", tag.properties, false));
                sharedDecls_.value.set(tag.id, half("value", tag.properties, true));
            }
        }
        durable_.shared = durableProps(sharedDecls_);
        durable_.flow = durableProps(flowDecls_);
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
        // The zones, once, keyed by tag id like every other tag (3.3).
        if (bundle_->map.has_value())
        {
            for (const auto& tag : bundle_->map->group.tags) grab(tag.properties, valueLadders_[tag.id]);
        }
    }

    inline Engine::~Engine()
    {
        // An engine goes away: its bags go with it, so the game's registry never
        // holds a scope nobody answers for, and a flow handle still held reads
        // as closed rather than reaching into a dead engine.
        for (const auto& pair : flows_) pair.second->markClosed();
        flows_.clear();
        for (const auto& key : registered_)
        {
            if (registry_->has(key)) registry_->remove(key);
        }
        registered_.clear();
    }

    inline FlowPtr Engine::openFlow(const std::string& id, const OpenFlowOptions& opts)
    {
        return open(id, opts, false);
    }

    inline FlowPtr Engine::open(const std::string& id, const OpenFlowOptions& opts, bool claim)
    {
        if (opts.durable.has_value() && opts.restore.has_value())
        {
            throw StoryletError("openFlow \"" + id
                + "\": restore and durable cannot be given together; a restore already carries the flow's durable state");
        }
        // A pocket is checked and planned before the name is touched: a
        // refusal, and anything the plan finds, must leave the flow already
        // open as it was.
        std::optional<detail::DurablePlan> pocket;
        detail::ReportDraft pocketDraft;
        if (opts.durable.has_value())
        {
            assertDurable(*opts.durable);
            pocket = planDurable(durable_.flow, durable_.flowCards, *opts.durable, id, pocketDraft);
        }
        assertExternalScopes();
        // The world's claims as they stand WITHOUT this name, taken before the
        // replace: a resume competes with the other flows, never with the flow
        // it is replacing (which is about to release everything it holds).
        std::unordered_map<std::string, int> otherClaims;
        if (opts.restore.has_value()) otherClaims = sharedClaimsExcept(id);
        const FlowPtr* existing = flows_.get(id);
        if (existing)
        {
            // Say so BEFORE the old flow goes inert, while its board is readable.
            const int dealt = static_cast<int>((*existing)->heldCardIds().size());
            if (dealt > 0 && onReplacedFlow_) onReplacedFlow_(id, dealt);
            (*existing)->markClosed();
        }
        // A fresh open is a reset of that name: values a load left waiting for
        // it are not this flow's.
        if (!claim) registry_->discardParked(detail::FlowPrefix(id));
        FlowPtr flow = std::make_shared<Flow>(this, id, opts.seed.has_value() ? *opts.seed : seed_);
        flows_.set(id, flow);
        if (opts.restore.has_value())
        {
            detail::ReportDraft draft;
            const FlowSave clean = planFlowRestore(id, *opts.restore, &otherClaims, draft);
            flow->restore(clean);
            if (opts.onRestoreReport)
            {
                opts.onRestoreReport(detail::FinishReport(bundle_->content, bundle_->content, {id}, draft));
            }
        }
        if (pocket.has_value())
        {
            flow->writeDurable(*pocket);
            if (opts.onRestoreReport)
            {
                opts.onRestoreReport(detail::FinishReport(bundle_->content, opts.durable->content, {id}, pocketDraft));
            }
        }
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
        dropRun(nullptr);
        reseedShared();
        // Values loaded for bags nobody has claimed yet are the old run's too: a
        // flow opened after the reset must not pick them up. Other engines' stay.
        registry_->discardParked(std::string("storylets/"));
    }

    inline void Engine::dropRun(const std::unordered_set<std::string>* keepFlows)
    {
        // The log is a run-lifetime utility and is not saved; a reset is a new run.
        engineLog_.clear();
        for (const auto& pair : flows_)
        {
            pair.second->releaseBags(keepFlows != nullptr && keepFlows->count(pair.first) > 0);
            pair.second->markClosed();
        }
        flows_.clear();
        spent_.clear();
    }

    inline std::vector<std::string> Engine::spentIds() const
    {
        std::vector<std::string> ids(spent_.begin(), spent_.end());
        std::sort(ids.begin(), ids.end());
        return ids;
    }

    inline std::unordered_map<std::string, int> Engine::sharedClaims() const
    {
        return claimsHeld(nullptr);
    }

    inline std::unordered_map<std::string, int> Engine::sharedClaimsExcept(const std::string& id) const
    {
        return claimsHeld(&id);
    }

    inline std::unordered_map<std::string, int> Engine::claimsHeld(const std::string* except) const
    {
        // Read straight off each board rather than through heldCardIds, which
        // copies every held id into a fresh vector per flow per deal.
        std::unordered_map<std::string, int> counts;
        for (const auto& pair : flows_)
        {
            if (except && pair.first == *except) continue;
            for (const auto& hand : pair.second->boardContents_)
            {
                for (const auto& cardId : hand.second) ++counts[cardId];
            }
        }
        return counts;
    }

    inline StoryletValue Engine::getProperty(const std::string& path) const
    {
        const std::vector<std::string> parts = Flow::splitPath(path);
        // The owner segment is resolved ONCE, here, and handed on: setProperty
        // reads through the same call with the same answer, so the read that
        // refuses a write and the write itself can never disagree about which
        // store an address names (4.4).
        std::optional<OwnedAddress> owned;
        if (parts.size() == 3 && detail::IsOwnedScope(parts[0])) owned = resolveOwned(parts);
        return readShared(path, parts, owned);
    }

    inline StoryletValue Engine::readShared(const std::string& path, const std::vector<std::string>& parts,
        const std::optional<OwnedAddress>& owned) const
    {
        if (parts.size() == 2 && parts[0] == "world")
        {
            std::optional<StoryletValue> wv = worldGet(parts[1]);
            if (!wv.has_value()) throw StoryletError("no property at \"" + path + "\"");
            return *wv;
        }
        // Another engine's game-wide scope (`patter.gold`): every engine reads every scope.
        if (parts.size() == 2 && parts[0] != "story" && registry_->has(parts[0]))
        {
            std::optional<StoryletValue> v = registry_->get(parts[0], parts[1]);
            if (!v.has_value()) throw StoryletError("no property at \"" + path + "\"");
            return *v;
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
        if (owned.has_value())
        {
            const std::string& kind = owned->kind;
            const OrderedMap<std::string, std::shared_ptr<PropertyBag>>& sharedKind = detail::KindOf(shared_, kind);
            const OrderedMap<std::string, std::vector<PropertyDecl>>& flowKind = detail::KindOf(flowDecls_, kind);
            const std::shared_ptr<PropertyBag>* bag = sharedKind.get(owned->id);
            if (bag)
            {
                std::optional<StoryletValue> v = (*bag)->get(owned->name);
                if (v.has_value()) return *v;
            }
            const std::vector<PropertyDecl>* decls = flowKind.get(owned->id);
            if (decls)
            {
                for (const auto& d : *decls)
                {
                    if (d.name == owned->name)
                    {
                        throw StoryletError("\"" + path + "\" is per-flow state - read it on a Flow, not the Engine");
                    }
                }
            }
            // The error names the segment the CALLER wrote, never the id it
            // resolved to: an address the reader did not type teaches nothing.
            if (!bag && !decls) throw StoryletError("no " + kind + " store \"" + owned->segment + "\"");
            throw StoryletError("no property at \"" + path + "\"");
        }
        throw StoryletError("bad property path \"" + path + "\"");
    }

    inline void Engine::setProperty(const std::string& path, const StoryletValue& value)
    {
        const std::vector<std::string> parts = Flow::splitPath(path);
        if (parts.size() == 2 && parts[0] == "world")
        {
            if (!worldCanSet()) throw StoryletError("@world is read-only here: the host bound no write");
            worldSet(parts[1], value, /*host=*/true);
            return;
        }
        if (parts.size() == 2 && parts[0] != "story" && registry_->has(parts[0]))
        {
            // Another engine's game-wide scope, written as the host. A refusal (a scope
            // lent with no setter) is the kernel's RegistryError, rethrown as StoryletError.
            kernelCall([&] { registry_->set(parts[0], parts[1], value, /*host=*/true); });
            return;
        }
        // Resolved once, then reused for both halves (4.4). The write used to
        // re-split the path and dereference whatever KindOf found for it, which
        // survived only because the read below had thrown first.
        std::optional<OwnedAddress> owned;
        if (parts.size() == 3 && detail::IsOwnedScope(parts[0])) owned = resolveOwned(parts);
        // Reuse the read-side routing: a per-flow or unknown ref throws the
        // same message before anything is written.
        readShared(path, parts, owned);
        PropertyBag* bag = shared_.story.get();
        if (owned.has_value())
        {
            const std::shared_ptr<PropertyBag>* found = detail::KindOf(shared_, owned->kind).get(owned->id);
            if (!found) throw StoryletError("no " + owned->kind + " store \"" + owned->segment + "\"");
            bag = found->get();
        }
        // A HOST write, in any scope: silent under the firing rule, visible to the
        // audit hook, and never refused by a `writable: false` - that flag is the
        // story's promise about its own outcomes, and this is the game speaking.
        bag->set(parts.back(), value, /*silent=*/true, "host setProperty", /*host=*/true);
    }

    inline void Engine::addWorldRows(std::vector<PropertyRow>& rows) const
    {
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
            // Whether the resolver can be written at all AND what the declaration
            // says, which is the kernel's own rule for a foreign scope: a row is
            // where `writable: false` is meant to SHOW.
            r.writable = worldCanSet() && !worldReadOnly(d.name);
            rows.push_back(std::move(r));
        }
    }

    inline std::vector<PropertyRow> Engine::listProperties() const
    {
        std::vector<PropertyRow> rows;
        addWorldRows(rows);
        // No path prefix passed in: the bag composes the address from its own
        // pathPrefix, so the row arrives complete.
        auto add = [&rows](const PropertyBag& bag)
        {
            for (const auto& row : bag.rows()) rows.push_back(row);
        };
        add(*shared_.story);
        for (const auto& pair : shared_.box) add(*pair.second);
        for (const auto& pair : shared_.deck) add(*pair.second);
        for (const auto& pair : shared_.hand) add(*pair.second);
        for (const auto& pair : shared_.value) add(*pair.second);
        return rows;
    }

    inline SaveEnvelope Engine::saveGame() const
    {
        SaveEnvelope envelope;
        envelope.schema = SAVE_SCHEMA;
        envelope.content = bundle_->content;
        if (ownsRegistry_) envelope.registry = registrySection();
        envelope.shared.spent = spentIds();
        // JS object order (ruling E): integer-like flow ids first. The
        // reference writes `flows` as an object, so this is the order its
        // bytes have and the order any load reopens them in.
        for (const auto& id : detail::JsKeyOrder(flows_.keys())) envelope.flows.set(id, (*flows_.get(id))->snapshot(false));
        return envelope;
    }

    /** The registry's values in CANONICAL order, the order a load rebuilds
     *  them in: the engine-wide keys as the constructor registered them, then
     *  each flow's keys in the order the save's `flows` lists them, JS object
     *  order (ruling E; each flow's own registration order within it),
     *  then anything else the registry holds (values still waiting for a key),
     *  as the registry lists it. The registry itself lists keys in
     *  registration order, and a flow replaced in place (open() keeps its slot
     *  in flows_) re-registers its keys at the END, so openFlow("a");
     *  openFlow("b"); openFlow("a") saved b's keys before a's while a load
     *  rebuilt a's first: the same run, different .storyletsave bytes, and a
     *  save loaded and saved again no longer equal to itself (2026-10-01).
     *  Order does not matter on READ, so a save written in the old order loads
     *  as before. */
    inline OrderedMap<std::string, OrderedMap<std::string, StoryletValue>> Engine::registrySection() const
    {
        const OrderedMap<std::string, OrderedMap<std::string, StoryletValue>> all = registry_->save();
        OrderedMap<std::string, OrderedMap<std::string, StoryletValue>> out;
        auto take = [&all, &out](const std::string& key)
        {
            const OrderedMap<std::string, StoryletValue>* found = all.get(key);
            if (found && !out.contains(key)) out.set(key, *found);
        };
        for (const auto& key : registered_) take(key);
        // The flows in the order the save's `flows` lists them (ruling E).
        for (const auto& id : detail::JsKeyOrder(flows_.keys()))
        {
            for (const auto& key : (*flows_.get(id))->registered_) take(key);
        }
        for (const auto& pair : all) take(pair.first);
        return out;
    }

    inline FlowSave Engine::saveFlow(const std::string& id) const
    {
        const FlowPtr* found = flows_.get(id);
        if (!found) throw StoryletError("unknown flow \"" + id + "\"");
        // Parked whole, properties included: a parked flow's bags leave the
        // registry when it closes, so its values have to travel with it.
        return (*found)->snapshot(true);
    }

    inline void Engine::assertSameProject(const SaveEnvelope& envelope) const
    {
        if (envelope.content.project != bundle_->content.project)
        {
            throw StoryletError("save is for project \"" + envelope.content.project
                + "\", bundle is \"" + bundle_->content.project + "\"");
        }
    }

    inline LoadReport Engine::previewLoad(const SaveEnvelope& envelope) const
    {
        assertSameProject(envelope);
        return planLoad(envelope).report;
    }

    inline LoadReport Engine::previewFlowRestore(const std::string& id, const FlowSave& saved) const
    {
        detail::ReportDraft draft;
        const std::unordered_map<std::string, int> otherClaims = sharedClaimsExcept(id);
        planFlowRestore(id, saved, &otherClaims, draft);
        return detail::FinishReport(bundle_->content, bundle_->content, {id}, draft);
    }

    inline LoadReport Engine::loadGame(const SaveEnvelope& envelope)
    {
        assertSameProject(envelope);
        assertExternalScopes();
        LoadPlan plan = planLoad(envelope);
        if (plan.sections.has_value())
        {
            // The envelope carries the values: every bag of this engine back to
            // its defaults, then the cleaned values over them.
            reset();
            // The engine's own registry takes the save wholesale. A game's
            // registry may hold values the game loaded for other engines, still
            // waiting: add to those, never replace them.
            registry_->load(*plan.sections, /*keepParked=*/!ownsRegistry_);
        }
        else
        {
            std::unordered_set<std::string> keep;
            for (const auto& pair : plan.flows) keep.insert(pair.first);
            dropRun(&keep);
        }
        for (const auto& id : plan.spent) spent_.insert(id);
        for (const auto& pair : plan.flows)
        {
            open(pair.first, OpenFlowOptions(), /*claim=*/true)->restore(pair.second);
        }
        return plan.report;
    }

    inline std::vector<detail::DurableProp> Engine::durableProps(const detail::FlowDecls& decls) const
    {
        std::vector<detail::DurableProp> out;
        std::unordered_set<std::string> seen;
        auto push = [&out, &seen](detail::DurableProp prop)
        {
            if (!seen.insert(prop.address).second) return;
            out.push_back(std::move(prop));
        };
        for (const PropertyDecl& decl : decls.story)
        {
            if (decl.durable.value_or(false)) push(detail::DurableProp{"story." + decl.name, "story", std::string(), decl});
        }
        for (const char* kind : {"box", "deck", "hand", "value"})
        {
            for (const auto& pair : detail::KindOf(decls, kind))
            {
                for (const PropertyDecl& decl : pair.second)
                {
                    if (!decl.durable.value_or(false)) continue;
                    push(detail::DurableProp{addressOf(kind, pair.first) + "." + decl.name, kind, pair.first, decl});
                }
            }
        }
        return out;
    }

    inline void Engine::assertDurable(const DurableSave& save) const
    {
        if (save.schema != DURABLE_SCHEMA) throw StoryletError("unsupported durable schema: " + save.schema);
        if (save.content.project != bundle_->content.project)
        {
            throw StoryletError("durable state is for project \"" + save.content.project
                + "\", bundle is \"" + bundle_->content.project + "\"");
        }
    }

    inline detail::DurablePlan Engine::planDurable(const std::vector<detail::DurableProp>& props,
        const std::vector<detail::CardEntry>& cards, const DurableSave& save,
        const std::optional<std::string>& flow, detail::ReportDraft& draft) const
    {
        const std::string at = flow.has_value() ? *flow : std::string();
        std::unordered_map<std::string, size_t> byAddress;
        for (size_t i = 0; i < props.size(); ++i) byAddress.emplace(props[i].address, i);
        detail::DurablePlan plan;
        for (const auto& pair : save.values)
        {
            const auto found = byAddress.find(pair.first);
            if (found == byAddress.end())
            {
                draft.droppedProperties.push_back(LoadProperty{at, pair.first});
                continue;
            }
            if (!detail::ValueFits(props[found->second].decl, pair.second))
            {
                draft.retypedProperties.push_back(LoadProperty{at, pair.first});
                continue;
            }
            plan.values.emplace_back(found->second, pair.second);
        }
        // A value no property can hold fits no declaration: dropped where the
        // address is not durable on this side, retyped where it is, exactly as
        // JS's valueFits answers for a null or an object.
        std::unordered_set<std::string> carried(save.unreadable.begin(), save.unreadable.end());
        for (const std::string& address : save.unreadable)
        {
            if (byAddress.count(address) == 0) draft.droppedProperties.push_back(LoadProperty{at, address});
            else draft.retypedProperties.push_back(LoadProperty{at, address});
        }
        for (const detail::DurableProp& prop : props)
        {
            if (!save.values.contains(prop.address) && carried.count(prop.address) == 0)
            {
                draft.defaultedProperties.push_back(LoadProperty{at, prop.address});
            }
        }
        std::unordered_set<std::string> eligible;
        for (const detail::CardEntry& entry : cards) eligible.insert(entry.card->id);
        for (const std::string& gameId : save.spent)
        {
            const detail::CardEntry* entry = cardsByGameId_.get(gameId);
            if (entry && eligible.count(entry->card->id) > 0) plan.cards.push_back(entry->card->id);
            else if (flow.has_value()) draft.droppedCooldowns.push_back(LoadCooldown{*flow, gameId});
            else draft.droppedSpent.push_back(gameId);
        }
        return plan;
    }

    inline DurableSave Engine::saveDurable() const
    {
        DurableSave memory;
        memory.content = bundle_->content;
        memory.values = detail::DurableValues(shared_, durable_.shared);
        for (const detail::CardEntry& entry : durable_.sharedCards)
        {
            if (spent_.count(entry.card->id) > 0) memory.spent.push_back(EffectiveGameId(*entry.card));
        }
        std::sort(memory.spent.begin(), memory.spent.end());
        return memory;
    }

    inline LoadReport Engine::loadDurable(const DurableSave& memory)
    {
        assertDurable(memory);
        detail::ReportDraft draft;
        const detail::DurablePlan plan = planDurable(durable_.shared, durable_.sharedCards, memory, std::nullopt, draft);
        // Every shared durable property takes the memory's value or, where the
        // memory has none that fits, its default: the memory is the whole of
        // this half, so a value it lacks is not left as this run found it.
        std::vector<const StoryletValue*> planned(durable_.shared.size(), nullptr);
        for (const auto& pair : plan.values) planned[pair.first] = &pair.second;
        for (size_t i = 0; i < durable_.shared.size(); ++i)
        {
            const detail::DurableProp& prop = durable_.shared[i];
            detail::PutDurable(detail::DurableBag(shared_, prop), prop.decl.name,
                planned[i] ? *planned[i] : prop.decl.defaultOrTypeDefault());
        }
        for (const std::string& cardId : plan.cards) spent_.insert(cardId);
        return detail::FinishReport(bundle_->content, memory.content, {}, draft);
    }

    inline Engine::HotSwapResult Engine::hotSwap(BundlePtr bundle, const std::function<void(EngineOptions&)>& change)
    {
        if (!bundle) throw StoryletError("hotSwap needs a bundle");
        // A load's project refusal, asked before anything moves.
        if (bundle->content.project != bundle_->content.project)
        {
            throw StoryletError("hotSwap: the bundle is for project \"" + bundle->content.project
                + "\", this engine runs \"" + bundle_->content.project + "\"");
        }
        // The options this engine was built with, and only what `change` edits differs.
        EngineOptions opts = creationOptions_;
        if (change) change(opts);
        SaveEnvelope snapshot = saveGame();
        HotSwapResult result;
        if (ownsRegistry_)
        {
            // Its own registry: a save and a load into a new engine, as it always
            // was, and this engine is left untouched.
            EngineOptions own = opts;
            own.registry = nullptr;
            result.engine = std::make_unique<Engine>(std::move(bundle), own);
            result.report = result.engine->loadGame(snapshot);
            return result;
        }
        ScopeRegistry& reg = *registry_;
        // This engine's own values, registered or still waiting for a flow.
        ScopeRegistry::SaveBlob mine;
        for (const auto& section : reg.save())
        {
            if (section.first == "story" || section.first.compare(0, 10, "storylets/") == 0) mine.set(section.first, section.second);
        }
        std::unordered_set<std::string> held(registered_.begin(), registered_.end());
        for (const auto& pair : flows_) held.insert(pair.second->registered_.begin(), pair.second->registered_.end());
        ScopeRegistry::SaveBlob waiting;
        for (const auto& section : mine)
        {
            if (!held.count(section.first)) waiting.set(section.first, section.second);
        }
        // Step out of the registry. The bags keep their values, so stepping back in is exact.
        for (const auto& key : registered_)
        {
            if (reg.has(key)) reg.remove(key);
        }
        registered_.clear();
        for (const auto& pair : flows_) pair.second->releaseBags(false);
        EngineOptions next = opts;
        next.registry = registry_;
        std::unique_ptr<Engine> replacement;
        try
        {
            replacement = std::make_unique<Engine>(std::move(bundle), next);
            snapshot.registry = mine;
            result.report = replacement->loadGame(snapshot);
            // Values that were waiting for a flow wait on, for the replacement's flow of that name.
            ScopeRegistry::SaveBlob stillWaiting;
            for (const auto& section : waiting)
            {
                if (!reg.has(section.first)) stillWaiting.set(section.first, section.second);
            }
            if (!stillWaiting.empty()) reg.load(stillWaiting, /*keepParked=*/true);
            dropRun(nullptr);
            result.engine = std::move(replacement);
            return result;
        }
        catch (...)
        {
            // Back as it was. The replacement goes, and its registrations with it
            // (a constructor that failed part way already took its own out,
            // parking what it had claimed), so this engine's keys are cleared of
            // anything waiting, registered again, and its own values laid back
            // over them (the waiting ones parked again).
            replacement.reset();
            reg.discardParked(std::string("storylets/"));
            registerShared();
            for (const auto& pair : flows_) pair.second->registerBags();
            // `story` may have claimed what the failed replacement parked there:
            // back to its declarations, then this engine's own values over it.
            reseedShared();
            reg.load(mine, /*keepParked=*/true);
            rethrowKernelError();
        }
    }

    inline PropsPartition Engine::walkPartition(const detail::FlowDecls& decls, const PropsPartition* values,
        const std::string& flow, detail::ReportDraft& draft) const
    {
        PropsPartition out;
        out.story = detail::WalkScope(&decls.story, values ? &values->story : nullptr, "story.", flow, draft);
        struct KindView
        {
            const char* name;
            const OrderedMap<std::string, std::vector<PropertyDecl>>* decls;
            const OrderedMap<std::string, OrderedMap<std::string, StoryletValue>>* saved;
            OrderedMap<std::string, OrderedMap<std::string, StoryletValue>>* out;
        };
        const KindView kinds[] = {
            {"box", &decls.box, values ? &values->box : nullptr, &out.box},
            {"deck", &decls.deck, values ? &values->deck : nullptr, &out.deck},
            {"hand", &decls.hand, values ? &values->hand : nullptr, &out.hand},
            {"value", &decls.value, values ? &values->value : nullptr, &out.value},
        };
        for (const auto& kind : kinds)
        {
            // An owner the save carries and the build no longer has drops whole
            // (its bag is gone, so its values have nowhere to land); an owner the
            // build has and the save lacks keeps every default.
            std::vector<std::string> ids = kind.decls->keys();
            if (kind.saved)
            {
                for (const auto& id : kind.saved->keys())
                {
                    if (!kind.decls->contains(id)) ids.push_back(id);
                }
            }
            std::sort(ids.begin(), ids.end());
            for (const auto& id : ids)
            {
                // The report's `path` is exactly what listProperties() prints
                // and what setProperty takes: one grammar, so an operator
                // reading a hot-swap report can paste the address straight back
                // in (4.4). An owner the build no longer has keeps its id.
                const std::string prefix = addressOf(kind.name, id) + ".";
                kind.out->set(id, detail::WalkScope(kind.decls->get(id),
                    kind.saved ? kind.saved->get(id) : nullptr, prefix, flow, draft));
            }
        }
        return out;
    }

    inline Engine::LoadPlan Engine::planLoad(const SaveEnvelope& envelope) const
    {
        if (envelope.schema != SAVE_SCHEMA && envelope.schema != SAVE_SCHEMA_V1)
        {
            throw StoryletError("unsupported save schema: " + envelope.schema);
        }
        detail::ReportDraft draft;
        LoadPlan plan;
        // Where the property values are, if this envelope has them: a version 1
        // envelope's partitions, or a standalone engine's registry sections.
        std::unordered_set<std::string> flowIds;
        for (const auto& pair : envelope.flows) flowIds.insert(pair.first);
        std::optional<detail::MovedValues> moved;
        if (envelope.schema == SAVE_SCHEMA_V1)
        {
            detail::MovedValues v1;
            if (envelope.shared.props.has_value()) v1.shared = *envelope.shared.props;
            for (const auto& pair : envelope.flows)
            {
                v1.flows.set(pair.first, pair.second.props.has_value() ? *pair.second.props : PropsPartition());
            }
            moved = std::move(v1);
        }
        else if (envelope.registry.has_value())
        {
            moved = detail::PartitionsFromSections(*envelope.registry, flowIds);
        }
        std::optional<PropsPartition> shared;
        if (moved.has_value()) shared = walkPartition(sharedDecls_, &moved->shared, std::string(), draft);
        for (const auto& cardId : envelope.shared.spent)
        {
            if (cardsById_.contains(cardId)) plan.spent.push_back(cardId);
            else draft.droppedSpent.push_back(cardId);
        }
        if (moved.has_value())
        {
            plan.sections = moved->rest;
            detail::SectionsOf(*shared, [](const std::string& kind, const std::string& id)
            {
                return kind == "story" ? std::string("story") : detail::SharedKey(kind, id);
            }, *plan.sections);
        }
        // In JS object order (ruling E), whatever order the envelope holds: a
        // JS load reads `flows` through JSON.parse, which puts integer-like ids
        // first, so that is the order the flows reopen in everywhere.
        std::vector<std::string> ids = detail::JsKeyOrder(envelope.flows.keys());
        for (const auto& flowKey : ids)
        {
            FlowSave withProps = *envelope.flows.get(flowKey);
            if (moved.has_value())
            {
                const PropsPartition* values = moved->flows.get(flowKey);
                withProps.props = values ? *values : PropsPartition();
            }
            FlowSave clean = planFlowRestore(flowKey, withProps, nullptr, draft);
            if (plan.sections.has_value() && clean.props.has_value())
            {
                // The flow's values go into the registry, where its bags claim
                // them; the restored flow itself carries none.
                const std::string flowId = flowKey;
                detail::SectionsOf(*clean.props, [&flowId](const std::string& kind, const std::string& id)
                {
                    return detail::FlowKey(flowId, kind, id);
                }, *plan.sections);
                clean.props.reset();
            }
            plan.flows.set(flowKey, std::move(clean));
        }
        plan.report = detail::FinishReport(bundle_->content, envelope.content, ids, draft);
        return plan;
    }

    inline FlowSave Engine::planFlowRestore(const std::string& id, const FlowSave& saved,
        const std::unordered_map<std::string, int>* otherClaims, detail::ReportDraft& draft) const
    {
        FlowSave clean;
        // A flow blob without properties (a version 2 envelope's: the registry
        // has them) has nothing to walk.
        if (saved.props.has_value()) clean.props = walkPartition(flowDecls_, &*saved.props, id, draft);
        clean.turns = saved.turns;
        clean.prng = saved.prng;
        clean.playLog = saved.playLog;
        for (const auto& pair : saved.cooldowns)
        {
            if (cardsById_.contains(pair.first)) clean.cooldowns.set(pair.first, pair.second);
            else draft.droppedCooldowns.push_back(LoadCooldown{id, pair.first});
        }
        // A deleted entity has no gameId left, so it is named by the id the save
        // carries; everything the build still knows is named by its gameId.
        auto cardName = [this](const std::string& cardId) -> std::string
        {
            const detail::CardEntry* entry = cardsById_.get(cardId);
            return entry ? EffectiveGameId(*entry->card) : cardId;
        };
        std::unordered_map<std::string, int> restored;
        for (const auto& pair : saved.board)
        {
            const detail::HandInBox* known = handsById_.get(pair.first);
            if (!known)
            {
                for (const auto& cardId : pair.second)
                {
                    draft.evicted.push_back(LoadEviction{id, pair.first, cardName(cardId), "hand-vanished"});
                }
                continue;
            }
            const std::string hand = EffectiveGameId(*known->hand);
            std::vector<std::string> kept;
            for (const auto& cardId : pair.second)
            {
                const detail::CardEntry* entry = cardsById_.get(cardId);
                if (!entry)
                {
                    draft.evicted.push_back(LoadEviction{id, hand, cardId, "vanished"});
                    continue;
                }
                if (otherClaims
                    && Flow::cardIsShared(*entry->card, entry->deck->shared.has_value() && *entry->deck->shared))
                {
                    const auto elsewhere = otherClaims->find(cardId);
                    const int held = (elsewhere == otherClaims->end() ? 0 : elsewhere->second) + restored[cardId];
                    if (static_cast<double>(held) >= Flow::sharedCap(*entry->card))
                    {
                        draft.evicted.push_back(
                            LoadEviction{id, hand, EffectiveGameId(*entry->card), "claimed-elsewhere"});
                        continue;
                    }
                    ++restored[cardId];
                }
                kept.push_back(cardId);
            }
            clean.board.set(pair.first, std::move(kept));
        }
        return clean;
    }
}
