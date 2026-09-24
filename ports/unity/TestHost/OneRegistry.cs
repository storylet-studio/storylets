// One registry per game (patterkit design/one-registry-handover.md), from the
// GAME's side: what the engine puts in the registry, what the game saves, and
// that loading works in either order and from a version 1 envelope. A port of
// packages/runtime/test/one-registry.test.ts, case for case, plus the wire
// shape of storylets/save@2 as this runtime writes and reads it.
//
// The bundle is the JS test's, expanded by the conformance scaffold
// (expandBundle), so the keys and values below are the ones the JS test pins.

using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using StoryletStudio.StoryletEngine;
using Wildwinter.Expr;

namespace StoryletStudio.StoryletEngine.TestHost
{
    internal static class OneRegistry
    {
        /// <summary>packages/runtime/test/one-registry.test.ts's bundle, through
        /// expandBundle: world `alarm`; story `gold` (shared) and `steps` (each
        /// flow's own); deck k_main (gameId main) with `drawn` per flow and the
        /// card c_heist (outcome o_go) bumping all four; hand h_q (gameId q); and
        /// the scaffold's box b_x, whose tag v_docks declares `danger`.</summary>
        private const string BundleJson = @"
{""schema"":""storylets/bundle@0"",""content"":{""project"":""conf"",""version"":""0.0.0"",""hash"":""""},""metadata"":""full"",""settings"":{""playAdvancesTurns"":1},""world"":{""properties"":[{""name"":""alarm"",""type"":""number"",""default"":0}]},""story"":{""properties"":[{""name"":""gold"",""type"":""number"",""default"":0},{""name"":""steps"",""type"":""number"",""default"":0,""shared"":false}]},""boxes"":[{""id"":""b_x"",""gameId"":""box"",""ranking"":{""specificity"":true},""fields"":[],""properties"":[],""tagGroups"":[{""id"":""d_zone"",""gameId"":""zone"",""tags"":[{""id"":""v_docks"",""gameId"":""docks"",""properties"":[{""name"":""danger"",""type"":""number"",""default"":0}]},{""id"":""v_market"",""gameId"":""market""}]}],""decks"":[{""id"":""k_main"",""gameId"":""main"",""properties"":[{""name"":""drawn"",""type"":""number"",""default"":0}],""cards"":[{""id"":""c_heist"",""gameId"":""heist"",""priority"":0,""redraw"":""always"",""outcomes"":[{""id"":""o_go"",""gameId"":""go"",""changes"":{""@deck.drawn"":{""src"":""@deck.drawn + 1"",""ast"":[""bin"",""+"",[""sv"",""deck"",""drawn""],[""n"",1]]},""@story.gold"":{""src"":""@story.gold + 1"",""ast"":[""bin"",""+"",[""sv"",""story"",""gold""],[""n"",1]]},""@story.steps"":{""src"":""@story.steps + 1"",""ast"":[""bin"",""+"",[""sv"",""story"",""steps""],[""n"",1]]},""@world.alarm"":{""src"":""@world.alarm + 1"",""ast"":[""bin"",""+"",[""sv"",""world"",""alarm""],[""n"",1]]}}}]}]}],""handTemplates"":[],""hands"":[{""id"":""h_q"",""gameId"":""q"",""rule"":{""slots"":""unbounded""}}]}]}";

        private static Bundle NewBundle() => BundleLoader.Parse(BundleJson);

        private static void Heist(Flow flow)
        {
            var dealt = flow.Deal("q");
            flow.Play(dealt[0].GameId, "go", "q");
        }

        /// <summary>A game that owns its registry and registers @world itself, as
        /// a property the registry stores.</summary>
        private sealed class Game
        {
            public ScopeRegistry Registry;
            public Engine Engine;
        }

        private static Game NewGame()
        {
            var registry = new ScopeRegistry().DefineOwned("world",
                new List<ScopeDeclaration> { new ScopeDeclaration { Name = "alarm", Type = "number", Default = ExprValue.Num(0) } },
                new OwnedScopeOptions { Owner = "Game" });
            return new Game { Registry = registry, Engine = new Engine(NewBundle(), new EngineOptions { Registry = registry, Seed = 1 }) };
        }

        // --- assertions ------------------------------------------------------------

        private sealed class Failed : Exception
        {
            public Failed(string message) : base(message) { }
        }

        private static void Check(bool ok, string what)
        {
            if (!ok) throw new Failed(what);
        }

        private static void Num(ExprValue v, double want, string what)
        {
            if (v == null || !v.IsNumber || v.AsNumber != want) throw new Failed($"{what}: expected {want}, got {(v == null ? "nothing" : v.ToJsonString())}");
        }

        /// <summary>A refusal the engine must throw as ITS OWN type (exactly T, not a
        /// subclass and never the kernel's ExprError or RegistryError), carrying the
        /// kernel's message.</summary>
        private static void ThrowsExactly<T>(Action act, string contains, string what) where T : Exception
        {
            try { act(); }
            catch (Exception e)
            {
                if (e.GetType() != typeof(T)) throw new Failed($"{what}: threw {e.GetType().Name} \"{e.Message}\", expected {typeof(T).Name}");
                if (!e.Message.Contains(contains)) throw new Failed($"{what}: threw \"{e.Message}\", expected \"{contains}\"");
                return;
            }
            throw new Failed($"{what}: did not throw");
        }

        private static void Throws(Action act, string contains, string what)
        {
            try { act(); }
            catch (StoryletError e)
            {
                if (!e.Message.Contains(contains)) throw new Failed($"{what}: threw \"{e.Message}\", expected \"{contains}\"");
                return;
            }
            throw new Failed($"{what}: did not throw");
        }

        /// <summary>JS-style number token (integral doubles as integers), so a
        /// blob and an expectation written as JSON compare like the JS toEqual.</summary>
        private static JToken Token(ExprValue v)
        {
            if (v.IsBool) return new JValue(v.AsBool);
            if (v.IsNumber) return v.AsNumber == Math.Floor(v.AsNumber) ? new JValue((long)v.AsNumber) : new JValue(v.AsNumber);
            if (v.IsString) return new JValue(v.AsString);
            return new JArray(v.AsFlags.Cast<object>().ToArray());
        }

        private static JObject Blob(OrderedMap<string, OrderedMap<string, ExprValue>> blob)
        {
            var o = new JObject();
            foreach (var section in blob)
            {
                var values = new JObject();
                foreach (var pair in section.Value) values[pair.Key] = Token(pair.Value);
                o[section.Key] = values;
            }
            return o;
        }

        /// <summary>Key order does not matter (the JS test's toEqual); every key
        /// and value does.</summary>
        private static void Same(JToken actual, string expectedJson, string what)
        {
            actual = actual ?? JValue.CreateNull();   // a missing section reads as null, not a crash
            var expected = JToken.Parse(expectedJson);
            if (!JToken.DeepEquals(actual, expected))
            {
                throw new Failed($"{what}: expected {expected.ToString(Newtonsoft.Json.Formatting.None)}, got {actual.ToString(Newtonsoft.Json.Formatting.None)}");
            }
        }

        private static string Wire(SaveEnvelope envelope) => StoryletSave.ToJson(envelope).ToString(Newtonsoft.Json.Formatting.None);

        private static SaveEnvelope Reread(SaveEnvelope envelope) => StoryletSave.FromJson(JObject.Parse(Wire(envelope)));

        // --- the cases -------------------------------------------------------------

        private static readonly List<(string Name, Action Run)> Cases = new List<(string, Action)>
        {
            ("registers every bag that declares something, under the engine's keys and owner label", () =>
            {
                var g = NewGame();
                Heist(g.Engine.OpenFlow("f"));
                Same(Blob(g.Registry.Save()), @"{
                    ""world"": { ""alarm"": 1 },
                    ""story"": { ""gold"": 1 },
                    ""storylets/flow/f/story"": { ""steps"": 1 },
                    ""storylets/flow/f/deck/k_main"": { ""drawn"": 1 },
                    ""storylets/flow/f/value/v_docks"": { ""danger"": 0 }
                }", "registry.Save()");
                var rows = g.Registry.ListProperties().Where(r => r.Owner == "Storylet Engine")
                    .Select(r => $"{r.Scope} {r.Path} {r.Value.ToJsonString()}").ToList();
                var want = new List<string>
                {
                    "story story.gold 1",
                    "storylets/flow/f/story story.steps 1",
                    "storylets/flow/f/deck/k_main deck.main.drawn 1",
                    "storylets/flow/f/value/v_docks value.docks.danger 0",
                };
                Check(rows.SequenceEqual(want), "owner rows: " + string.Join(" | ", rows));
            }),

            ("leaves the values out of SaveGame when the game passed the registry", () =>
            {
                var g = NewGame();
                Heist(g.Engine.OpenFlow("f"));
                var save = g.Engine.SaveGame();
                Check(save.Registry == null, "save.Registry is set");
                Check(save.Shared.Props == null && save.Shared.Spent.Count == 0, "save.Shared is not { spent: [] }");
                Check(save.Flows.GetOrDefault("f").Props == null, "flow f carries props");
                var wire = StoryletSave.ToJson(save);
                Check(wire["registry"] == null, "the wire carries registry");
                Same(wire["shared"], @"{ ""spent"": [] }", "the wire's shared");
                Check(wire["flows"]["f"]["props"] == null, "the wire's flow carries props");
            }),

            ("does not self-back @world in the game's registry: that token is the game's", () =>
            {
                var registry = new ScopeRegistry();
                new Engine(NewBundle(), new EngineOptions { Registry = registry });
                Check(registry.Has("story"), "story is not registered");
                Check(!registry.Has("world"), "world is registered");
            }),

            ("a standalone engine self-backs @world as a stored property, and a save round-trips exactly", () =>
            {
                var engine = new Engine(NewBundle(), new EngineOptions { Seed = 1 });
                Heist(engine.OpenFlow("f"));
                var save = Reread(engine.SaveGame());
                Same(Blob(save.Registry), @"{
                    ""story"": { ""gold"": 1 }, ""world"": { ""alarm"": 1 },
                    ""storylets/flow/f/story"": { ""steps"": 1 },
                    ""storylets/flow/f/deck/k_main"": { ""drawn"": 1 },
                    ""storylets/flow/f/value/v_docks"": { ""danger"": 0 }
                }", "save.Registry");
                var restored = new Engine(NewBundle(), new EngineOptions { Seed = 1 });
                var report = restored.LoadGame(save);
                Check(report.Exact, "the report is not exact");
                Num(restored.GetProperty("world.alarm"), 1, "world.alarm");
                Num(restored.GetFlow("f").GetProperty("deck.main.drawn"), 1, "deck.main.drawn");
                Same(StoryletSave.ToJson(restored.SaveGame()), Wire(save), "the restored engine's save");
            }),

            ("one save for the game: registry first, then the engine", () =>
            {
                var save = Session1();
                var g = NewGame();
                StoryletSave.LoadRegistry(g.Registry, save.RegistryJson);
                g.Engine.LoadGame(save.Storylets);
                CheckResumed(g);
            }),

            ("one save for the game: the engine first, then the registry", () =>
            {
                var save = Session1();
                var g = NewGame();
                g.Engine.LoadGame(save.Storylets);
                StoryletSave.LoadRegistry(g.Registry, save.RegistryJson);
                CheckResumed(g);
            }),

            ("one save for the game: into a game already playing, flows the save lacks leave nothing behind", () =>
            {
                var save = Session1();
                var g = NewGame();
                var live = g.Engine.OpenFlow("f");
                Heist(live); Heist(live);                // live values the save's must replace
                Heist(g.Engine.OpenFlow("stray"));      // not in the save: its bags must not survive
                StoryletSave.LoadRegistry(g.Registry, save.RegistryJson);
                g.Engine.LoadGame(save.Storylets);
                CheckResumed(g);
                var strays = g.Registry.Save().Keys.Where(k => k.Contains("stray")).ToList();
                Check(strays.Count == 0, "stray keys survived: " + string.Join(", ", strays));
            }),

            ("a version 1 envelope still loads, its values moving into the registry", () =>
            {
                var engine = new Engine(NewBundle(), new EngineOptions { Seed = 1 });
                Check(engine.LoadGame(V1()).Exact, "the report is not exact");
                Num(engine.GetProperty("story.gold"), 4, "story.gold");
                Num(engine.GetFlow("f").GetProperty("deck.main.drawn"), 3, "deck.main.drawn");
                Same(Blob(engine.SaveGame().Registry), @"{
                    ""story"": { ""gold"": 4 }, ""world"": { ""alarm"": 0 },
                    ""storylets/flow/f/story"": { ""steps"": 2 },
                    ""storylets/flow/f/deck/k_main"": { ""drawn"": 3 },
                    ""storylets/flow/f/value/v_docks"": { ""danger"": 1 }
                }", "the registry after the load");
            }),

            ("a version 1 envelope loads into the game's registry beside values the game already loaded", () =>
            {
                var registry = new ScopeRegistry();
                registry.Load(Sections(@"{ ""another-engine/flow/x/scene/s"": { ""mood"": 2 } }"));
                var engine = new Engine(NewBundle(), new EngineOptions { Registry = registry, Seed = 1 });
                engine.LoadGame(V1());
                Same(Blob(registry.Save()), @"{
                    ""story"": { ""gold"": 4 },
                    ""storylets/flow/f/story"": { ""steps"": 2 },
                    ""storylets/flow/f/deck/k_main"": { ""drawn"": 3 },
                    ""storylets/flow/f/value/v_docks"": { ""danger"": 1 },
                    ""another-engine/flow/x/scene/s"": { ""mood"": 2 }
                }", "registry.Save()");
            }),

            ("a version 1 envelope still reports drift in the values it moves", () =>
            {
                var engine = new Engine(NewBundle(), new EngineOptions { Seed = 1 });
                var report = engine.LoadGame(V1(@"{ ""gold"": ""lots"", ""retired"": 1 }"));
                Check(string.Join(",", report.RetypedProperties.Select(p => p.Path)) == "story.gold", "retyped: " + string.Join(",", report.RetypedProperties.Select(p => p.Path)));
                Check(string.Join(",", report.DroppedProperties.Select(p => p.Path)) == "story.retired", "dropped: " + string.Join(",", report.DroppedProperties.Select(p => p.Path)));
                Num(engine.GetProperty("story.gold"), 0, "story.gold (a misfit keeps the default)");
            }),

            ("a .storyletsave whose envelope is version 1 still deserialises", () =>
            {
                var engine = new Engine(NewBundle(), new EngineOptions { Seed = 1 });
                var file = new JObject { ["schema"] = Model.SAVEFILE_SCHEMA, ["engine"] = JObject.Parse(V1Json(@"{ ""gold"": 4 }")) };
                StoryletSave.DeserializeState(engine, file.ToString());
                Num(engine.GetProperty("story.gold"), 4, "story.gold");
                Throws(() => engine.LoadGame(new SaveEnvelope { Schema = "storylets/save@9", Content = engine.SaveGame().Content }),
                    "unsupported save schema: storylets/save@9", "an unknown envelope schema");
            }),

            ("SaveFlow parks a flow whole, properties included, and a resume puts them back", () =>
            {
                var g = NewGame();
                Heist(g.Engine.OpenFlow("f"));
                var parked = g.Engine.SaveFlow("f");
                Check(parked.Props != null && Blob(parked.Props.Deck).ToString(Newtonsoft.Json.Formatting.None) == @"{""k_main"":{""drawn"":1}}", "parked deck props");
                g.Engine.CloseFlow("f");
                Check(!g.Registry.Save().Keys.Any(k => k.StartsWith("storylets/flow/f/", StringComparison.Ordinal)), "flow f's keys outlived CloseFlow");
                var back = g.Engine.OpenFlow("f", new OpenFlowOptions { Restore = parked });
                Num(back.GetProperty("deck.main.drawn"), 1, "deck.main.drawn");
            }),

            ("a fresh flow never claims values a load left for its name", () =>
            {
                var g = NewGame();
                g.Registry.Load(Sections(@"{ ""storylets/flow/f/deck/k_main"": { ""drawn"": 9 } }"));
                Num(g.Engine.OpenFlow("f").GetProperty("deck.main.drawn"), 0, "deck.main.drawn");
            }),

            ("Reset drops this engine's waiting values and no other engine's", () =>
            {
                var g = NewGame();
                var blob = g.Registry.Save();
                foreach (var pair in Sections(@"{ ""storylets/flow/z/story"": { ""steps"": 5 }, ""other/deck/inn"": { ""drawn"": 1 } }")) blob.Set(pair.Key, pair.Value);
                g.Registry.Load(blob);
                g.Engine.Reset();
                var after = g.Registry.Save();
                Check(after.GetOrDefault("storylets/flow/z/story") == null, "storylets/flow/z/story survived Reset");
                Check(after.GetOrDefault("other/deck/inn") != null, "other/deck/inn was dropped by Reset");
                Same(Blob(after)["other/deck/inn"], @"{ ""drawn"": 1 }", "other/deck/inn");
            }),

            ("refuses a token another engine holds, naming it, and leaves the registry as it was", () =>
            {
                var registry = new ScopeRegistry();
                new Engine(NewBundle(), new EngineOptions { Registry = registry });
                Throws(() => new Engine(NewBundle(), new EngineOptions { Registry = registry }),
                    "scope '@story' is already registered by Storylet Engine", "a second engine");

                var withWorld = new ScopeRegistry().DefineOwned("world", new List<ScopeDeclaration>(), new OwnedScopeOptions { Owner = "Game" });
                Throws(() => new Engine(NewBundle(), new EngineOptions { Registry = withWorld, World = new ZeroWorld() }),
                    "scope '@world' is already registered by Game", "a resolver for a registered @world");
                Check(!withWorld.Has("story"), "the failed engine left story registered");
            }),

            // The kernel throws its own ExprError / RegistryError; every place the
            // engine calls it, the game must still see the engine's own type, with
            // the kernel's message. One case per rethrow site.
            ("a story write the game's @world refuses is a StoryletError (WorldSet)", () =>
            {
                var registry = new ScopeRegistry().DefineOwned("world",
                    new List<ScopeDeclaration> { new ScopeDeclaration { Name = "alarm", Type = "number", Default = ExprValue.Num(0), Writable = false } },
                    new OwnedScopeOptions { Owner = "Game" });
                var engine = new Engine(NewBundle(), new EngineOptions { Registry = registry, Seed = 1 });
                ThrowsExactly<StoryletError>(() => Heist(engine.OpenFlow("f")), "'@world.alarm' is read-only", "the outcome's @world write");
            }),

            ("a story write to a read-only @story property is a StoryletError (outcome write)", () =>
            {
                var json = BundleJson.Replace(@"{""name"":""gold"",""type"":""number"",""default"":0}",
                    @"{""name"":""gold"",""type"":""number"",""default"":0,""writable"":false}");
                Check(json != BundleJson, "the fixture did not mark gold read-only");
                var engine = new Engine(BundleLoader.Parse(json), new EngineOptions { Seed = 1 });
                ThrowsExactly<StoryletError>(() => Heist(engine.OpenFlow("f")), "'gold' is read-only", "the outcome's @story write");
            }),

            ("a malformed expression in a bundle is an EvalError (AST load)", () =>
            {
                var json = BundleJson.Replace(@"[""n"",1]", @"[""zz"",1]");
                Check(json != BundleJson, "the fixture did not break an expression");
                ThrowsExactly<EvalError>(() => BundleLoader.Parse(json), "unknown ast tag: zz", "loading the bundle");
            }),

            ("a flow's bag clashing with a key the game holds is a StoryletError (flow mount)", () =>
            {
                var g = NewGame();
                g.Registry.DefineOwned("storylets/flow/f/story", new List<ScopeDeclaration>(), new OwnedScopeOptions { Owner = "Game" });
                ThrowsExactly<StoryletError>(() => g.Engine.OpenFlow("f"),
                    "scope '@storylets/flow/f/story' is already registered by Game", "opening the flow");
            }),

            ("an expression the kernel refuses is an EvalError (evaluation)", () =>
            {
                var json = BundleJson.Replace(@"[""bin"",""+"",[""sv"",""story"",""gold""],[""n"",1]]", @"[""bin"",""/"",[""n"",1],[""n"",0]]");
                Check(json != BundleJson, "the fixture did not break the gold change");
                var engine = new Engine(BundleLoader.Parse(json), new EngineOptions { Seed = 1 });
                ThrowsExactly<EvalError>(() => Heist(engine.OpenFlow("f")), "division by zero", "the outcome's @story change");
            }),

            ("the game's write to another engine's scope with no setter is a StoryletError (SetProperty)", () =>
            {
                var registry = new ScopeRegistry().DefineForeign("patter", new ZeroWorld(), new List<ScopeDeclaration>(),
                    new ForeignScopeOptions { Owner = "Patter" });
                var engine = new Engine(NewBundle(), new EngineOptions { Registry = registry });
                ThrowsExactly<StoryletError>(() => engine.SetProperty("patter.gold", ExprValue.Num(5)), "'@patter.gold' is read-only", "the engine's SetProperty");
                ThrowsExactly<StoryletError>(() => engine.OpenFlow("f").SetProperty("patter.gold", ExprValue.Num(5)), "'@patter.gold' is read-only", "a flow's SetProperty");
            }),

            ("reads and writes another engine's game-wide scope by path", () =>
            {
                var registry = new ScopeRegistry().DefineOwned("patter",
                    new List<ScopeDeclaration> { new ScopeDeclaration { Name = "gold", Type = "number", Default = ExprValue.Num(3) } },
                    new OwnedScopeOptions { Owner = "Patter" });
                var engine = new Engine(NewBundle(), new EngineOptions { Registry = registry });
                Num(engine.GetProperty("patter.gold"), 3, "engine patter.gold");
                engine.OpenFlow("f").SetProperty("patter.gold", ExprValue.Num(5));
                Num(registry.Get("patter", "gold"), 5, "registry patter.gold");
            }),

            ("an expression reads another engine's game-wide scope", () =>
            {
                // Not in the JS test by name: its combined proof reads @patter from a
                // storylet. Here the card's own condition does, through the
                // registry's context.
                var json = JObject.Parse(BundleJson);
                var card = (JObject)json["boxes"][0]["decks"][0]["cards"][0];
                card["condition"] = new JObject { ["src"] = "@patter.gold > 2", ["ast"] = JArray.Parse(@"[""bin"","">"",[""sv"",""patter"",""gold""],[""n"",2]]") };
                var registry = new ScopeRegistry().DefineOwned("patter",
                    new List<ScopeDeclaration> { new ScopeDeclaration { Name = "gold", Type = "number", Default = ExprValue.Num(0) } },
                    new OwnedScopeOptions { Owner = "Patter" });
                var engine = new Engine(BundleLoader.Parse(json), new EngineOptions { Registry = registry });
                var flow = engine.OpenFlow("f");
                Check(flow.Deal("q").Count == 0, "the card was dealt with @patter.gold at 0");
                registry.Set("patter", "gold", ExprValue.Num(3));
                Check(flow.Deal("q").Count == 1, "the card was not dealt with @patter.gold at 3");
            }),

            ("the storylets/save@2 wire: exactly the JS key paths", () =>
            {
                var engine = new Engine(NewBundle(), new EngineOptions { Seed = 1 });
                Heist(engine.OpenFlow("f"));
                var wire = StoryletSave.ToJson(engine.SaveGame());
                Check(wire.Value<string>("schema") == "storylets/save@2", "schema " + wire.Value<string>("schema"));
                Check(string.Join(",", wire.Properties().Select(p => p.Name)) == "schema,content,registry,shared,flows", "top-level keys: " + string.Join(",", wire.Properties().Select(p => p.Name)));
                Check(string.Join(",", ((JObject)wire["shared"]).Properties().Select(p => p.Name)) == "spent", "shared keys");
                Check(string.Join(",", ((JObject)wire["flows"]["f"]).Properties().Select(p => p.Name)) == "turns,prng,cooldowns,board,playLog", "flow keys: " + string.Join(",", ((JObject)wire["flows"]["f"]).Properties().Select(p => p.Name)));
                var withGame = NewGame();
                Heist(withGame.Engine.OpenFlow("f"));
                var gameWire = StoryletSave.ToJson(withGame.Engine.SaveGame());
                Check(string.Join(",", gameWire.Properties().Select(p => p.Name)) == "schema,content,shared,flows", "a game's engine's top-level keys");
            }),

            ("PreviewLoad stays pure with the game's registry", () =>
            {
                var save = Session1();
                var g = NewGame();
                Heist(g.Engine.OpenFlow("live"));
                var before = Blob(g.Registry.Save()).ToString();
                g.Engine.PreviewLoad(save.Storylets);
                g.Engine.PreviewLoad(V1());
                Check(Blob(g.Registry.Save()).ToString() == before, "PreviewLoad moved the registry");
                Check(g.Engine.GetFlow("live") != null && !g.Engine.GetFlow("live").IsClosed, "PreviewLoad closed a flow");
            }),

            ("an id holding % or / escapes into one key and back", () =>
            {
                // A flow id and an owner's internal id, each holding both.
                var json = JObject.Parse(BundleJson);
                json["boxes"][0]["decks"][0]["id"] = "k%2/main";
                Func<Engine> make = () => new Engine(BundleLoader.Parse(json), new EngineOptions { Seed = 1 });
                var engine = make();
                Heist(engine.OpenFlow("a/b%c"));
                var save = Reread(engine.SaveGame());
                Check(save.Registry.GetOrDefault("storylets/flow/a%2Fb%25c/deck/k%252%2Fmain") != null,
                    "keys: " + string.Join(", ", save.Registry.Keys));
                var restored = make();
                Check(restored.LoadGame(save).Exact, "the report is not exact");
                Num(restored.GetFlow("a/b%c").GetProperty("deck.main.drawn"), 1, "deck.main.drawn");
            }),

            ("a shared deck bag registers under storylets/deck/<id> and comes back from a save", () =>
            {
                var json = JObject.Parse(BundleJson);
                ((JArray)json["boxes"][0]["decks"][0]["properties"]).Add(JObject.Parse(@"{ ""name"": ""stock"", ""type"": ""number"", ""default"": 2, ""shared"": true }"));
                var registry = new ScopeRegistry();
                var engine = new Engine(BundleLoader.Parse(json), new EngineOptions { Registry = registry, Seed = 1 });
                Same(Blob(registry.Save()), @"{ ""story"": { ""gold"": 0 }, ""storylets/deck/k_main"": { ""stock"": 2 } }", "registry.Save()");
                var row = registry.ListProperties().Find(r => r.Scope == "storylets/deck/k_main");
                Check(row != null && row.Path == "deck.main.stock" && row.Owner == "Storylet Engine", "the shared deck row");

                var standalone = new Engine(BundleLoader.Parse(json), new EngineOptions { Seed = 1 });
                standalone.SetProperty("deck.main.stock", ExprValue.Num(7));
                var save = Reread(standalone.SaveGame());
                var restored = new Engine(BundleLoader.Parse(json), new EngineOptions { Seed = 1 });
                Check(restored.LoadGame(save).Exact, "the report is not exact");
                Num(restored.GetProperty("deck.main.stock"), 7, "deck.main.stock");
            }),

            ("Reset reseeds a self-backed @world in place, still registered and saved", () =>
            {
                var engine = new Engine(NewBundle(), new EngineOptions { Seed = 1 });
                Heist(engine.OpenFlow("f"));
                Num(engine.GetProperty("world.alarm"), 1, "world.alarm before");
                engine.Reset();
                Num(engine.GetProperty("world.alarm"), 0, "world.alarm after Reset");
                Same(Blob(engine.SaveGame().Registry), @"{ ""story"": { ""gold"": 0 }, ""world"": { ""alarm"": 0 } }", "the registry after Reset");
            }),
        };

        // --- hotSwap on the game's registry ------------------------------------------
        //
        // A live bundle refresh that hands this engine's keys to its replacement,
        // reports property drift as a load does, and touches nothing else in the
        // registry. The JS test's "hotSwap on the game's registry", case for case.

        /// <summary>The JS test's `edited` bundle, through expandBundle: @story
        /// gains `rumours`, the per-flow `steps` is gone, and the box gains a
        /// SHARED `heat` (a bag, and a key, the old engine never had).</summary>
        private const string EditedJson = @"{""schema"":""storylets/bundle@0"",""content"":{""project"":""conf"",""version"":""0.0.0"",""hash"":""""},""metadata"":""full"",""settings"":{""playAdvancesTurns"":1},""world"":{""properties"":[{""name"":""alarm"",""type"":""number"",""default"":0}]},""story"":{""properties"":[{""name"":""gold"",""type"":""number"",""default"":0},{""name"":""rumours"",""type"":""number"",""default"":0}]},""boxes"":[{""id"":""b_x"",""gameId"":""box"",""ranking"":{""specificity"":true},""fields"":[],""properties"":[{""name"":""heat"",""type"":""number"",""default"":0,""shared"":true}],""tagGroups"":[{""id"":""d_zone"",""gameId"":""zone"",""tags"":[{""id"":""v_docks"",""gameId"":""docks"",""properties"":[{""name"":""danger"",""type"":""number"",""default"":0}]},{""id"":""v_market"",""gameId"":""market""}]}],""decks"":[{""id"":""k_main"",""gameId"":""main"",""properties"":[{""name"":""drawn"",""type"":""number"",""default"":0}],""cards"":[{""id"":""c_heist"",""gameId"":""heist"",""priority"":0,""redraw"":""always"",""outcomes"":[{""id"":""o_go"",""gameId"":""go"",""changes"":{""@deck.drawn"":{""src"":""@deck.drawn + 1"",""ast"":[""bin"",""+"",[""sv"",""deck"",""drawn""],[""n"",1]]},""@story.gold"":{""src"":""@story.gold + 1"",""ast"":[""bin"",""+"",[""sv"",""story"",""gold""],[""n"",1]]},""@world.alarm"":{""src"":""@world.alarm + 1"",""ast"":[""bin"",""+"",[""sv"",""world"",""alarm""],[""n"",1]]}}}]}]}],""handTemplates"":[],""hands"":[{""id"":""h_q"",""gameId"":""q"",""rule"":{""slots"":""unbounded""}}]}]}";

        private static Bundle Edited() => BundleLoader.Parse(EditedJson);

        /// <summary>A game mid-run: Patter's scope beside the engine's, a heist
        /// played, and two values waiting in the registry, one for a flow of this
        /// engine that has not opened and one for another engine's key.</summary>
        private static Game Playing()
        {
            var g = NewGame();
            g.Registry.DefineOwned("patter",
                new List<ScopeDeclaration> { new ScopeDeclaration { Name = "visits", Type = "number", Default = ExprValue.Num(4) } },
                new OwnedScopeOptions { Owner = "Patter" });
            Heist(g.Engine.OpenFlow("f"));
            var waiting = new OrderedMap<string, OrderedMap<string, ExprValue>>();
            waiting.Set("storylets/flow/z/story", Section("steps", 5));
            waiting.Set("other/deck/inn", Section("drawn", 2));
            g.Registry.Load(waiting, keepParked: true);
            return g;
        }

        private static OrderedMap<string, ExprValue> Section(string name, double value)
        {
            var m = new OrderedMap<string, ExprValue>();
            m.Set(name, ExprValue.Num(value));
            return m;
        }

        private static readonly List<(string Name, Action Run)> HotSwapCases = new List<(string, Action)>
        {
            ("hotSwap: carries the run across, reports the dropped property, and really drops it", () =>
            {
                var g = Playing();
                var swapped = g.Engine.HotSwap(Edited());
                var engine = swapped.Engine;
                Num(engine.GetProperty("story.gold"), 1, "story.gold carried");
                Num(engine.GetProperty("story.rumours"), 0, "story.rumours defaulted");
                Num(engine.GetFlow("f").GetProperty("deck.main.drawn"), 1, "flow f deck.main.drawn carried");
                var dropped = string.Join(",", swapped.Report.DroppedProperties.Select(d => d.Flow + ":" + d.Path));
                Check(dropped == "f:story.steps", "report.droppedProperties: " + dropped);
                Check(!g.Registry.Save().ContainsKey("storylets/flow/f/story"), "the dropped property's key is gone, not a stray");
                // On the game's registry the old engine is spent: its flows closed.
                Check(g.Engine.GetFlow("f") == null && g.Engine.Flows().Count == 0, "the old engine still holds a flow");
                Heist(engine.GetFlow("f"));
                Num(g.Registry.Get("story", "gold"), 2, "the replacement plays on the registry");
            }),

            ("hotSwap: touches nothing that is not this engine's, and waiting values wait on", () =>
            {
                var g = Playing();
                g.Engine.HotSwap(Edited());
                var saved = Blob(g.Registry.Save());
                Same(saved["patter"], @"{ ""visits"": 4 }", "patter");
                Same(saved["other/deck/inn"], @"{ ""drawn"": 2 }", "other/deck/inn");
                Same(saved["storylets/flow/z/story"], @"{ ""steps"": 5 }", "storylets/flow/z/story");
                Same(saved["world"], @"{ ""alarm"": 1 }", "world");
            }),

            ("hotSwap: refuses another project before anything moves", () =>
            {
                var g = Playing();
                var before = Blob(g.Registry.Save()).ToString(Newtonsoft.Json.Formatting.None);
                var other = Edited();
                other.Content.Project = "somebody-else";
                ThrowsExactly<StoryletError>(() => g.Engine.HotSwap(other), "somebody-else", "another project");
                Check(Blob(g.Registry.Save()).ToString(Newtonsoft.Json.Formatting.None) == before, "the refused swap changed the registry");
                Heist(g.Engine.GetFlow("f"));                              // the old engine still plays
                Num(g.Registry.Get("story", "gold"), 2, "story.gold after the old engine plays on");
            }),

            ("hotSwap: a rebuild that fails part way leaves this engine and the registry exactly as they were", () =>
            {
                var g = Playing();
                var before = Blob(g.Registry.Save());
                // The replacement is asked to bind @world, which the game already
                // registered: it clashes mid-build.
                ThrowsExactly<StoryletError>(() => g.Engine.HotSwap(Edited(), o => o.World = new ZeroWorld()),
                    "scope '@world' is already registered by Game", "the clash");
                // Every key and value as before (the order of keys may differ: registering again appends).
                Same(Blob(g.Registry.Save()), before.ToString(Newtonsoft.Json.Formatting.None), "the registry after the failed swap");
                Heist(g.Engine.GetFlow("f"));
                Num(g.Registry.Get("story", "gold"), 2, "story.gold");
                Num(g.Engine.GetFlow("f").GetProperty("story.steps"), 2, "the flow's own story.steps");
                // Registered again, not merely parked: the registry reads the flow's live bag.
                Check(g.Registry.Has("storylets/flow/f/story"), "the flow's bag is not registered again");
                Num(g.Registry.Get("storylets/flow/f/story", "steps"), 2, "the registry's storylets/flow/f/story.steps");
            }),

            ("hotSwap: the Live Link's StoryletLiveBundle.Apply now works on the game's registry", () =>
            {
                var g = Playing();
                var r = StoryletLiveBundle.Apply(g.Engine, EditedJson);
                Check(r.Ok, "Apply refused: " + r.Error);
                Num(r.Engine.GetProperty("story.gold"), 1, "story.gold through Apply");
                var dropped = string.Join(",", r.Report.DroppedProperties.Select(d => d.Flow + ":" + d.Path));
                Check(dropped == "f:story.steps", "Apply's report.droppedProperties: " + dropped);
            }),

            ("hotSwap: a change through the callback keeps every option it leaves alone", () =>
            {
                // Built with a Seed and a World resolver; the swap turns on Log
                // and nothing else, so the replacement keeps both.
                var engine = new Engine(NewBundle(), new EngineOptions { Seed = 7, World = new FiveWorld() });
                engine.OpenFlow("f").Deal("q");
                Check(engine.Log().Count == 0, "the engine was built without Log");
                var next = engine.HotSwap(Edited(), o => o.Log = true).Engine;
                next.OpenFlow("n").Deal("q");
                Check(next.Log().Count > 0, "the change (Log) did not reach the replacement");
                Num(next.GetProperty("world.alarm"), 5, "world.alarm through the World resolver it was built with");
                var seeded = new Engine(Edited(), new EngineOptions { Seed = 7 });
                seeded.OpenFlow("n");
                var unseeded = new Engine(Edited());
                unseeded.OpenFlow("n");
                Check(seeded.SaveFlow("n").Prng != unseeded.SaveFlow("n").Prng, "seeds 7 and 0 start the same, so the check below proves nothing");
                Check(next.SaveFlow("n").Prng == seeded.SaveFlow("n").Prng, "the replacement's new flow is not on Seed 7");
                // The engine's own options are a copy: the callback changed nothing of them.
                var again = engine.HotSwap(Edited()).Engine;
                again.OpenFlow("m").Deal("q");
                Check(again.Log().Count == 0, "the callback changed the options this engine remembers");
            }),

            ("hotSwap: a standalone engine is saved and loaded into a new one, and left untouched", () =>
            {
                var engine = new Engine(NewBundle(), new EngineOptions { Seed = 1 });
                Heist(engine.OpenFlow("f"));
                var swapped = engine.HotSwap(Edited());
                Num(swapped.Engine.GetProperty("story.gold"), 1, "story.gold carried");
                Num(swapped.Engine.GetProperty("world.alarm"), 1, "the self-backed world.alarm carried");
                Check(swapped.Engine.SaveGame().Registry != null, "the replacement is still its own game");
                Num(engine.GetFlow("f").GetProperty("story.steps"), 1, "the old engine still has its flow");
                Heist(engine.GetFlow("f"));
                Num(engine.GetProperty("story.gold"), 2, "and plays on, on its own registry");
                Num(swapped.Engine.GetProperty("story.gold"), 1, "which is not the replacement's");
            }),
        };

        // --- other engines' scopes -------------------------------------------------------
        //
        // A card may name `@patter.x` with no project setting; the compiler lets it
        // through and records it in the bundle (externalScopes). The JS compiler
        // test's runtime cases ("the engine reads and writes it through the game's
        // registry" and "refuses to open a flow, or load a save, where nobody
        // registered the scope, before anything changes"), with its bundles as
        // the compiler wrote them, plus the write branch's other refusals.

        /// <summary>compileFiles(heist("@patter.visits >= 1", { "@patter.gold": "@patter.gold - 1" })).</summary>
        private const string CardsPatterJson = @"{""schema"":""storylets/bundle@0"",""content"":{""project"":""p"",""version"":""0.0.1"",""hash"":""16f2jt4""},""metadata"":""full"",""settings"":{""playAdvancesTurns"":1},""world"":{""properties"":[]},""story"":{""properties"":[]},""boxes"":[{""id"":""b_1"",""gameId"":""b1"",""ranking"":{""specificity"":true},""fields"":[],""properties"":[],""tagGroups"":[{""id"":""d_1"",""gameId"":""d1"",""tags"":[{""id"":""v_1"",""gameId"":""v1""}]}],""decks"":[{""id"":""k_1"",""gameId"":""main"",""properties"":[],""cards"":[{""id"":""c_1"",""gameId"":""c1"",""condition"":{""src"":""@patter.visits >= 1"",""ast"":[""bin"","">="",[""sv"",""patter"",""visits""],[""n"",1]]},""priority"":0,""redraw"":""always"",""outcomes"":[{""id"":""o_1"",""gameId"":""go"",""changes"":{""@patter.gold"":{""src"":""@patter.gold - 1"",""ast"":[""bin"",""-"",[""sv"",""patter"",""gold""],[""n"",1]]}}}]}]}],""handTemplates"":[],""hands"":[{""id"":""h_1"",""gameId"":""h1"",""rule"":{""slots"":1}}]}],""externalScopes"":[""patter""]}";

        /// <summary>compileFiles(heist("true", { "@patter.gold": "1" })): a card any
        /// flow is dealt, whose only change writes Patter's scope.</summary>
        private const string CardsWriteOnlyJson = @"{""schema"":""storylets/bundle@0"",""content"":{""project"":""p"",""version"":""0.0.1"",""hash"":""0mw21g1""},""metadata"":""full"",""settings"":{""playAdvancesTurns"":1},""world"":{""properties"":[]},""story"":{""properties"":[]},""boxes"":[{""id"":""b_1"",""gameId"":""b1"",""ranking"":{""specificity"":true},""fields"":[],""properties"":[],""tagGroups"":[{""id"":""d_1"",""gameId"":""d1"",""tags"":[{""id"":""v_1"",""gameId"":""v1""}]}],""decks"":[{""id"":""k_1"",""gameId"":""main"",""properties"":[],""cards"":[{""id"":""c_1"",""gameId"":""c1"",""condition"":{""src"":""true"",""ast"":[""b"",true]},""priority"":0,""redraw"":""always"",""outcomes"":[{""id"":""o_1"",""gameId"":""go"",""changes"":{""@patter.gold"":{""src"":""1"",""ast"":[""n"",1]}}}]}]}],""handTemplates"":[],""hands"":[{""id"":""h_1"",""gameId"":""h1"",""rule"":{""slots"":1}}]}],""externalScopes"":[""patter""]}";

        private static ScopeRegistry PatterStandIn() => new ScopeRegistry().DefineOwned("patter", new List<ScopeDeclaration>
        {
            new ScopeDeclaration { Name = "gold", Type = "number", Default = ExprValue.Num(3) },
            new ScopeDeclaration { Name = "visits", Type = "number", Default = ExprValue.Num(1) },
        }, new OwnedScopeOptions { Owner = "Patter" });

        private static readonly List<(string Name, Action Run)> ExternalScopeCases = new List<(string, Action)>
        {
            ("other engines' scopes: the bundle carries externalScopes, and none is none", () =>
            {
                var ext = BundleLoader.Parse(CardsPatterJson).ExternalScopes;
                Check(ext != null && ext.SequenceEqual(new[] { "patter" }), "externalScopes: " + (ext == null ? "null" : string.Join(",", ext)));
                Check(NewBundle().ExternalScopes == null, "a bundle naming no other engine has none");
            }),

            ("other engines' scopes: read and written through the game's registry", () =>
            {
                var registry = PatterStandIn();
                var flow = new Engine(BundleLoader.Parse(CardsPatterJson), new EngineOptions { Registry = registry }).OpenFlow("main");
                var dealt = flow.Deal("h1").Select(c => c.GameId).ToList();
                Check(dealt.SequenceEqual(new[] { "c1" }), "dealt: " + string.Join(",", dealt));
                flow.Play("c1", "go", "h1");
                Num(registry.Get("patter", "gold"), 2, "patter.gold");
            }),

            ("other engines' scopes: refuses to open a flow, or load a save, where nobody registered the scope, before anything changes", () =>
            {
                const string refusal = "this content names @patter, which no engine on this registry registered: give every engine the game's one registry";
                var alone = new Engine(BundleLoader.Parse(CardsPatterJson));
                ThrowsExactly<StoryletError>(() => alone.OpenFlow("main"), refusal, "OpenFlow with nobody registering @patter");
                Check(alone.GetFlow("main") == null, "the refused open opened a flow");

                // A save made where Patter was present, loaded where it is not: refused whole.
                var game = new Engine(BundleLoader.Parse(CardsPatterJson), new EngineOptions { Registry = PatterStandIn() });
                game.OpenFlow("main").Deal("h1");
                var save = game.SaveGame();
                var elsewhere = PatterStandIn();
                var other = new Engine(BundleLoader.Parse(CardsPatterJson), new EngineOptions { Registry = elsewhere });
                other.OpenFlow("keep");
                elsewhere.Remove("patter");
                ThrowsExactly<StoryletError>(() => other.LoadGame(save), refusal, "LoadGame with nobody registering @patter");
                var ids = string.Join(",", other.Flows().Select(f => f.Id));
                Check(ids == "keep", "the load changed the flows: " + ids);

                // The engine that took the scope away mid-game: a write names it.
                var shared = new ScopeRegistry().DefineOwned("patter", new List<ScopeDeclaration>
                {
                    new ScopeDeclaration { Name = "gold", Type = "number", Default = ExprValue.Num(3) },
                });
                var paying = new Engine(BundleLoader.Parse(CardsWriteOnlyJson), new EngineOptions { Registry = shared }).OpenFlow("main");
                paying.Deal("h1");
                shared.Remove("patter");
                ThrowsExactly<StoryletError>(() => paying.Play("c1", "go", "h1"),
                    "@patter.gold cannot be written: no engine on this registry registered @patter", "the unregistered write");
            }),

            ("other engines' scopes: a token in no bundle's list is still a bad change target", () =>
            {
                var json = CardsWriteOnlyJson.Replace(",\"externalScopes\":[\"patter\"]", "");
                var flow = new Engine(BundleLoader.Parse(json), new EngineOptions { Registry = new ScopeRegistry() }).OpenFlow("main");
                flow.Deal("h1");
                ThrowsExactly<StoryletError>(() => flow.Play("c1", "go", "h1"), "bad change target scope \"@patter\"", "an unlisted token");
            }),

            ("other engines' scopes: the registry keeps the other engine's rules (a read-only property is refused)", () =>
            {
                var registry = new ScopeRegistry().DefineOwned("patter", new List<ScopeDeclaration>
                {
                    new ScopeDeclaration { Name = "gold", Type = "number", Default = ExprValue.Num(3), Writable = false },
                }, new OwnedScopeOptions { Owner = "Patter" });
                var flow = new Engine(BundleLoader.Parse(CardsWriteOnlyJson), new EngineOptions { Registry = registry }).OpenFlow("main");
                flow.Deal("h1");
                ThrowsExactly<StoryletError>(() => flow.Play("c1", "go", "h1"), "read-only", "a read-only property of another engine");
                Num(registry.Get("patter", "gold"), 3, "patter.gold untouched");
            }),
        };

        private sealed class ZeroWorld : IScopeResolver
        {
            public ExprValue Get(string name) => ExprValue.Num(0);
            public bool CanSet => false;
            public void Set(string name, ExprValue value) { }
        }

        private sealed class FiveWorld : IScopeResolver
        {
            public ExprValue Get(string name) => ExprValue.Num(5);
            public bool CanSet => false;
            public void Set(string name, ExprValue value) { }
        }

        private sealed class GameSave
        {
            public JObject RegistryJson;
            public SaveEnvelope Storylets;
        }

        /// <summary>A game's one save: its registry once, and the engine's
        /// envelope beside it, both through JSON as a game would write them.</summary>
        private static GameSave Session1()
        {
            var g = NewGame();
            Heist(g.Engine.OpenFlow("f"));
            g.Engine.OpenFlow("g");
            var file = new JObject
            {
                ["registry"] = StoryletSave.SaveRegistry(g.Registry),
                ["storylets"] = StoryletSave.ToJson(g.Engine.SaveGame()),
            }.ToString();
            var parsed = JObject.Parse(file);
            return new GameSave
            {
                RegistryJson = (JObject)parsed["registry"],
                Storylets = StoryletSave.FromJson((JObject)parsed["storylets"]),
            };
        }

        private static void CheckResumed(Game g)
        {
            Num(g.Engine.GetProperty("story.gold"), 1, "story.gold");
            Num(g.Engine.GetProperty("world.alarm"), 1, "world.alarm");
            Num(g.Engine.GetFlow("f").GetProperty("story.steps"), 1, "f story.steps");
            Num(g.Engine.GetFlow("f").GetProperty("deck.main.drawn"), 1, "f deck.main.drawn");
            Num(g.Engine.GetFlow("g").GetProperty("story.steps"), 0, "g story.steps");
            Heist(g.Engine.GetFlow("g"));
            Num(g.Registry.Get("story", "gold"), 2, "registry story.gold after g's heist");
        }

        private static OrderedMap<string, OrderedMap<string, ExprValue>> Sections(string json)
        {
            var blob = new OrderedMap<string, OrderedMap<string, ExprValue>>();
            foreach (var section in JObject.Parse(json))
            {
                var values = new OrderedMap<string, ExprValue>();
                foreach (var pair in (JObject)section.Value) values.Set(pair.Key, StoryletJson.ToValue(pair.Value));
                blob.Set(section.Key, values);
            }
            return blob;
        }

        /// <summary>The JS test's version 1 envelope, as JSON: shared @story
        /// `gold` 4, and flow f's own story, deck and tag values.</summary>
        private static string V1Json(string sharedStory = @"{ ""gold"": 4 }")
        {
            return @"{
                ""schema"": ""storylets/save@1"",
                ""content"": { ""project"": ""conf"", ""version"": ""0.0.0"", ""hash"": """" },
                ""shared"": { ""props"": { ""story"": " + sharedStory + @", ""box"": {}, ""deck"": {}, ""hand"": {}, ""value"": {} }, ""spent"": [] },
                ""flows"": { ""f"": {
                    ""props"": { ""story"": { ""steps"": 2 }, ""box"": {}, ""deck"": { ""k_main"": { ""drawn"": 3 } }, ""hand"": {}, ""value"": { ""v_docks"": { ""danger"": 1 } } },
                    ""turns"": { ""b_x"": 0 }, ""prng"": 1, ""cooldowns"": {}, ""board"": { ""h_q"": [] }, ""playLog"": []
                } }
            }";
        }

        private static SaveEnvelope V1(string sharedStory = @"{ ""gold"": 4 }") => StoryletSave.FromJson(JObject.Parse(V1Json(sharedStory)));

        /// <summary>Run every case; returns the passes and each failure as
        /// "case: what".</summary>
        public static (int Passed, int Total, List<string> Failures) Run()
        {
            var failures = new List<string>();
            int passed = 0;
            var all = Cases.Concat(HotSwapCases).Concat(ExternalScopeCases).ToList();
            foreach (var (name, run) in all)
            {
                try
                {
                    run();
                    passed++;
                }
                catch (Exception e)
                {
                    failures.Add($"{name}: {e.Message}");
                }
            }
            return (passed, all.Count, failures);
        }
    }
}
