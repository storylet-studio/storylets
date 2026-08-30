// describeBundle - the bundle inspector's runtime half (design/engine-runtimes.md
// section 2, piece 6). Port of packages/runtime/src/describe.ts.
//
// A BUNDLE-level API, deliberately NOT a session method: it answers the
// integrator's question - "I dropped a .storyletsc into my project, what may
// my game code call?" - from the imported asset alone, with no session, no
// state and no game running. That makes the boundary rule (design 4) visible:
// hands are what deal() takes, tag groups + tags are what peek() criteria are
// drawn from, declared properties are what expressions read and a host may
// set. Card lists are deliberately absent: cards are the engine's business,
// counts are the orientation an integrator needs.
//
// Everything is in bundle order, so the description is deterministic and two
// runtimes render the same rows in the same sequence. The property scopes are
// the static twin of Session::listProperties(): the same stores, in the same
// order, before anything is instantiated (a hand instance carries its
// template's declarations, exactly as the session's hand bags do).
//
// std-only, no UE includes: the UE layer converts to Blueprint structs at the
// UObject boundary (StoryletBundle.h / StoryletTypes.h).
#pragma once

#include <cmath>
#include <limits>
#include <optional>
#include <string>
#include <vector>

#include "Storylets/Bundle.h"
#include "Storylets/StoryletValue.h"

namespace storylets
{
    /** What bundle this is: the staleness/identity triple plus the schema tag. */
    struct BundleIdentity
    {
        /** The bundle schema tag ("storylets/bundle@0"). */
        std::string schema;
        /** content.project - the project name a save must agree with. */
        std::string project;
        /** content.version - the authored bundle version. */
        std::string version;
        /** content.hash - hash32 over the canonical source shards (schema 2.8). */
        std::string hash;
        /** "full" | "stripped": whether authoring metadata (titles) survived. */
        std::string metadata;
    };

    /** One hand: the deal() surface. gameId is the name deal() is called with. */
    struct HandSummary
    {
        std::string gameId;
        /** Empty when the hand has no title. */
        std::string title;
        /** The owning box's gameId (peek's first argument for the same stock). */
        std::string box;
        /** The effective slot cap: the hand's override, else its template's or
         *  rule's, else +infinity ("unbounded"). */
        double slots = std::numeric_limits<double>::infinity();
        /** The hand template's gameId; empty for a standalone (inline-rule) hand. */
        std::string templateGameId;
    };

    /** One tag group and its tags, by gameId: the peek() criteria surface (a
     *  criteria entry is { group gameId: tag gameId }). */
    struct TagGroupSummary
    {
        std::string gameId;
        std::vector<std::string> tags;
    };

    /** Per-box counts: orientation, not inventory. */
    struct BoxCounts
    {
        int decks = 0;
        int cards = 0;
        int hands = 0;
        int templates = 0;
        int tagGroups = 0;
    };

    /** One box: identity, its ranking policy, its tag groups, and counts. */
    struct BoxSummary
    {
        std::string gameId;
        /** Empty when the box has no title. */
        std::string title;
        /** The only per-box ranking policy (Reboot 2.2). */
        bool rankingSpecificity = true;
        std::vector<TagGroupSummary> tagGroups;
        BoxCounts counts;
    };

    /** One declared property: what expressions read and what a host may set. */
    struct PropertySummary
    {
        std::string name;
        /** boolean / number / string / enum / flags. */
        std::string type;
        StoryletValue defaultValue;
        /** Enum / flags options, where declared. */
        std::vector<std::string> values;
        std::string purpose;
    };

    /** The scope kinds a declaration block can belong to. Tag declarations
     *  compose into @hand for any ask that binds the tag (schema 3.6). */
    namespace scopekind
    {
        inline const char* const World = "world";
        inline const char* const Story = "story";
        inline const char* const Box = "box";
        inline const char* const Deck = "deck";
        inline const char* const Hand = "hand";
        inline const char* const Tag = "tag";
    }

    /** One scope's declared properties. owner is the owning entity's gameId
     *  (empty for world / story); box names its box; group names a tag's group. */
    struct PropertyScopeSummary
    {
        std::string scope;
        std::string owner;
        /** Empty for world / story. */
        std::string box;
        /** Empty except on tag scopes. */
        std::string group;
        std::vector<PropertySummary> properties;
    };

    /** Whole-bundle counts: orientation, never card lists (Reboot 2.1). */
    struct BundleTotals
    {
        int boxes = 0;
        int decks = 0;
        int cards = 0;
        int hands = 0;
        int templates = 0;
        int tagGroups = 0;
    };

    /** What a bundle offers a host, read from the asset alone. */
    /** One map the bundle was asked to carry. Counts rather than the geometry:
     *  an inspector answers "what is in here", and a host that wants the
     *  polygons reads Bundle::maps directly. */
    struct MapSummary
    {
        std::string box;                        // the owning box, by gameId
        std::string group;                      // the tag group, by gameId
        int zones = 0;
        int backgrounds = 0;
    };

    struct BundleDescription
    {
        BundleIdentity identity;
        BundleTotals totals;
        std::vector<BoxSummary> boxes;
        /** Every hand in the bundle, box by box: the deal() surface. */
        std::vector<HandSummary> hands;
        /** world, story, then per box: the box, its decks, its hands, its tags.
         *  Scopes that declare nothing are omitted (world and story always
         *  show, so their absence reads as "this bundle declares none"). */
        std::vector<PropertyScopeSummary> properties;
        /** Maps carried as inert payload, when the build asked for them. Empty
         *  is the normal state. */
        std::vector<MapSummary> maps;
    };

    /** The slot cap as the inspectors show it ("unbounded" for the uncapped
     *  hand). */
    inline std::string SlotsLabel(double slots)
    {
        return std::isinf(slots) ? std::string("unbounded") : StoryletValue::JsNumber(slots);
    }

    /** The scope label a declaration block files under ("world", "box box",
     *  "tag docks (zone)"). */
    inline std::string ScopeLabel(const PropertyScopeSummary& scope)
    {
        if (scope.scope == scopekind::World || scope.scope == scopekind::Story) return scope.scope;
        std::string suffix = scope.group.empty() ? std::string() : " (" + scope.group + ")";
        return scope.scope + " " + scope.owner + suffix;
    }

    /** "name: type = default", plus enum/flags options where declared. */
    inline std::string PropertyLabel(const PropertySummary& p)
    {
        std::string options;
        if (!p.values.empty())
        {
            options = " [";
            for (size_t i = 0; i < p.values.size(); ++i)
            {
                if (i > 0) options += ", ";
                options += p.values[i];
            }
            options += "]";
        }
        return p.name + ": " + p.type + " = " + p.defaultValue.toJsonString() + options;
    }

    namespace describedetail
    {
        inline std::vector<PropertySummary> Summarise(const std::vector<PropertyDecl>& decls)
        {
            std::vector<PropertySummary> rows;
            for (const PropertyDecl& decl : decls)
            {
                PropertySummary row;
                row.name = decl.name;
                row.type = decl.type;
                if (decl.defaultValue.has_value()) row.defaultValue = *decl.defaultValue;
                if (decl.values.has_value()) row.values = *decl.values;
                row.purpose = decl.purpose;
                rows.push_back(std::move(row));
            }
            return rows;
        }

        inline const HandTemplate* TemplateOf(const Hand& hand, const Box& box)
        {
            if (hand.templateId.empty()) return nullptr;
            for (const HandTemplate& t : box.handTemplates)
            {
                if (t.id == hand.templateId) return &t;
            }
            return nullptr;
        }

        /** A hand's declared @hand state: a template instance inherits its
         *  template's declarations, a standalone hand declares its own
         *  (schema 2.6) - the same rule the session's hand bags are built on. */
        inline const std::vector<PropertyDecl>& HandDecls(const Hand& hand, const Box& box)
        {
            static const std::vector<PropertyDecl> none;
            if (!hand.templateId.empty())
            {
                const HandTemplate* t = TemplateOf(hand, box);
                return t ? t->properties : none;
            }
            return hand.properties;
        }

        /** The effective slot cap, resolved the way the session resolves
         *  capacity: the hand's override, else the template's or rule's, else
         *  unbounded. */
        inline double HandSlots(const Hand& hand, const HandTemplate* templatePtr)
        {
            if (hand.slots.has_value()) return *hand.slots;
            std::optional<double> declared;
            if (!hand.templateId.empty())
            {
                if (templatePtr) declared = templatePtr->slots;
            }
            else if (hand.rule)
            {
                declared = hand.rule->slots;
            }
            return declared.has_value() ? *declared : std::numeric_limits<double>::infinity();
        }

        inline void Push(BundleDescription& d, const char* scope, const std::string& owner,
            const std::string& box, const std::string& group, const std::vector<PropertyDecl>& decls)
        {
            if (decls.empty()) return;
            PropertyScopeSummary s;
            s.scope = scope;
            s.owner = owner;
            s.box = box;
            s.group = group;
            s.properties = Summarise(decls);
            d.properties.push_back(std::move(s));
        }
    }

    /** Describe a compiled bundle: the callable surface of an imported asset,
     *  no session required (design 2, piece 6). Bundle order throughout; the
     *  same shape every runtime returns. */
    inline BundleDescription describeBundle(const Bundle& bundle)
    {
        BundleDescription d;
        d.identity.schema = bundle.schema;
        d.identity.project = bundle.content.project;
        d.identity.version = bundle.content.version;
        d.identity.hash = bundle.content.hash;
        d.identity.metadata = bundle.metadata;

        PropertyScopeSummary world;
        world.scope = scopekind::World;
        world.properties = describedetail::Summarise(bundle.world.properties);
        d.properties.push_back(std::move(world));
        PropertyScopeSummary story;
        story.scope = scopekind::Story;
        story.properties = describedetail::Summarise(bundle.story.properties);
        d.properties.push_back(std::move(story));

        // Inert payload, and therefore worth saying out loud: a bundle that
        // silently carried a map would fail the promise this API makes.
        for (const BundleMap& map : bundle.maps)
        {
            MapSummary summary;
            summary.box = map.box;
            summary.group = map.group;
            summary.zones = static_cast<int>(map.zones.size());
            summary.backgrounds = static_cast<int>(map.backgrounds.size());
            d.maps.push_back(std::move(summary));
        }

        for (const Box& box : bundle.boxes)
        {
            const std::string boxGameId = EffectiveGameId(box);
            int cards = 0;
            for (const Deck& deck : box.decks) cards += static_cast<int>(deck.cards.size());

            BoxSummary summary;
            summary.gameId = boxGameId;
            summary.title = box.title;
            summary.rankingSpecificity = box.ranking.specificity;
            for (const TagGroup& group : box.tagGroups)
            {
                TagGroupSummary g;
                g.gameId = EffectiveGameId(group);
                for (const Tag& tag : group.tags) g.tags.push_back(EffectiveGameId(tag));
                summary.tagGroups.push_back(std::move(g));
            }
            summary.counts.decks = static_cast<int>(box.decks.size());
            summary.counts.cards = cards;
            summary.counts.hands = static_cast<int>(box.hands.size());
            summary.counts.templates = static_cast<int>(box.handTemplates.size());
            summary.counts.tagGroups = static_cast<int>(box.tagGroups.size());
            d.boxes.push_back(std::move(summary));

            d.totals.boxes += 1;
            d.totals.decks += static_cast<int>(box.decks.size());
            d.totals.cards += cards;
            d.totals.hands += static_cast<int>(box.hands.size());
            d.totals.templates += static_cast<int>(box.handTemplates.size());
            d.totals.tagGroups += static_cast<int>(box.tagGroups.size());

            for (const Hand& hand : box.hands)
            {
                const HandTemplate* templatePtr = describedetail::TemplateOf(hand, box);
                HandSummary h;
                h.gameId = EffectiveGameId(hand);
                h.title = hand.title;
                h.box = boxGameId;
                h.slots = describedetail::HandSlots(hand, templatePtr);
                if (templatePtr) h.templateGameId = EffectiveGameId(*templatePtr);
                d.hands.push_back(std::move(h));
            }

            // The property scopes, in the session's store order: box, decks,
            // hands, tags. Empty declaration blocks are dropped (nothing to
            // read or set).
            describedetail::Push(d, scopekind::Box, boxGameId, boxGameId, "", box.properties);
            for (const Deck& deck : box.decks)
            {
                describedetail::Push(d, scopekind::Deck, EffectiveGameId(deck), boxGameId, "", deck.properties);
            }
            for (const Hand& hand : box.hands)
            {
                describedetail::Push(d, scopekind::Hand, EffectiveGameId(hand), boxGameId, "",
                    describedetail::HandDecls(hand, box));
            }
            for (const TagGroup& group : box.tagGroups)
            {
                const std::string groupGameId = EffectiveGameId(group);
                for (const Tag& tag : group.tags)
                {
                    describedetail::Push(d, scopekind::Tag, EffectiveGameId(tag), boxGameId, groupGameId,
                        tag.properties);
                }
            }
        }
        return d;
    }
}
