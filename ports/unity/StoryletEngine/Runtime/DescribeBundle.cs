// DescribeBundle - the bundle inspector's runtime half (design/engine-runtimes.md
// section 2, piece 6). Port of packages/runtime/src/describe.ts.
//
// A BUNDLE-level API, deliberately NOT a session method: it answers the
// integrator's question - "I dropped a .storyletsc into my project, what may
// my game code call?" - from the imported asset alone, with no session, no
// state and no game running. That makes the boundary rule (design 4) visible:
// hands are what Deal() takes, tag groups + tags are what Peek() criteria are
// drawn from, declared properties are what expressions read and a host may
// set. Card lists are deliberately absent: cards are the engine's business,
// counts are the orientation an integrator needs.
//
// Everything is in bundle order, so the description is deterministic and two
// runtimes render the same rows in the same sequence. The property scopes are
// the static twin of Flow.ListProperties(): the same stores, in the same
// order, before anything is instantiated (a hand instance carries its
// template's declarations, exactly as the session's hand bags do).

using System.Collections.Generic;

namespace StoryletStudio.StoryletEngine
{
    /// <summary>What bundle this is: the staleness/identity triple plus the
    /// schema tag.</summary>
    public sealed class BundleIdentity
    {
        /// <summary>The bundle schema tag ("storylets/bundle@0").</summary>
        public string Schema;
        /// <summary>content.project - the project name a save must agree with.</summary>
        public string Project;
        /// <summary>content.version - the authored bundle version.</summary>
        public string Version;
        /// <summary>content.hash - hash32 over the canonical source shards.</summary>
        public string Hash;
        /// <summary>"full" | "stripped": whether authoring metadata survived.</summary>
        public string Metadata;
    }

    /// <summary>One hand: the Deal() surface. GameId is the name Deal() is
    /// called with.</summary>
    /// <summary>One hole this hand fills from a property rather than with a
    /// tag: the hand MOVES when that property is written
    /// (design/engine-server.md 4.6). Group is the tag group's gameId, From
    /// the reference exactly as authored.</summary>
    public sealed class MovableHole
    {
        public string Group;
        public string From;
    }

    public sealed class HandSummary
    {
        public string GameId;
        /// <summary>Null when the hand has no title.</summary>
        public string Title;
        /// <summary>The owning box's gameId (Peek's first argument for the same
        /// stock).</summary>
        public string Box;
        /// <summary>The effective slot cap: the hand's override, else its
        /// template's or rule's, else PositiveInfinity ("unbounded").</summary>
        public double Slots;
        /// <summary>The hand template's gameId; null for a standalone
        /// (inline-rule) hand.</summary>
        public string Template;
        /// <summary>The holes filled from a property, in bundle order; EMPTY
        /// when the hand has none, which is the ordinary case. It is the one
        /// thing about a hand its name cannot say: writing that property moves
        /// the hand, and SetProperty is the whole verb (4.6).</summary>
        public List<MovableHole> Movable = new List<MovableHole>();

        /// <summary>The slot cap as the inspectors show it ("unbounded" for the
        /// uncapped hand).</summary>
        public string SlotsLabel =>
            double.IsPositiveInfinity(Slots) ? "unbounded" : StoryletValue.JsNumber(Slots);
    }

    /// <summary>One tag group and its tags, by gameId: the Peek() criteria
    /// surface (a criteria entry is { group gameId: tag gameId }).</summary>
    public sealed class TagGroupSummary
    {
        public string GameId;
        public List<string> Tags = new List<string>();
    }

    /// <summary>Per-box counts: orientation, not inventory.</summary>
    public sealed class BoxCounts
    {
        public int Decks;
        public int Cards;
        public int Hands;
        public int Templates;
        public int TagGroups;
    }

    /// <summary>One box: identity, its ranking policy, its tag groups, counts.</summary>
    public sealed class BoxSummary
    {
        public string GameId;
        /// <summary>Null when the box has no title.</summary>
        public string Title;
        /// <summary>The only per-box ranking policy (Reboot 2.2).</summary>
        public bool RankingSpecificity;
        /// <summary>Set on a TIMED box (design/engine-server.md 4.8): how long one
        /// of its turns lasts. An integrator reading a bundle needs it to know
        /// which boxes their host must tick, and how often. Null is the ordinary
        /// box.</summary>
        public double? TurnSeconds;
        /// <summary>How many cards in this box are DURABLE (design/engine-server.md
        /// 4.2): their redraw:never spend outlives the run, so a server has to
        /// lift and restore it. Zero on the ordinary box.</summary>
        public int DurableCards;
        public List<TagGroupSummary> TagGroups = new List<TagGroupSummary>();
        public BoxCounts Counts = new BoxCounts();
    }

    /// <summary>One declared property: what expressions read and what a host
    /// may set.</summary>
    public sealed class PropertySummary
    {
        public string Name;
        /// <summary>boolean / number / string / enum / flags (PropertyTypes).</summary>
        public string Type;
        public StoryletValue Default;
        /// <summary>Enum / flags options, where declared (null otherwise).</summary>
        public List<string> Values;
        /// <summary>Declared DURABLE (design/engine-server.md 4.2): the value
        /// survives a run, and a server lifts and restores it across one. False
        /// is the ordinary run-scoped property.</summary>
        public bool Durable;
        public string Purpose;
    }

    /// <summary>The scope kinds a declaration block can belong to. Tag
    /// declarations compose into @hand for any ask that binds the tag
    /// (schema 3.6).</summary>
    public static class PropertyScopeKinds
    {
        public const string World = "world";
        public const string Story = "story";
        public const string Box = "box";
        public const string Deck = "deck";
        public const string Hand = "hand";
        public const string Tag = "tag";
    }

    /// <summary>One scope's declared properties. Owner is the owning entity's
    /// gameId (empty for world / story); Box names its box; Group names a tag's
    /// group.</summary>
    public sealed class PropertyScopeSummary
    {
        public string Scope;
        public string Owner = "";
        /// <summary>Null for world / story.</summary>
        public string Box;
        /// <summary>Null except on tag scopes.</summary>
        public string Group;
        public List<PropertySummary> Properties = new List<PropertySummary>();
    }

    /// <summary>Whole-bundle counts: orientation, never card lists (Reboot 2.1).</summary>
    public sealed class BundleTotals
    {
        public int Boxes;
        public int Decks;
        public int Cards;
        public int Hands;
        public int Templates;
        public int TagGroups;
    }

    /// <summary>What a bundle offers a host, read from the asset alone.</summary>
    /// <summary>One map the bundle was asked to carry. Counts rather than the
    /// geometry: an inspector answers "what is in here", and a host that wants
    /// the polygons reads Bundle.Maps directly.</summary>
    public sealed class MapSummary
    {
        /// <summary>The owning box, by gameId.</summary>
        public string Box;
        /// <summary>The tag group this is a map of, by gameId.</summary>
        public string Group;
        public int Zones;
        public int Backgrounds;
        /// <summary>Placed hands standing on this map: where the kiosks are
        /// (design/engine-server.md 4.3).</summary>
        public int Sites;
    }

    public sealed class BundleDescription
    {
        public BundleIdentity Identity = new BundleIdentity();
        public BundleTotals Totals = new BundleTotals();
        public List<BoxSummary> Boxes = new List<BoxSummary>();
        /// <summary>Every hand in the bundle, box by box: the Deal() surface.</summary>
        public List<HandSummary> Hands = new List<HandSummary>();
        /// <summary>world, story, then per box: the box, its decks, its hands,
        /// its tags. Scopes that declare nothing are omitted (world and story
        /// always show, so their absence reads as "this bundle declares
        /// none").</summary>
        public List<PropertyScopeSummary> Properties = new List<PropertyScopeSummary>();
        /// <summary>Maps carried as inert payload, when the build asked for
        /// them. Empty is the normal state.</summary>
        public List<MapSummary> Maps = new List<MapSummary>();
    }

    /// <summary>The bundle inspector's runtime half: authoring-time inspection
    /// of an imported asset, no session required.</summary>
    public static class BundleInspector
    {
        /// <summary>Describe a compiled bundle: the callable surface of an
        /// imported asset, no session required (design 2, piece 6). Bundle order
        /// throughout; the same shape every runtime returns.</summary>
        public static BundleDescription DescribeBundle(Bundle bundle)
        {
            var d = new BundleDescription();
            if (bundle == null) return d;

            d.Identity = new BundleIdentity
            {
                Schema = bundle.Schema,
                Project = bundle.Content?.Project,
                Version = bundle.Content?.Version,
                Hash = bundle.Content?.Hash,
                Metadata = bundle.Metadata,
            };
            d.Properties.Add(new PropertyScopeSummary
            {
                Scope = PropertyScopeKinds.World,
                Properties = Summarise(bundle.World?.Properties),
            });
            d.Properties.Add(new PropertyScopeSummary
            {
                Scope = PropertyScopeKinds.Story,
                Properties = Summarise(bundle.Story?.Properties),
            });
            // Inert payload, and therefore worth saying out loud: a bundle that
            // silently carried a map would fail the promise this API makes.
            if (bundle.Maps != null)
            {
                foreach (var map in bundle.Maps)
                {
                    d.Maps.Add(new MapSummary
                    {
                        Box = map.Box,
                        Group = map.Group,
                        Zones = map.Zones != null ? map.Zones.Count : 0,
                        Backgrounds = map.Backgrounds != null ? map.Backgrounds.Count : 0,
                        Sites = map.Sites != null ? map.Sites.Count : 0,
                    });
                }
            }

            foreach (var box in bundle.Boxes)
            {
                string boxGameId = Model.EffectiveGameId(box);
                int cards = 0;
                // Durable cards (4.2): the card's own flag, else its deck's -
                // the same inheritance Shared has.
                int durableCards = 0;
                foreach (var deck in box.Decks)
                {
                    cards += deck.Cards.Count;
                    foreach (var card in deck.Cards)
                    {
                        if ((card.Durable ?? deck.Durable) == true) durableCards++;
                    }
                }

                var summary = new BoxSummary
                {
                    GameId = boxGameId,
                    Title = box.Title,
                    RankingSpecificity = box.Ranking != null && box.Ranking.Specificity,
                    TurnSeconds = box.Turn != null ? box.Turn.Seconds : (double?)null,
                    DurableCards = durableCards,
                    Counts = new BoxCounts
                    {
                        Decks = box.Decks.Count,
                        Cards = cards,
                        Hands = box.Hands.Count,
                        Templates = box.HandTemplates.Count,
                        TagGroups = box.TagGroups.Count,
                    },
                };
                foreach (var group in box.TagGroups)
                {
                    var g = new TagGroupSummary { GameId = Model.EffectiveGameId(group) };
                    foreach (var tag in group.Tags) g.Tags.Add(Model.EffectiveGameId(tag));
                    summary.TagGroups.Add(g);
                }
                d.Boxes.Add(summary);

                d.Totals.Boxes++;
                d.Totals.Decks += box.Decks.Count;
                d.Totals.Cards += cards;
                d.Totals.Hands += box.Hands.Count;
                d.Totals.Templates += box.HandTemplates.Count;
                d.Totals.TagGroups += box.TagGroups.Count;

                foreach (var hand in box.Hands)
                {
                    var template = TemplateOf(hand, box);
                    d.Hands.Add(new HandSummary
                    {
                        GameId = Model.EffectiveGameId(hand),
                        Title = hand.Title,
                        Box = boxGameId,
                        Slots = HandSlots(hand, template),
                        Template = template != null ? Model.EffectiveGameId(template) : null,
                        Movable = MovableHoles(hand, box),
                    });
                }

                // The property scopes, in the session's store order: box,
                // decks, hands, tags. Empty declaration blocks are dropped
                // (nothing to read or set).
                Push(d, PropertyScopeKinds.Box, boxGameId, boxGameId, null, box.Properties);
                foreach (var deck in box.Decks)
                {
                    Push(d, PropertyScopeKinds.Deck, Model.EffectiveGameId(deck), boxGameId, null, deck.Properties);
                }
                foreach (var hand in box.Hands)
                {
                    Push(d, PropertyScopeKinds.Hand, Model.EffectiveGameId(hand), boxGameId, null,
                        HandDecls(hand, box));
                }
                foreach (var group in box.TagGroups)
                {
                    string groupGameId = Model.EffectiveGameId(group);
                    foreach (var tag in group.Tags)
                    {
                        Push(d, PropertyScopeKinds.Tag, Model.EffectiveGameId(tag), boxGameId, groupGameId,
                            tag.Properties);
                    }
                }
            }
            return d;
        }

        private static void Push(BundleDescription d, string scope, string owner, string box, string group,
            List<PropertyDecl> decls)
        {
            if (decls == null || decls.Count == 0) return;
            d.Properties.Add(new PropertyScopeSummary
            {
                Scope = scope,
                Owner = owner,
                Box = box,
                Group = group,
                Properties = Summarise(decls),
            });
        }

        private static List<PropertySummary> Summarise(List<PropertyDecl> decls)
        {
            var rows = new List<PropertySummary>();
            if (decls == null) return rows;
            foreach (var decl in decls)
            {
                rows.Add(new PropertySummary
                {
                    Name = decl.Name,
                    Type = decl.Type,
                    Default = decl.Default,
                    Values = decl.Values,
                    Durable = decl.Durable == true,
                    Purpose = decl.Purpose,
                });
            }
            return rows;
        }

        private static HandTemplate TemplateOf(Hand hand, Box box)
        {
            if (string.IsNullOrEmpty(hand.Template)) return null;
            foreach (var t in box.HandTemplates)
            {
                if (t.Id == hand.Template) return t;
            }
            return null;
        }

        /// <summary>A hand's declared @hand state: a template instance inherits
        /// its template's declarations, a standalone hand declares its own
        /// (schema 2.6) - the same rule the session's hand bags are built on.</summary>
        private static List<PropertyDecl> HandDecls(Hand hand, Box box)
        {
            var template = TemplateOf(hand, box);
            if (!string.IsNullOrEmpty(hand.Template)) return template?.Properties;
            return hand.Properties;
        }

        /// <summary>The hand's movable holes, in the bundle's own key order:
        /// every Chosen / rule-binding value that is a property reference
        /// rather than a tag (4.6). A group id the bundle does not carry is
        /// skipped: the description speaks gameIds throughout.</summary>
        private static List<MovableHole> MovableHoles(Hand hand, Box box)
        {
            var filled = !string.IsNullOrEmpty(hand.Template) ? hand.Chosen : hand.Rule?.Bindings;
            var holes = new List<MovableHole>();
            if (filled == null) return holes;
            foreach (var pair in filled)
            {
                if (!Model.IsHoleRef(pair.Value)) continue;
                var group = box.TagGroups.Find(g => g.Id == pair.Key);
                if (group == null) continue;
                holes.Add(new MovableHole { Group = Model.EffectiveGameId(group), From = pair.Value });
            }
            return holes;
        }

        /// <summary>The effective slot cap, resolved the way the session
        /// resolves capacity: the hand's override, else the template's or
        /// rule's, else unbounded.</summary>
        private static double HandSlots(Hand hand, HandTemplate template)
        {
            if (hand.Slots.HasValue) return hand.Slots.Value;
            double? declared = !string.IsNullOrEmpty(hand.Template)
                ? template?.Slots
                : hand.Rule?.Slots;
            return declared ?? double.PositiveInfinity;
        }
    }
}
