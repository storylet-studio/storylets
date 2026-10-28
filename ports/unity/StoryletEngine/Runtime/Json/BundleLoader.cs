// The Newtonsoft-touching layer: compiled-bundle (.storyletsc) and corpus JSON
// loading into the pure runtime model. In Unity this assembly rides
// com.unity.nuget.newtonsoft-json; the TestHost compiles it against the NuGet
// package, so the same loader is corpus-verified outside Unity.
//
// JSON object key order is significant to the reference runtime (bound tag
// composition, change-write order), and Newtonsoft's JObject preserves
// document order, which this loader carries into the model's OrderedMaps.

using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using Wildwinter.Expr;

namespace StoryletStudio.StoryletEngine
{
    public static class StoryletJson
    {
        /// <summary>A JSON scalar (bool / number / string / string[]) as a runtime value.</summary>
        public static ExprValue ToValue(JToken token)
        {
            switch (token.Type)
            {
                case JTokenType.Boolean: return ExprValue.Bool(token.Value<bool>());
                case JTokenType.Integer:
                case JTokenType.Float: return ExprValue.Num(token.Value<double>());
                case JTokenType.String: return ExprValue.Str(token.Value<string>());
                case JTokenType.Array:
                {
                    var flags = new List<string>();
                    foreach (var item in (JArray)token) flags.Add(item.Value<string>());
                    return ExprValue.Flags(flags);
                }
                default: throw new StoryletError($"unsupported scalar value kind: {token.Type}");
            }
        }

        /// <summary>Any JSON document as the core's neutral tree (objects as
        /// OrderedMap&lt;string, object&gt; in document order, arrays as
        /// List&lt;object&gt;, scalars as bool / double / string, JSON null as
        /// null) - the shape ScopeRegistry.ReadScopeRegistrySpec consumes.</summary>
        public static object ToJsonTree(JToken token) => ToTree(token, ast: false);

        /// <summary>A tagged-tuple AST (JSON array) as the neutral object tree the
        /// pure deserialiser walks, then as an ExprNode.</summary>
        public static ExprNode ToAst(JToken token)
        {
            // The kernel refuses a malformed tree with its own ExprError; a bundle
            // load throws EvalError, carrying the kernel's as its inner exception.
            try { return Ast.DeserialiseAst((IReadOnlyList<object>)ToTree(token, ast: true)); }
            catch (ExprError e) { throw new EvalError(e.Message, e); }
        }

        /// <summary>The one walk behind ToJsonTree and ToAst. An AST is tagged
        /// tuples of scalars, so with <paramref name="ast"/> an object or a null
        /// is refused as an unsupported AST token, as it always has been, rather
        /// than handed to the deserialiser.</summary>
        private static object ToTree(JToken token, bool ast)
        {
            switch (token.Type)
            {
                case JTokenType.Object when !ast:
                {
                    var map = new OrderedMap<string, object>();
                    foreach (var prop in (JObject)token) map.Set(prop.Key, ToTree(prop.Value, ast));
                    return map;
                }
                case JTokenType.Array:
                {
                    var list = new List<object>();
                    foreach (var item in (JArray)token) list.Add(ToTree(item, ast));
                    return list;
                }
                case JTokenType.Boolean: return token.Value<bool>();
                case JTokenType.Integer:
                case JTokenType.Float: return token.Value<double>();
                case JTokenType.String: return token.Value<string>();
                case JTokenType.Null when !ast: return null;
                default: throw new StoryletError($"unsupported {(ast ? "ast" : "json")} token kind: {token.Type}");
            }
        }

        /// <summary>An { src, ast } envelope as a compiled Expression.</summary>
        public static Expression ToExpression(JToken token)
        {
            var obj = (JObject)token;
            return new Expression
            {
                Src = obj.Value<string>("src"),
                Ast = ToAst(obj["ast"]),
            };
        }

        public static OrderedMap<string, string> ToStringMap(JToken token)
        {
            var map = new OrderedMap<string, string>();
            if (token == null) return map;
            foreach (var prop in (JObject)token) map.Set(prop.Key, prop.Value.Value<string>());
            return map;
        }
    }

    public static class BundleLoader
    {
        /// <summary>Parse a compiled bundle from raw JSON text (the Unity asset
        /// path persists the text verbatim and rebuilds the compiled form on load).</summary>
        public static Bundle Parse(string json)
        {
            return Parse(JToken.Parse(json));
        }

        /// <summary>Parse a compiled bundle already read as JSON. Anything but
        /// an object (`null`, a list, a string) is refused as not a bundle at
        /// all, as the engine refuses a null Bundle (the hands-on review,
        /// 2026-10, foundation 5).</summary>
        public static Bundle Parse(JToken token)
        {
            if (token is JObject b) return Parse(b);
            throw new StoryletError($"not a Storylets bundle: expected an object, got {Describe(token)}");
        }

        /// <summary>What a refused input was, for the message, in the JS
        /// reference's words: `null`, `an array`, `a string`.</summary>
        internal static string Describe(JToken token)
        {
            switch (token?.Type ?? JTokenType.Null)
            {
                case JTokenType.Null:
                case JTokenType.Undefined: return "null";
                case JTokenType.Array: return "an array";
                case JTokenType.Integer:
                case JTokenType.Float: return "a number";
                case JTokenType.Boolean: return "a boolean";
                default: return "a string";
            }
        }

        /// <summary>A part the bundle lacks (`content`, `boxes`, a scope's
        /// `properties`) is left null rather than defaulted, so the engine can
        /// refuse the bundle naming what it lacks instead of playing a cut-short
        /// file as an empty one.</summary>
        public static Bundle Parse(JObject b)
        {
            var bundle = new Bundle
            {
                // Carried as written, absent included: whether this runtime
                // can read it is the engine's question at construction
                // (design/project-map-contract.md 2.4, D4), not the loader's
                // to paper over with a default.
                Schema = b.Value<string>("schema"),
                Metadata = b.Value<string>("metadata") ?? "full",
            };
            var content = b["content"] as JObject;
            if (content != null)
            {
                bundle.Content.Project = content.Value<string>("project");
                bundle.Content.Version = content.Value<string>("version");
                bundle.Content.Hash = content.Value<string>("hash");
            }
            else bundle.Content = null;
            var settings = b["settings"] as JObject;
            if (settings == null) bundle.Settings = null;
            else if (settings["playAdvancesTurns"] != null)
            {
                bundle.Settings.PlayAdvancesTurns = settings.Value<double>("playAdvancesTurns");
            }
            var world = b["world"] as JObject;
            bundle.World.Properties = world?["properties"] is JArray worldProps ? ParsePropertyDecls(worldProps) : null;
            var story = b["story"] as JObject;
            bundle.Story.Properties = story?["properties"] is JArray storyProps ? ParsePropertyDecls(storyProps) : null;
            if (b["boxes"] is JArray boxes)
            {
                foreach (var box in boxes) bundle.Boxes.Add(ParseBox((JObject)box));
            }
            else bundle.Boxes = null;
            // Other engines' scopes the content names (`@patter.visits`): read
            // and written through the game's registry, and reported when no
            // engine registered one.
            if (b["externalScopes"] is JArray external)
            {
                bundle.ExternalScopes = new List<string>();
                foreach (var token in external) bundle.ExternalScopes.Add(token.Value<string>());
            }
            if (b["map"] is JObject map) bundle.Map = ParseProjectMap(map);
            // Storylet extensions: carried for the host, never read by the
            // engine. Absent leaves the bundle exactly as it was.
            if (b["extensions"] is JObject extensions) bundle.Extensions = ParseBundleExtensions(extensions);
            return bundle;
        }

        /// <summary>The project map (design/project-map-contract.md 2.1): the
        /// zone group, which the engine reads, and the geometry, which it never
        /// does and which ships only when the build asked for it.</summary>
        private static ProjectMap ParseProjectMap(JObject o)
        {
            var map = new ProjectMap
            {
                Group = o["group"] is JObject group ? ParseTagGroup(group) : null,
            };
            if (!(o["geometry"] is JObject g)) return map;
            var geometry = new MapGeometry();
            if (g["zones"] is JArray zones)
            {
                foreach (JObject z in zones)
                {
                    var zone = new MapZone { Tag = z.Value<string>("tag") };
                    if (z["polygon"] is JArray points)
                    {
                        foreach (JObject p in points)
                        {
                            zone.Polygon.Add(new MapPoint { X = p.Value<double>("x"), Y = p.Value<double>("y") });
                        }
                    }
                    geometry.Zones.Add(zone);
                }
            }
            if (g["backgrounds"] is JArray backgrounds)
            {
                foreach (JObject bg in backgrounds)
                {
                    geometry.Backgrounds.Add(new MapBackground
                    {
                        File = bg.Value<string>("file"),
                        X = bg.Value<double>("x"),
                        Y = bg.Value<double>("y"),
                        Width = bg.Value<double>("width"),
                        Height = bg.Value<double>("height"),
                        Opacity = bg["opacity"] != null ? bg.Value<double>("opacity") : 1,
                    });
                }
            }
            // Box gameId -> that box's placed hands, in the bundle's own key
            // order (sites stay per box: a hand belongs to one).
            if (g["sites"] is JObject sites)
            {
                foreach (var pair in sites)
                {
                    var list = new List<MapSite>();
                    if (pair.Value is JArray placed)
                    {
                        foreach (JObject s in placed)
                        {
                            list.Add(new MapSite
                            {
                                Hand = s.Value<string>("hand"),
                                X = s.Value<double>("x"),
                                Y = s.Value<double>("y"),
                            });
                        }
                    }
                    geometry.Sites.Set(pair.Key, list);
                }
            }
            map.Geometry = geometry;
            return map;
        }

        private static Box ParseBox(JObject o)
        {
            var box = new Box
            {
                Id = o.Value<string>("id"),
                GameId = o.Value<string>("gameId"),
                Title = o.Value<string>("title"),
                Purpose = o.Value<string>("purpose"),
            };
            // On the project map (design/project-map-contract.md 2.2). Absent
            // is "not on the map".
            box.UsesMap = o["usesMap"]?.Type == JTokenType.Boolean && o.Value<bool>("usesMap");
            var ranking = o["ranking"] as JObject;
            if (ranking != null) box.Ranking.Specificity = ranking.Value<bool>("specificity");
            var turn = o["turn"] as JObject;
            // No seconds is a clock the game moves on its own beat (a calendar).
            if (turn != null) box.Turn = new TurnUnit { Seconds = turn["seconds"] != null ? turn.Value<double>("seconds") : (double?)null };
            if (o["fields"] is JArray fields)
            {
                foreach (var f in fields) box.Fields.Add(ParseFieldDecl((JObject)f));
            }
            if (o["outcomeFields"] is JArray outcomeFields)
            {
                foreach (var f in outcomeFields) box.OutcomeFields.Add(ParseFieldDecl((JObject)f));
            }
            if (o["properties"] is JArray props) box.Properties = ParsePropertyDecls(props);
            if (o["tagGroups"] is JArray groups)
            {
                foreach (var g in groups) box.TagGroups.Add(ParseTagGroup((JObject)g));
            }
            if (o["decks"] is JArray decks)
            {
                foreach (var d in decks) box.Decks.Add(ParseDeck((JObject)d));
            }
            if (o["handTemplates"] is JArray templates)
            {
                foreach (var t in templates) box.HandTemplates.Add(ParseHandTemplate((JObject)t));
            }
            if (o["hands"] is JArray hands)
            {
                foreach (var h in hands) box.Hands.Add(ParseHand((JObject)h));
            }
            box.Extensions = ParseNodeExtensions(o["extensions"]);
            return box;
        }

        private static TagGroup ParseTagGroup(JObject o)
        {
            var group = new TagGroup
            {
                Id = o.Value<string>("id"),
                GameId = o.Value<string>("gameId"),
                Purpose = o.Value<string>("purpose"),
                BoundBy = o.Value<string>("boundBy"),
                Required = o.Value<bool?>("required") ?? false,
                Extensions = ParseNodeExtensions(o["extensions"]),
            };
            if (o["tags"] is JArray tags)
            {
                foreach (var t in tags)
                {
                    var tag = (JObject)t;
                    group.Tags.Add(new Tag
                    {
                        Id = tag.Value<string>("id"),
                        GameId = tag.Value<string>("gameId"),
                        Properties = tag["properties"] is JArray tagProps ? ParsePropertyDecls(tagProps) : null,
                        Extensions = ParseNodeExtensions(tag["extensions"]),
                    });
                }
            }
            return group;
        }

        private static Deck ParseDeck(JObject o)
        {
            var deck = new Deck
            {
                Id = o.Value<string>("id"),
                GameId = o.Value<string>("gameId"),
                Title = o.Value<string>("title"),
                Purpose = o.Value<string>("purpose"),
                Condition = o["condition"] != null ? StoryletJson.ToExpression(o["condition"]) : null,
                Shared = o["shared"] != null ? o.Value<bool>("shared") : (bool?)null,
                Durable = o["durable"] != null ? o.Value<bool>("durable") : (bool?)null,
                Extensions = ParseNodeExtensions(o["extensions"]),
            };
            if (o["properties"] is JArray props) deck.Properties = ParsePropertyDecls(props);
            if (o["cards"] is JArray cards)
            {
                foreach (var c in cards) deck.Cards.Add(ParseCard((JObject)c));
            }
            return deck;
        }

        private static Card ParseCard(JObject o)
        {
            var card = new Card
            {
                Id = o.Value<string>("id"),
                GameId = o.Value<string>("gameId"),
                Title = o.Value<string>("title"),
                Purpose = o.Value<string>("purpose"),
                Condition = o["condition"] != null ? StoryletJson.ToExpression(o["condition"]) : null,
            };
            var priority = o["priority"];
            if (priority == null) card.PriorityNumber = 0;
            else if (priority.Type == JTokenType.Object) card.PriorityExpr = StoryletJson.ToExpression(priority);
            else card.PriorityNumber = priority.Value<double>();
            var redraw = o["redraw"];
            if (redraw == null || (redraw.Type == JTokenType.String && redraw.Value<string>() == "always"))
            {
                card.Redraw = RedrawPolicy.Always;
            }
            else if (redraw.Type == JTokenType.String && redraw.Value<string>() == "never")
            {
                card.Redraw = RedrawPolicy.Never;
            }
            else
            {
                card.Redraw = RedrawPolicy.After(redraw.Value<double>());
            }
            if (o["tags"] is JObject tags)
            {
                card.Tags = new OrderedMap<string, List<string>>();
                foreach (var pair in tags)
                {
                    var ids = new List<string>();
                    foreach (var id in (JArray)pair.Value) ids.Add(id.Value<string>());
                    card.Tags.Set(pair.Key, ids);
                }
            }
            if (o["weight"] != null) card.Weight = o.Value<double>("weight");
            if (o["inOneHand"] != null) card.InOneHand = o.Value<double>("inOneHand");
            if (o["acrossHands"] != null) card.AcrossHands = o.Value<string>("acrossHands");
            if (o["copies"] != null) card.Copies = o.Value<double>("copies");
            if (o["shared"] != null) card.Shared = o.Value<bool>("shared");
            if (o["sharedCopies"] != null) card.SharedCopies = o.Value<double>("sharedCopies");
            if (o["durable"] != null) card.Durable = o.Value<bool>("durable");
            if (o["fields"] is JObject cardFields)
            {
                card.Fields = new OrderedMap<string, ExprValue>();
                foreach (var pair in cardFields) card.Fields.Set(pair.Key, StoryletJson.ToValue(pair.Value));
            }
            if (o["outcomes"] is JArray outcomes)
            {
                foreach (var outcome in outcomes) card.Outcomes.Add(ParseOutcome((JObject)outcome));
            }
            card.Extensions = ParseNodeExtensions(o["extensions"]);
            return card;
        }

        private static Outcome ParseOutcome(JObject o)
        {
            var outcome = new Outcome
            {
                Id = o.Value<string>("id"),
                GameId = o.Value<string>("gameId"),
                Title = o.Value<string>("title"),
                Purpose = o.Value<string>("purpose"),
                Condition = o["condition"] != null ? StoryletJson.ToExpression(o["condition"]) : null,
            };
            if (o["changes"] is JObject changes)
            {
                foreach (var pair in changes) outcome.Changes.Set(pair.Key, StoryletJson.ToExpression(pair.Value));
            }
            if (o["fields"] is JObject outcomeFields)
            {
                outcome.Fields = new OrderedMap<string, ExprValue>();
                foreach (var pair in outcomeFields) outcome.Fields.Set(pair.Key, StoryletJson.ToValue(pair.Value));
            }
            outcome.Extensions = ParseNodeExtensions(o["extensions"]);
            return outcome;
        }

        private static HandTemplate ParseHandTemplate(JObject o)
        {
            var template = new HandTemplate
            {
                Id = o.Value<string>("id"),
                GameId = o.Value<string>("gameId"),
                Title = o.Value<string>("title"),
                Purpose = o.Value<string>("purpose"),
                Bindings = o["bindings"] != null ? StoryletJson.ToStringMap(o["bindings"]) : null,
                Condition = o["condition"] != null ? StoryletJson.ToExpression(o["condition"]) : null,
                Slots = ParseSlots(o["slots"]),
            };
            if (o["chooses"] is JArray chooses)
            {
                template.Chooses = new List<string>();
                foreach (var c in chooses) template.Chooses.Add(c.Value<string>());
            }
            if (o["properties"] is JArray props) template.Properties = ParsePropertyDecls(props);
            template.Extensions = ParseNodeExtensions(o["extensions"]);
            return template;
        }

        private static Hand ParseHand(JObject o)
        {
            var hand = new Hand
            {
                Id = o.Value<string>("id"),
                GameId = o.Value<string>("gameId"),
                Title = o.Value<string>("title"),
                Purpose = o.Value<string>("purpose"),
                Template = o.Value<string>("template"),
                Chosen = o["chosen"] != null ? StoryletJson.ToStringMap(o["chosen"]) : null,
            };
            if (o["rule"] is JObject rule)
            {
                hand.Rule = new HandRule
                {
                    Bindings = rule["bindings"] != null ? StoryletJson.ToStringMap(rule["bindings"]) : null,
                    Condition = rule["condition"] != null ? StoryletJson.ToExpression(rule["condition"]) : null,
                    Slots = ParseSlots(rule["slots"]),
                };
            }
            if (o["slots"] != null) hand.Slots = o.Value<double>("slots");
            if (o["properties"] is JArray props) hand.Properties = ParsePropertyDecls(props);
            hand.Extensions = ParseNodeExtensions(o["extensions"]);
            return hand;
        }

        /// <summary>slots: number | "unbounded" (PositiveInfinity) | absent (null).</summary>
        private static double? ParseSlots(JToken token)
        {
            if (token == null) return null;
            if (token.Type == JTokenType.String && token.Value<string>() == "unbounded") return double.PositiveInfinity;
            return token.Value<double>();
        }

        private static List<PropertyDecl> ParsePropertyDecls(JArray arr)
        {
            var decls = new List<PropertyDecl>();
            foreach (var item in arr)
            {
                var o = (JObject)item;
                decls.Add(new PropertyDecl
                {
                    Name = o.Value<string>("name"),
                    Type = o.Value<string>("type"),
                    Default = o["default"] != null ? StoryletJson.ToValue(o["default"]) : null,
                    Values = ParseStringList(o["values"]),
                    Stages = ParseStringList(o["stages"]),
                    Shared = o["shared"] != null ? (bool?)o["shared"].Value<bool>() : null,
                    Durable = o["durable"] != null ? (bool?)o["durable"].Value<bool>() : null,
                    Writable = o["writable"] != null ? (bool?)o["writable"].Value<bool>() : null,
                    Purpose = o.Value<string>("purpose"),
                });
            }
            return decls;
        }

        private static FieldDecl ParseFieldDecl(JObject o)
        {
            return new FieldDecl
            {
                Name = o.Value<string>("name"),
                Type = o.Value<string>("type"),
                Default = o["default"] != null ? StoryletJson.ToValue(o["default"]) : null,
                Values = ParseStringList(o["values"]),
                Stages = ParseStringList(o["stages"]),
                Purpose = o.Value<string>("purpose"),
            };
        }

        /// <summary>The bundle's extensions section: each extension's version,
        /// its compiled declarations by node kind, the project node's values and
        /// its resolved settings,
        /// in document order.</summary>
        private static OrderedMap<string, BundleExtension> ParseBundleExtensions(JObject o)
        {
            var extensions = new OrderedMap<string, BundleExtension>();
            foreach (var pair in o)
            {
                if (!(pair.Value is JObject e)) throw new StoryletError($"extension {pair.Key} is not an object");
                var ext = new BundleExtension { Version = e.Value<string>("version") };
                if (e["fields"] is JObject fields)
                {
                    foreach (var kind in fields)
                    {
                        var decls = new List<ExtensionFieldDecl>();
                        if (kind.Value is JArray list) foreach (var d in list) decls.Add(ParseExtensionFieldDecl((JObject)d));
                        ext.Fields.Set(kind.Key, decls);
                    }
                }
                if (e["project"] is JObject project) ext.Project = (OrderedMap<string, object>)StoryletJson.ToJsonTree(project);
                // An old bundle's "settings" (removed 2026-10-20) are ignored.
                extensions.Set(pair.Key, ext);
            }
            return extensions;
        }

        /// <summary>One compiled extension field declaration. The default is any
        /// JSON, held as the neutral tree; an element declaration (`of`) may
        /// leave it out, which HasDefault records.</summary>
        private static ExtensionFieldDecl ParseExtensionFieldDecl(JObject o)
        {
            var decl = new ExtensionFieldDecl
            {
                Name = o.Value<string>("name"),
                Type = o.Value<string>("type"),
                HasDefault = o.ContainsKey("default"),
                Default = o["default"] != null ? StoryletJson.ToJsonTree(o["default"]) : null,
                Values = ParseStringList(o["values"]),
                Stages = ParseStringList(o["stages"]),
                To = o.Value<string>("to"),
                IdField = o.Value<string>("id"),
                Min = o["min"] != null ? o.Value<double>("min") : (double?)null,
                Max = o["max"] != null ? o.Value<double>("max") : (double?)null,
                Required = o["required"] != null ? o.Value<bool>("required") : (bool?)null,
            };
            if (o["fields"] is JArray fields)
            {
                decl.Fields = new List<ExtensionFieldDecl>();
                foreach (var f in fields) decl.Fields.Add(ParseExtensionFieldDecl((JObject)f));
            }
            if (o["key"] is JObject key) decl.Key = new ExtensionKeyDecl { Type = key.Value<string>("type"), To = key.Value<string>("to") };
            if (o["of"] is JObject of) decl.Of = ParseExtensionFieldDecl(of);
            return decl;
        }

        /// <summary>A node's extension values (extension id -> field -> value),
        /// raw as authored, as the neutral JSON tree. Null when the node has
        /// none.</summary>
        private static OrderedMap<string, OrderedMap<string, object>> ParseNodeExtensions(JToken token)
        {
            if (!(token is JObject o)) return null;
            var values = new OrderedMap<string, OrderedMap<string, object>>();
            foreach (var pair in o)
            {
                if (!(pair.Value is JObject fields)) throw new StoryletError($"extension values for {pair.Key} are not an object");
                values.Set(pair.Key, (OrderedMap<string, object>)StoryletJson.ToJsonTree(fields));
            }
            return values;
        }

        private static List<string> ParseStringList(JToken token)
        {
            if (!(token is JArray arr)) return null;
            var list = new List<string>();
            foreach (var item in arr) list.Add(item.Value<string>());
            return list;
        }
    }
}
