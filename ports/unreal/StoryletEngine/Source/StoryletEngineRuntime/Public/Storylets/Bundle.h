// The compiled bundle model, its loader, and the save envelope. Port of
// @storylet-studio/model (packages/model/src/index.ts): the bundle schema
// "storylets/bundle@0" (world/story property decls, boxes with decks/cards/
// outcomes/tag groups/hands/hand templates, ranking, fields, redraw, copies,
// the home group), SaveEnvelope ("storylets/save@1"), and the gameId
// derivation rules (GameIdify / EffectiveGameId). The loader consumes the
// core's neutral JsonValue tree (the Unity port's BundleLoader, minus the
// JSON library), so hosts feed it from any parser. No behaviour lives here.
#pragma once

#include <cctype>
#include <cstdint>
#include <limits>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "Storylets/Ast.h"
#include "Storylets/JsonValue.h"
#include "Storylets/Expr/OrderedMap.h"
#include "Storylets/Expr/PropertyBag.h"
#include "Storylets/StoryletValue.h"

namespace storylets
{
    inline const char* const BUNDLE_SCHEMA = "storylets/bundle@0";
    inline const char* const SAVE_SCHEMA = "storylets/save@1";
    /** The .storyletsave FILE's schema: the HOST's wrapper (the engine's
     *  envelope plus, when the host keeps one, its @world container -
     *  design/flows.md). The engine never reads or writes the world half. */
    inline const char* const SAVEFILE_SCHEMA = "storylets/savefile@1";

    /** The reserved tag group (schema 2.4): present in every box without
     *  declaration, its tags the box's hand ids. Every hand implicitly binds
     *  it to its own name; a homed card is available only to its hand. */
    inline const char* const PLACE_GROUP = "place";

    /** Is this `chosen` / binding value MEANT as a property reference rather
     *  than a tag id (design/engine-server.md 4.6)? The leading '@' alone,
     *  deliberately: a value that starts with one and does not parse is a
     *  mistyped reference, not an odd tag id. */
    inline bool IsHoleRef(const std::string& value)
    {
        return !value.empty() && value[0] == '@';
    }

    /** Parse a hole reference into scope and name; false when the value is not
     *  one. Spelled out rather than <regex>, which the std core deliberately
     *  avoids, and the NAME is checked as well as the scope word: JS applies
     *  ^@(hand|world|story)\.([a-z][a-z0-9_-]*)$ and the four runtimes have to
     *  refuse the same strings (the boundBy divergence of 2026-08-29). */
    inline bool ParseHoleRef(const std::string& ref, std::string& scope, std::string& name)
    {
        const size_t dot = ref.find('.');
        if (ref.size() < 2 || ref[0] != '@' || dot == std::string::npos) return false;
        scope = ref.substr(1, dot - 1);
        name = ref.substr(dot + 1);
        if (scope != "hand" && scope != "world" && scope != "story") return false;
        if (name.empty() || name[0] < 'a' || name[0] > 'z') return false;
        for (char c : name)
        {
            const bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
            if (!ok) return false;
        }
        return true;
    }

    /** JS Number.MAX_SAFE_INTEGER: the "never" cooldown (deliberately not
     *  Infinity, which JSON-serialises to null). */
    constexpr double MAX_SAFE_INTEGER = 9007199254740991.0;

    /** Slugify a human label into a filename- / address-safe gameId. ASCII
     *  lowercasing (bundle identities are ASCII by construction); apostrophes
     *  (' and the UTF-8 right single quote) drop, any other non [a-z0-9-] run
     *  collapses to one dash, edge dashes trim. */
    inline std::string GameIdify(const std::string& text)
    {
        // Strip apostrophes first (' and U+2019, which is 0xE2 0x80 0x99 in UTF-8).
        std::string stripped;
        stripped.reserve(text.size());
        for (size_t i = 0; i < text.size(); ++i)
        {
            unsigned char c = static_cast<unsigned char>(text[i]);
            if (c == '\'') continue;
            if (c == 0xE2 && i + 2 < text.size()
                && static_cast<unsigned char>(text[i + 1]) == 0x80
                && static_cast<unsigned char>(text[i + 2]) == 0x99)
            {
                i += 2;
                continue;
            }
            stripped += static_cast<char>(std::tolower(c));
        }
        // Replace non-slug runs with one dash; trim edge dashes.
        std::string out;
        bool pendingDash = false;
        for (char ch : stripped)
        {
            bool slug = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '-';
            if (!slug || ch == '-')
            {
                if (!out.empty()) pendingDash = true;
                continue;
            }
            if (pendingDash)
            {
                out += '-';
                pendingDash = false;
            }
            out += ch;
        }
        return out;
    }

    inline bool IsValidGameId(const std::string& gameId)
    {
        // ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$
        if (gameId.empty()) return false;
        auto alnum = [](char c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'); };
        if (!alnum(gameId.front()) || !alnum(gameId.back())) return false;
        for (char c : gameId)
        {
            if (!alnum(c) && c != '-') return false;
        }
        return true;
    }

    namespace detail
    {
        inline std::string Trim(const std::string& s)
        {
            size_t start = 0, end = s.size();
            while (start < end && std::isspace(static_cast<unsigned char>(s[start]))) ++start;
            while (end > start && std::isspace(static_cast<unsigned char>(s[end - 1]))) --end;
            return s.substr(start, end - start);
        }
    }

    /** The effective address: a pinned gameId, else derived from the title,
     *  else the immutable id (so there is always something addressable).
     *  Entities carry id / gameId / title members (title empty = untitled). */
    template <typename T>
    std::string EffectiveGameId(const T& entity)
    {
        std::string pinned = detail::Trim(entity.gameId);
        if (!pinned.empty()) return pinned;
        std::string fromTitle = GameIdify(entity.title);
        return !fromTitle.empty() ? fromTitle : entity.id;
    }

    /** A property declaration: @world / @story / @box / @deck / tag / hand
     *  state. A declared property always has a value (default required in the
     *  compiled bundle); referencing an undeclared property is a publish-time
     *  error. Extends the kernel's ScopeDeclaration exactly the way the TS
     *  types line up structurally. */
    struct PropertyDecl : ScopeDeclaration
    {
        /** The sharing axis (design/flows.md): one value across all flows,
         *  or a copy per flow. Absent = the scope default (@story shared;
         *  box, deck, hand and tag properties per-flow). Never valid on a
         *  @world declaration (the compiler refuses it). */
        std::optional<bool> shared;
        /** The durability axis (design/engine-server.md 4.2), valid wherever
         *  `shared` is and orthogonal to it: `shared` says whose value this is
         *  WITHIN a run, `durable` says whether it survives the run at all.
         *  INERT here - the engine partitions by `shared` alone and never reads
         *  this; a server lifts and restores durable values across a run
         *  boundary through GetProperty / SetProperty. Never valid on a @world
         *  declaration (the compiler refuses it). */
        std::optional<bool> durable;
        /** @world only: false is the story's promise not to write it (Reboot.md 10).
         *  Absent = writable. Mirrors Patter's HostScopeDecl.writable. */
        std::optional<bool> writable;
        std::string purpose;
    };

    /** A card-template field (box-defined). Data for the host; the engine
     *  never interprets fields and they are not addressable from expressions. */
    struct FieldDecl : ScopeDeclaration
    {
        std::string purpose;
    };

    /** Cooldown policy, in turns (schema 3.4): "always" | "never" | N. */
    struct RedrawPolicy
    {
        enum class Kind { Always, Never, After };
        Kind kind = Kind::Always;
        double turns = 0;                       // set for the numeric policy

        static RedrawPolicy Always() { return RedrawPolicy{}; }
        static RedrawPolicy Never()
        {
            RedrawPolicy p;
            p.kind = Kind::Never;
            return p;
        }
        static RedrawPolicy After(double turns)
        {
            RedrawPolicy p;
            p.kind = Kind::After;
            p.turns = turns;
            return p;
        }
    };

    struct Outcome
    {
        std::string id;
        std::string gameId;
        std::string title;
        std::string purpose;
        /** Gating; availability is always evaluated against current state. */
        ExpressionPtr condition;
        /** Target ("@scope.name") -> expression; all right-hand sides evaluate
         *  against pre-play state (schema 3.7). */
        OrderedMap<std::string, ExpressionPtr> changes;
    };

    struct Card
    {
        std::string id;
        std::string gameId;
        std::string title;
        std::string purpose;
        ExpressionPtr condition;
        /** Priority: a number, or an expression that must evaluate to a number
         *  (exactly one of the two is set; default number 0). */
        std::optional<double> priorityNumber;
        ExpressionPtr priorityExpr;
        RedrawPolicy redraw;
        /** Tags: tag group id -> tag ids. An absent group is a wildcard,
         *  except the reserved home group, whose default inverts (schema 2.4).
         *  An empty map means the card carries no tags at all. */
        OrderedMap<std::string, std::vector<std::string>> tags;
        /** How many hands may hold this card at once (schema 3.5): integer
         *  >= 1, default 1. */
        std::optional<double> copies;
        /** Scarce across flows (design/shared-scarcity.md); absent takes the
         *  deck's flag, set here it overrides the deck. */
        std::optional<bool> shared;
        /** How many hands ACROSS EVERY FLOW may hold this at once. Read only
         *  when shared; defaults to copies. */
        std::optional<double> sharedCopies;
        /** Does this card's `redraw: never` spend survive the run (4.2)? Absent
         *  takes the deck's flag. INERT here: the server lifts the durable
         *  spends at a run boundary and puts them back through
         *  OpenFlow(id, restore) and MarkTaken. */
        std::optional<bool> durable;
        /** Card-template data: field name -> value. */
        OrderedMap<std::string, StoryletValue> fields;
        std::vector<Outcome> outcomes;
    };

    struct Deck
    {
        std::string id;
        std::string gameId;
        std::string title;
        std::string purpose;
        /** The deck gate, evaluated once per draw in the draw's environment. */
        ExpressionPtr condition;
        /** This pile is scarce across flows: every card in it is shared unless
         *  the card says otherwise (design/shared-scarcity.md). */
        std::optional<bool> shared;
        /** Every `redraw: never` card in this pile is spent past the end of the
         *  run unless the card says otherwise (4.2). Inert here. */
        std::optional<bool> durable;
        std::vector<PropertyDecl> properties;
        std::vector<Card> cards;
    };

    struct Tag
    {
        std::string id;
        std::string gameId;
        std::string title;                      // always empty (tags carry no title)
        std::vector<PropertyDecl> properties;
    };

    /** A named axis for cross-cutting cards (schema 2.4). Tags are declared,
     *  not freeform. */
    struct TagGroup
    {
        std::string id;
        std::string gameId;
        std::string title;                      // always empty (groups carry no title)
        std::string purpose;
        /** A @world or @story property reference whose value names a tag in this
         *  group by gameId: the group binds itself from state at every ask
         *  (design/where-and-selectors.md Part B). Empty for an ordinary group. */
        std::string boundBy;
        /** True: a card that omits this group is unavailable wherever the group
         *  is bound, instead of wildcarding in. */
        bool required = false;
        std::vector<Tag> tags;
    };

    /** A declared kind of hand (schema 2.6): live-inherited, author-side only,
     *  never called from game code. One condition governs every instance. */
    struct HandTemplate
    {
        std::string id;
        std::string gameId;
        std::string title;
        std::string purpose;
        /** Fixed tag bindings: tag group id -> tag id. */
        OrderedMap<std::string, std::string> bindings;
        /** The holes: tag group ids each instance fills (one tag each). */
        std::vector<std::string> chooses;
        /** Shared availability condition, ANDed in; evaluated per instance
         *  against that instance's composed @hand. */
        ExpressionPtr condition;
        /** Default slot cap; +infinity for "unbounded", absent when undeclared. */
        std::optional<double> slots;
        /** Declared @hand state every instance carries. */
        std::vector<PropertyDecl> properties;
    };

    /** A standalone hand's inline rule (schema 2.6): owned by the hand. */
    struct HandRule
    {
        OrderedMap<std::string, std::string> bindings;
        ExpressionPtr condition;
        /** +infinity for "unbounded", absent when undeclared. */
        std::optional<double> slots;
    };

    /** A hand (schema 2.6): a template instance (templateId + chosen) or a
     *  standalone hand (rule). Exactly one of the two. Fully concrete: deal is
     *  name-only. */
    struct Hand
    {
        std::string id;
        /** The name deal() is called with; a rename is a breaking change. */
        std::string gameId;
        std::string title;
        std::string purpose;
        /** Hand template id (not gameId); empty for standalone hands. */
        std::string templateId;
        /** Template instances: tag group id -> tag id, one per hole. */
        OrderedMap<std::string, std::string> chosen;
        /** Standalone hands: the inline rule. */
        std::shared_ptr<HandRule> rule;
        /** Override; defaults to the template's / rule's slots. The ONLY
         *  template field an instance may override. */
        std::optional<double> slots;
        /** Standalone hands' own @hand state (template instances inherit the
         *  template's declarations). */
        std::vector<PropertyDecl> properties;
    };

    struct RankingPolicy
    {
        /** The only per-box ranking policy (Reboot 2.2). */
        bool specificity = true;
    };

    struct Box
    {
        std::string id;
        std::string gameId;
        std::string title;
        std::string purpose;
        RankingPolicy ranking;
        /** Set on a TIMED box (design/engine-server.md 4.8): its clock counts
         *  real time, one turn every `seconds` of the run. A play in such a box
         *  advances nothing by default; the host ticks it with advanceTurns, and
         *  a card's `redraw: N` reads as N x seconds. Empty is the ordinary box,
         *  whose turn is a play. The number is inert to the runtime. */
        std::optional<double> turnSeconds;
        /** The card template: what every card in this box carries. */
        std::vector<FieldDecl> fields;
        std::vector<PropertyDecl> properties;
        std::vector<TagGroup> tagGroups;
        std::vector<Deck> decks;
        std::vector<HandTemplate> handTemplates;
        std::vector<Hand> hands;
    };

    /** Binds bundles to shards (staleness gate) and saves to bundles. */
    struct BundleContent
    {
        std::string project;
        std::string version;
        /** hash32 over the canonical source shards (schema 2.8). */
        std::string hash;
    };

    struct BundleSettings
    {
        double playAdvancesTurns = 1;
    };

    struct WorldSection
    {
        std::vector<PropertyDecl> properties;
        // The optional ScopeRegistrySpec (owned/foreign split) is host
        // territory; the runtime ignores it at this stage.
    };

    struct StorySection
    {
        std::vector<PropertyDecl> properties;
    };

    /** A point in a map's own coordinate space (no units: a map is to its own scale). */
    struct MapPoint
    {
        double x = 0;
        double y = 0;
    };

    /** One background picture behind a map. Draw order is list order. */
    struct MapBackground
    {
        /** Where the file sits relative to the bundle ("assets/<box>/<file>"). */
        std::string file;
        double x = 0;
        double y = 0;
        double width = 0;
        double height = 0;
        double opacity = 1;                     // 1 when the bundle did not say
    };

    /** One zone: a tag's outline, by the same gameId Peek() takes. */
    struct MapZone
    {
        std::string tag;
        std::vector<MapPoint> polygon;
    };

    /** Where a placed hand stands on a map, by hand gameId
     *  (design/engine-server.md 4.3). Sorted by that gameId in the bundle. */
    struct MapSite
    {
        std::string hand;                       // the hand standing here, by gameId
        double x = 0;
        double y = 0;
    };

    /**
     * A map the build was asked to carry: one spatial tag group's geometry
     * (design/graphical-views.md 2, "The map MAY ship with a bundle").
     *
     * INERT PAYLOAD. Nothing in the engine reads this, and nothing will: the
     * runtime deals in tag names. It is parsed and handed over so a host that
     * wants to draw an in-game map does not have to re-parse the asset itself,
     * which is the whole reason the export option exists.
     */
    struct BundleMap
    {
        std::string box;                        // the owning box, by gameId
        std::string group;                      // the tag group, by gameId
        std::vector<MapZone> zones;
        std::vector<MapBackground> backgrounds;
        /** Where the placed hands stand: empty when nobody put a hand here. */
        std::vector<MapSite> sites;
    };

    struct Bundle
    {
        std::string schema = BUNDLE_SCHEMA;
        BundleContent content;
        std::string metadata = "full";          // "full" | "stripped"
        BundleSettings settings;
        WorldSection world;
        StorySection story;
        std::vector<Box> boxes;
        /** Maps, when the build carried them. Empty is the normal state. */
        std::vector<BundleMap> maps;
    };

    using BundlePtr = std::shared_ptr<const Bundle>;

    // --- the save envelope ----------------------------------------------------

    struct PlayRecord
    {
        /** Card and outcome by gameId (feeds the play-history functions). */
        std::string card;
        std::string outcome;
        double turn = 0;
    };

    /** The per-scope property partitions one side of the sharing flag
     *  holds: a save carries one for the shared values and one per flow
     *  (design/flows.md). NO world member, in either: @world is the game's
     *  own state, saved by whoever owns it. */
    struct PropsPartition
    {
        OrderedMap<std::string, StoryletValue> story;
        OrderedMap<std::string, OrderedMap<std::string, StoryletValue>> box;
        OrderedMap<std::string, OrderedMap<std::string, StoryletValue>> deck;
        OrderedMap<std::string, OrderedMap<std::string, StoryletValue>> hand;
        /** Tag state, keyed by tag id. */
        OrderedMap<std::string, OrderedMap<std::string, StoryletValue>> value;
    };

    /** One flow's blob inside the envelope (schema 4). */
    struct FlowSave
    {
        PropsPartition props;
        /** Per-box turn counters, keyed by box id (schema 3.4) - per flow:
         *  there is deliberately no global turn. */
        OrderedMap<std::string, double> turns;
        /** mulberry32 state, uint32 (schema 3.3), per flow. */
        uint32_t prng = 0;
        /** Absolute next-eligible turn (of the card's box's clock) per card
         *  id; MAX_SAFE_INTEGER = never. */
        OrderedMap<std::string, double> cooldowns;
        /** Hand contents (card ids, in dealt order), keyed by hand id. The
         *  claims ledger is derived from this (schema 3.5). */
        OrderedMap<std::string, std::vector<std::string>> board;
        std::vector<PlayRecord> playLog;
    };

    /** The whole engine, one envelope: the shared partitions once, then
     *  every live flow keyed by its id - Patter's shape (one shared blob +
     *  N flow blobs; multi-flow and save/load are the same feature). */
    /** The engine's half: what every flow shares. Properties, and the cards a
     *  shared `redraw: never` has taken out of the world for good
     *  (design/shared-scarcity.md). Claims are NOT here: they are derived from
     *  the live boards, and each flow's board rides its own blob. */
    struct SharedSave
    {
        PropsPartition props;
        /** Card ids, sorted, so a save is byte-stable for a diff. */
        std::vector<std::string> spent;
    };

    struct SaveEnvelope
    {
        std::string schema = SAVE_SCHEMA;
        BundleContent content;
        SharedSave shared;
        OrderedMap<std::string, FlowSave> flows;
    };

    // --- the load report (design/engine-server.md 4.9) -------------------------
    //
    // loadGame is forgiving by design: a card the bundle no longer has drops off
    // the board, a property the save does not carry keeps its default, and a
    // version two builds newer loads without a word. That forgiveness is what
    // makes a save survive an edit, and it is also what hides the cost of a
    // content update from whoever is about to apply one. The report is the same
    // walk, itemised: previewLoad computes it and changes nothing, loadGame
    // computes it and applies it, and previewFlowRestore answers the same
    // questions for one flow.
    //
    // Identities are GAME IDS. The one exception is an entity the edit DELETED -
    // a vanished card, a vanished hand - which has no gameId left to give, so
    // the report carries the id the save itself carries.

    /** One card a restore refused to put back on the board. "claimed-elsewhere"
     *  is only ever a single-flow restore into a LIVE engine: the card is shared
     *  and the other open flows already hold every copy the world has. */
    struct LoadEviction
    {
        std::string flow;
        std::string hand;
        std::string card;
        /** "vanished" | "hand-vanished" | "claimed-elsewhere". */
        std::string reason;
    };

    /** One cooldown the restore forgot, because its card is gone. */
    struct LoadCooldown
    {
        std::string flow;
        std::string card;
    };

    /** One property the restore could not put back as it was. `flow` names the
     *  flow whose half it belongs to; empty is the shared half.
     *
     *  `path` is the engine's property address, spelled exactly as
     *  listProperties() prints it and exactly as getProperty and setProperty
     *  accept it: "story.name" for the story scope, "scope.owner.name" for the
     *  box, deck, hand and tag scopes. No "@", which belongs to the expression
     *  language and not to an address. The owner segment is the engine's own id
     *  today, the same gap every other address in the API has; design change 4.4
     *  moves property addresses and trace events to gameIds together, in all
     *  four runtimes. */
    struct LoadProperty
    {
        std::string flow;
        std::string path;
    };

    /** What the save said against what this build says. Equal means no drift on
     *  that axis. */
    struct LoadIdentity
    {
        std::string saved;
        std::string bundle;
    };

    /** What a load or a flow restore would do that is not a plain restore.
     *  Vectors are sorted, so two runtimes given the same save and bundle
     *  produce the same answer; `flows` alone keeps the envelope's own order,
     *  because a caller re-takes its handles in it. */
    struct LoadReport
    {
        /** No drift and nothing dropped, defaulted or retyped. `flows` is not a
         *  divergence and does not count. */
        bool exact = true;
        std::string project;
        /** Drift when the two differ; reported, never refused. */
        LoadIdentity version;
        /** Drift when the two differ; reported, never refused. */
        LoadIdentity hash;
        /** The flows this restores, in the order it restores them. */
        std::vector<std::string> flows;
        std::vector<LoadEviction> evicted;
        /** Cooldowns held for cards the bundle no longer has. */
        std::vector<LoadCooldown> droppedCooldowns;
        /** Shared `redraw: never` entries for cards the bundle no longer has. */
        std::vector<std::string> droppedSpent;
        /** In the save, not declared any more. */
        std::vector<LoadProperty> droppedProperties;
        /** Declared, not in the save: it takes the declaration's default. */
        std::vector<LoadProperty> defaultedProperties;
        /** In the save, still declared, but the saved value no longer fits the
         *  declaration (its type changed, or an enum value / quality stage was
         *  edited away). It takes the declaration's default. */
        std::vector<LoadProperty> retypedProperties;
    };

    // --- the bundle loader (neutral JsonValue -> compiled model) ---------------

    namespace bundleloader
    {
        /** A JSON scalar (bool / number / string / string[]) as a runtime value. */
        inline StoryletValue ToValue(const JsonValue& token)
        {
            switch (token.type)
            {
                case JsonValue::Bool: return StoryletValue::Bool(token.b);
                case JsonValue::Number: return StoryletValue::Num(token.num);
                case JsonValue::String: return StoryletValue::Str(token.str);
                case JsonValue::Array:
                {
                    std::vector<std::string> flags;
                    for (const auto& item : token.arr) flags.push_back(item.str);
                    return StoryletValue::Flags(std::move(flags));
                }
                default: throw StoryletError("unsupported scalar value kind");
            }
        }

        /** An { src, ast } envelope as a compiled Expression. */
        inline ExpressionPtr ToExpression(const JsonValue& token)
        {
            auto expr = std::make_shared<Expression>();
            expr->src = token.strOr("src");
            expr->ast = DeserialiseAst(token.at("ast"));
            return expr;
        }

        inline ExpressionPtr OptionalExpression(const JsonValue& obj, const std::string& key)
        {
            const JsonValue* v = obj.find(key);
            return v && !v->isNull() ? ToExpression(*v) : nullptr;
        }

        inline OrderedMap<std::string, std::string> ToStringMap(const JsonValue* token)
        {
            OrderedMap<std::string, std::string> map;
            if (!token || !token->isObject()) return map;
            for (const auto& pair : token->obj) map.set(pair.first, pair.second.str);
            return map;
        }

        inline std::optional<std::vector<std::string>> ParseStringList(const JsonValue* token)
        {
            if (!token || !token->isArray()) return std::nullopt;
            std::vector<std::string> list;
            for (const auto& item : token->arr) list.push_back(item.str);
            return list;
        }

        inline std::vector<PropertyDecl> ParsePropertyDecls(const JsonValue& arr)
        {
            std::vector<PropertyDecl> decls;
            for (const auto& item : arr.arr)
            {
                PropertyDecl d;
                d.name = item.strOr("name");
                d.type = item.strOr("type");
                const JsonValue* def = item.find("default");
                if (def && !def->isNull()) d.defaultValue = ToValue(*def);
                d.values = ParseStringList(item.find("values"));
                d.stages = ParseStringList(item.find("stages"));
                const JsonValue* sharedFlag = item.find("shared");
                if (sharedFlag && sharedFlag->isBool()) d.shared = sharedFlag->b;
                const JsonValue* durableFlag = item.find("durable");
                if (durableFlag && durableFlag->isBool()) d.durable = durableFlag->b;
                const JsonValue* writableFlag = item.find("writable");
                if (writableFlag && writableFlag->isBool()) d.writable = writableFlag->b;
                d.purpose = item.strOr("purpose");
                decls.push_back(std::move(d));
            }
            return decls;
        }

        inline FieldDecl ParseFieldDecl(const JsonValue& o)
        {
            FieldDecl d;
            d.name = o.strOr("name");
            d.type = o.strOr("type");
            const JsonValue* def = o.find("default");
            if (def && !def->isNull()) d.defaultValue = ToValue(*def);
            d.values = ParseStringList(o.find("values"));
            d.purpose = o.strOr("purpose");
            return d;
        }

        /** slots: number | "unbounded" (+infinity) | absent (nullopt). */
        inline std::optional<double> ParseSlots(const JsonValue* token)
        {
            if (!token || token->isNull()) return std::nullopt;
            if (token->isString() && token->str == "unbounded")
            {
                return std::numeric_limits<double>::infinity();
            }
            return token->num;
        }

        inline Outcome ParseOutcome(const JsonValue& o)
        {
            Outcome outcome;
            outcome.id = o.strOr("id");
            outcome.gameId = o.strOr("gameId");
            outcome.title = o.strOr("title");
            outcome.purpose = o.strOr("purpose");
            outcome.condition = OptionalExpression(o, "condition");
            const JsonValue* changes = o.find("changes");
            if (changes && changes->isObject())
            {
                for (const auto& pair : changes->obj) outcome.changes.set(pair.first, ToExpression(pair.second));
            }
            return outcome;
        }

        inline Card ParseCard(const JsonValue& o)
        {
            Card card;
            card.id = o.strOr("id");
            card.gameId = o.strOr("gameId");
            card.title = o.strOr("title");
            card.purpose = o.strOr("purpose");
            card.condition = OptionalExpression(o, "condition");
            const JsonValue* priority = o.find("priority");
            if (!priority || priority->isNull()) card.priorityNumber = 0;
            else if (priority->isObject()) card.priorityExpr = ToExpression(*priority);
            else card.priorityNumber = priority->num;
            const JsonValue* redraw = o.find("redraw");
            if (!redraw || redraw->isNull() || (redraw->isString() && redraw->str == "always"))
            {
                card.redraw = RedrawPolicy::Always();
            }
            else if (redraw->isString() && redraw->str == "never")
            {
                card.redraw = RedrawPolicy::Never();
            }
            else
            {
                card.redraw = RedrawPolicy::After(redraw->num);
            }
            const JsonValue* tags = o.find("tags");
            if (tags && tags->isObject())
            {
                for (const auto& pair : tags->obj)
                {
                    std::vector<std::string> ids;
                    for (const auto& id : pair.second.arr) ids.push_back(id.str);
                    card.tags.set(pair.first, std::move(ids));
                }
            }
            const JsonValue* copies = o.find("copies");
            if (copies && copies->isNumber()) card.copies = copies->num;
            const JsonValue* cardShared = o.find("shared");
            if (cardShared && cardShared->isBool()) card.shared = cardShared->b;
            const JsonValue* sharedCopies = o.find("sharedCopies");
            if (sharedCopies && sharedCopies->isNumber()) card.sharedCopies = sharedCopies->num;
            const JsonValue* cardDurable = o.find("durable");
            if (cardDurable && cardDurable->isBool()) card.durable = cardDurable->b;
            const JsonValue* fields = o.find("fields");
            if (fields && fields->isObject())
            {
                for (const auto& pair : fields->obj) card.fields.set(pair.first, ToValue(pair.second));
            }
            const JsonValue* outcomes = o.find("outcomes");
            if (outcomes && outcomes->isArray())
            {
                for (const auto& outcome : outcomes->arr) card.outcomes.push_back(ParseOutcome(outcome));
            }
            return card;
        }

        inline Deck ParseDeck(const JsonValue& o)
        {
            Deck deck;
            deck.id = o.strOr("id");
            deck.gameId = o.strOr("gameId");
            deck.title = o.strOr("title");
            deck.purpose = o.strOr("purpose");
            deck.condition = OptionalExpression(o, "condition");
            const JsonValue* deckShared = o.find("shared");
            if (deckShared && deckShared->isBool()) deck.shared = deckShared->b;
            const JsonValue* deckDurable = o.find("durable");
            if (deckDurable && deckDurable->isBool()) deck.durable = deckDurable->b;
            const JsonValue* props = o.find("properties");
            if (props && props->isArray()) deck.properties = ParsePropertyDecls(*props);
            const JsonValue* cards = o.find("cards");
            if (cards && cards->isArray())
            {
                for (const auto& c : cards->arr) deck.cards.push_back(ParseCard(c));
            }
            return deck;
        }

        inline TagGroup ParseTagGroup(const JsonValue& o)
        {
            TagGroup group;
            group.id = o.strOr("id");
            group.gameId = o.strOr("gameId");
            group.purpose = o.strOr("purpose");
            group.boundBy = o.strOr("boundBy");
            group.required = o.boolOr("required");
            const JsonValue* tags = o.find("tags");
            if (tags && tags->isArray())
            {
                for (const auto& t : tags->arr)
                {
                    Tag tag;
                    tag.id = t.strOr("id");
                    tag.gameId = t.strOr("gameId");
                    const JsonValue* props = t.find("properties");
                    if (props && props->isArray()) tag.properties = ParsePropertyDecls(*props);
                    group.tags.push_back(std::move(tag));
                }
            }
            return group;
        }

        inline HandTemplate ParseHandTemplate(const JsonValue& o)
        {
            HandTemplate t;
            t.id = o.strOr("id");
            t.gameId = o.strOr("gameId");
            t.title = o.strOr("title");
            t.purpose = o.strOr("purpose");
            t.bindings = ToStringMap(o.find("bindings"));
            t.condition = OptionalExpression(o, "condition");
            t.slots = ParseSlots(o.find("slots"));
            const JsonValue* chooses = o.find("chooses");
            if (chooses && chooses->isArray())
            {
                for (const auto& c : chooses->arr) t.chooses.push_back(c.str);
            }
            const JsonValue* props = o.find("properties");
            if (props && props->isArray()) t.properties = ParsePropertyDecls(*props);
            return t;
        }

        inline Hand ParseHand(const JsonValue& o)
        {
            Hand hand;
            hand.id = o.strOr("id");
            hand.gameId = o.strOr("gameId");
            hand.title = o.strOr("title");
            hand.purpose = o.strOr("purpose");
            hand.templateId = o.strOr("template");
            hand.chosen = ToStringMap(o.find("chosen"));
            const JsonValue* rule = o.find("rule");
            if (rule && rule->isObject())
            {
                auto r = std::make_shared<HandRule>();
                r->bindings = ToStringMap(rule->find("bindings"));
                r->condition = OptionalExpression(*rule, "condition");
                r->slots = ParseSlots(rule->find("slots"));
                hand.rule = std::move(r);
            }
            const JsonValue* slots = o.find("slots");
            if (slots && !slots->isNull()) hand.slots = slots->num;
            const JsonValue* props = o.find("properties");
            if (props && props->isArray()) hand.properties = ParsePropertyDecls(*props);
            return hand;
        }

        /** One shipped map. Absent on almost every bundle: geometry ships only
         *  when the build asked for it. */
        inline BundleMap ParseMap(const JsonValue& o)
        {
            BundleMap map;
            map.box = o.strOr("box");
            map.group = o.strOr("group");
            const JsonValue* zones = o.find("zones");
            if (zones && zones->isArray())
            {
                for (const auto& z : zones->arr)
                {
                    MapZone zone;
                    zone.tag = z.strOr("tag");
                    const JsonValue* points = z.find("polygon");
                    if (points && points->isArray())
                    {
                        for (const auto& p : points->arr)
                        {
                            zone.polygon.push_back(MapPoint{ p.numOr("x", 0), p.numOr("y", 0) });
                        }
                    }
                    map.zones.push_back(std::move(zone));
                }
            }
            const JsonValue* backgrounds = o.find("backgrounds");
            if (backgrounds && backgrounds->isArray())
            {
                for (const auto& g : backgrounds->arr)
                {
                    MapBackground background;
                    background.file = g.strOr("file");
                    background.x = g.numOr("x", 0);
                    background.y = g.numOr("y", 0);
                    background.width = g.numOr("width", 0);
                    background.height = g.numOr("height", 0);
                    background.opacity = g.numOr("opacity", 1);
                    map.backgrounds.push_back(std::move(background));
                }
            }
            const JsonValue* sites = o.find("sites");
            if (sites && sites->isArray())
            {
                for (const auto& s : sites->arr)
                {
                    MapSite site;
                    site.hand = s.strOr("hand");
                    site.x = s.numOr("x", 0);
                    site.y = s.numOr("y", 0);
                    map.sites.push_back(std::move(site));
                }
            }
            return map;
        }

        inline Box ParseBox(const JsonValue& o)
        {
            Box box;
            box.id = o.strOr("id");
            box.gameId = o.strOr("gameId");
            box.title = o.strOr("title");
            box.purpose = o.strOr("purpose");
            const JsonValue* ranking = o.find("ranking");
            if (ranking && ranking->isObject()) box.ranking.specificity = ranking->boolOr("specificity");
            const JsonValue* turn = o.find("turn");
            if (turn && turn->isObject()) box.turnSeconds = turn->numOr("seconds", 0);
            const JsonValue* fields = o.find("fields");
            if (fields && fields->isArray())
            {
                for (const auto& f : fields->arr) box.fields.push_back(ParseFieldDecl(f));
            }
            const JsonValue* props = o.find("properties");
            if (props && props->isArray()) box.properties = ParsePropertyDecls(*props);
            const JsonValue* groups = o.find("tagGroups");
            if (groups && groups->isArray())
            {
                for (const auto& g : groups->arr) box.tagGroups.push_back(ParseTagGroup(g));
            }
            const JsonValue* decks = o.find("decks");
            if (decks && decks->isArray())
            {
                for (const auto& d : decks->arr) box.decks.push_back(ParseDeck(d));
            }
            const JsonValue* templates = o.find("handTemplates");
            if (templates && templates->isArray())
            {
                for (const auto& t : templates->arr) box.handTemplates.push_back(ParseHandTemplate(t));
            }
            const JsonValue* hands = o.find("hands");
            if (hands && hands->isArray())
            {
                for (const auto& h : hands->arr) box.hands.push_back(ParseHand(h));
            }
            return box;
        }
    }

    /** Parse a compiled bundle from a neutral JsonValue tree (the asset path
     *  persists the raw JSON verbatim and rebuilds the compiled form on load). */
    inline BundlePtr ParseBundle(const JsonValue& b)
    {
        auto bundle = std::make_shared<Bundle>();
        bundle->schema = b.strOr("schema", BUNDLE_SCHEMA);
        bundle->metadata = b.strOr("metadata", "full");
        const JsonValue* content = b.find("content");
        if (content && content->isObject())
        {
            bundle->content.project = content->strOr("project");
            bundle->content.version = content->strOr("version");
            bundle->content.hash = content->strOr("hash");
        }
        const JsonValue* settings = b.find("settings");
        if (settings && settings->isObject() && settings->has("playAdvancesTurns"))
        {
            bundle->settings.playAdvancesTurns = settings->numOr("playAdvancesTurns", 1);
        }
        const JsonValue* world = b.find("world");
        if (world && world->isObject())
        {
            const JsonValue* props = world->find("properties");
            if (props && props->isArray()) bundle->world.properties = bundleloader::ParsePropertyDecls(*props);
        }
        const JsonValue* story = b.find("story");
        if (story && story->isObject())
        {
            const JsonValue* props = story->find("properties");
            if (props && props->isArray()) bundle->story.properties = bundleloader::ParsePropertyDecls(*props);
        }
        const JsonValue* boxes = b.find("boxes");
        if (boxes && boxes->isArray())
        {
            for (const auto& box : boxes->arr) bundle->boxes.push_back(bundleloader::ParseBox(box));
        }
        const JsonValue* maps = b.find("maps");
        if (maps && maps->isArray())
        {
            for (const auto& map : maps->arr) bundle->maps.push_back(bundleloader::ParseMap(map));
        }
        return bundle;
    }
}
