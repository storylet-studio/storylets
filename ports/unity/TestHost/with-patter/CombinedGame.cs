// The combined proof on Unity's C#: a Patter engine and a Storylet Engine in one
// game, on ONE ScopeRegistry, with one save (patterkit
// design/one-registry-handover.md). A port of the JS runtime's
// packages/runtime/test/with-patter/combined-game.test.ts, case for case, with
// the same content and the same expectations: a card naming @patter directly
// and a Storylet Engine hot swap on the shared registry included.
//
// The game owns the registry and registers @world itself, as a property the
// registry stores. Each engine registers its own scopes: the Storylet Engine
// @story and its per-flow bags, Patter @patter and its per-flow and per-scene
// bags. Every expression reads every scope, so a Patter scene gates on
// @story.act, and a storylet gates on a @world value a Patter scene wrote. One
// save is { registry, patter, storylets }.
//
// This file is compiled twice, from one copy: by the dotnet host beside it
// (WithPatter.csproj, Program.cs), and into a scratch Unity project holding both
// real packages by scripts/check-unity-with-patter.sh (unity/WithPatterProbe.cs).
// So it keeps to what both can compile: C# 9, and Newtonsoft (the JSON both
// packages' Unity loaders already use), never System.Text.Json.
//
// The registry type, ExprValue and the rest of Wildwinter.Expr are ONE kernel:
// Patterplay's copy. The dotnet host compiles only Patterplay's Runtime/Expr, and
// in Unity the Storylet Engine's kernel assembly switches itself off when
// Patterplay 0.14.0 or newer is installed. Either way, a game hands the same
// registry object to both engines, which before the shared kernel it could not.
//
// Each case runs twice: once with the game writing and reading its registry
// through Patterplay's PatterSave.SaveRegistry / LoadRegistry, once through the
// Storylet Engine's StoryletSave ones. A last case crosses them.

using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Wildwinter.Expr;
using P = Patterkit.Patterplay;
using S = StoryletStudio.StoryletEngine;

namespace StoryletStudio.CombinedProof
{
    public static class CombinedGame
    {
        // --- the Storylet Engine's content ------------------------------------------
        //
        // The JS test's storyletBundle(), expanded exactly as the conformance
        // package's expandBundle writes it (the scaffold's box, zone tags and hand
        // included). Written out by running the JS test's own storyletBundle(), so
        // the two tests play one bundle.

        private const string StoryletBundleJson = @"{""schema"":""storylets/bundle@0"",""content"":{""project"":""conf"",""version"":""0.0.0"",""hash"":""""},""metadata"":""full"",""settings"":{""playAdvancesTurns"":1},""world"":{""properties"":[{""name"":""alarm"",""type"":""number"",""default"":0}]},""story"":{""properties"":[{""name"":""act"",""type"":""number"",""default"":1}]},""boxes"":[{""id"":""b_x"",""gameId"":""box"",""ranking"":{""specificity"":true},""fields"":[],""properties"":[],""tagGroups"":[{""id"":""d_zone"",""gameId"":""zone"",""tags"":[{""id"":""v_docks"",""gameId"":""docks"",""properties"":[{""name"":""danger"",""type"":""number"",""default"":0}]},{""id"":""v_market"",""gameId"":""market""}]}],""decks"":[{""id"":""k_main"",""gameId"":""main"",""properties"":[],""cards"":[{""id"":""c_heist"",""gameId"":""heist"",""priority"":0,""redraw"":""never"",""outcomes"":[{""id"":""o_go"",""gameId"":""go"",""changes"":{""@story.act"":{""src"":""@story.act + 1"",""ast"":[""bin"",""+"",[""sv"",""story"",""act""],[""n"",1]]},""@world.alarm"":{""src"":""@world.alarm + 1"",""ast"":[""bin"",""+"",[""sv"",""world"",""alarm""],[""n"",1]]}}}]},{""id"":""c_manhunt"",""gameId"":""manhunt"",""condition"":{""src"":""@world.alarm >= 10"",""ast"":[""bin"","">="",[""sv"",""world"",""alarm""],[""n"",10]]},""priority"":0,""redraw"":""always"",""outcomes"":[{""id"":""o_run"",""gameId"":""run"",""changes"":{}}]},{""id"":""c_patron"",""gameId"":""patron"",""condition"":{""src"":""@patter.visits >= 1"",""ast"":[""bin"","">="",[""sv"",""patter"",""visits""],[""n"",1]]},""priority"":0,""redraw"":""always"",""outcomes"":[{""id"":""o_tip"",""gameId"":""tip"",""changes"":{""@patter.visits"":{""src"":""@patter.visits + 10"",""ast"":[""bin"",""+"",[""sv"",""patter"",""visits""],[""n"",10]]}}}]}]}],""handTemplates"":[],""hands"":[{""id"":""h_q"",""gameId"":""q"",""rule"":{""slots"":""unbounded""}}]}]}";

        /// <summary>The JS test's storyletBundle(extraStory): the newer build adds a
        /// @story property, rumours.</summary>
        private static S.Bundle StoryletBundle(bool extraStory = false)
        {
            var json = JObject.Parse(StoryletBundleJson);
            if (extraStory)
            {
                ((JArray)json["story"]["properties"]).Add(new JObject { ["name"] = "rumours", ["type"] = "number", ["default"] = 0 });
            }
            return S.BundleLoader.Parse(json);
        }

        // --- Patter's content, compiled against the Storylet Engine's published scopes
        //
        // The JS test's patterBundle(line), as Patter's exportBundle writes it (again
        // written out by running the JS test's own function): the guard's snippet
        // waits for @story.act >= 2 and, on exit, raises @world.alarm by ten and
        // counts a visit. Only the line's text changes between the builds, so the
        // structure hash is one and the build hash is the compiler's for each text.

        private const string PatterBundleJson = @"{""schema"":""patter/bundle@0"",""content"":{""project"":""p"",""hash"":""HASH"",""structureHash"":""0zmhmuj""},""voiced"":false,""locales"":{""default"":""en"",""included"":[""en""]},""cast"":[{""name"":""GUARD""}],""properties"":[{""name"":""visits"",""type"":""number"",""default"":0,""shared"":true}],""scenes"":{""gate"":{""id"":""gate"",""type"":""scene"",""name"":""Gate"",""gameId"":""gate"",""blocks"":[{""id"":""b"",""type"":""block"",""name"":""B"",""children"":[{""id"":""shout"",""type"":""snippet"",""condition"":{""src"":""@story.act >= 2"",""ast"":[""bin"","">="",[""sv"",""story"",""act""],[""n"",2]]},""beats"":[{""id"":""L"",""kind"":""line"",""character"":""GUARD""}],""onExit"":[{""kind"":""set"",""target"":""@world.alarm"",""value"":{""src"":""@world.alarm + 10"",""ast"":[""bin"",""+"",[""sv"",""world"",""alarm""],[""n"",10]]}},{""kind"":""set"",""target"":""@visits"",""value"":{""src"":""@visits + 1"",""ast"":[""bin"",""+"",[""sv"",""patter"",""visits""],[""n"",1]]}}],""jump"":{""to"":""END""}}]}]}},""strings"":{""en"":{""L"":""LINE""}},""externalScopes"":[""story""]}";

        private static readonly Dictionary<string, string> LineHashes = new Dictionary<string, string>
        {
            ["Thief!"] = "1q2dsxn", ["Stop, thief!"] = "1d8lt0v", ["Halt!"] = "04hkhhs",
        };

        private static P.Bundle PatterBundle(string line = "Thief!")
        {
            var json = JObject.Parse(PatterBundleJson);
            json["content"]["hash"] = LineHashes[line];
            json["strings"]["en"]["L"] = line;
            return P.PatterBundleLoader.FromJson(json);
        }

        // --- the game ------------------------------------------------------------------

        private sealed class Game
        {
            public ScopeRegistry Registry;
            public S.Engine Storylets;
            public P.Engine Patter;
        }

        /// <summary>One registry for the game. @world is the game's, stored by the
        /// registry; both engines read it.</summary>
        private static Game CombinedGameOf(S.Bundle storyletBundle = null, string patterLine = "Thief!")
        {
            var registry = new ScopeRegistry().DefineOwned("world",
                new List<ScopeDeclaration> { new ScopeDeclaration { Name = "alarm", Type = "number", Default = ExprValue.Num(0) } },
                new OwnedScopeOptions { Owner = "Game" });
            var storylets = new S.Engine(storyletBundle ?? StoryletBundle(), new S.EngineOptions { Registry = registry, Seed = 3 });
            var patter = new P.Engine(PatterBundle(patterLine), new P.EngineOptions { Registry = registry, Seed = 3 });
            return new Game { Registry = registry, Storylets = storylets, Patter = patter };
        }

        private static void Heist(S.Flow flow)
        {
            var card = flow.Deal("q").FirstOrDefault(c => c.GameId == "heist");
            Check(card != null, "the heist is dealt");
            flow.Play(card.GameId, "go", "q");
        }

        /// <summary>Play the first part: a heist moves the story to act two, then the
        /// Patter guard shouts.</summary>
        private static void PlayFirstPart(Game g)
        {
            var guard = g.Patter.OpenFlow("guard", "gate");
            End(guard.Advance(), "act 1: the gate stays quiet");
            Heist(g.Storylets.OpenFlow("thief"));
            var again = g.Patter.OpenFlow("guard", "gate");
            var step = again.Advance();
            Check(step.Type == P.StepType.Line && step.Character == "GUARD", $"act 2: the guard shouts (got {Describe(step)})");
            g.Patter.OpenFlow("watch", "gate");                      // a second Patter flow, mid-scene
        }

        // --- the one save, and the pass's registry helpers ---------------------------------

        /// <summary>Which package's helpers the game writes and reads its registry
        /// through, for the current pass.</summary>
        private sealed class Saver
        {
            public string Name;
            public Func<ScopeRegistry, JObject> SaveRegistry;
            public Action<ScopeRegistry, JObject> LoadRegistry;
        }

        private static readonly Saver ThroughPatterSave = new Saver
        {
            Name = "Patterplay's PatterSave",
            SaveRegistry = P.PatterSave.SaveRegistry,
            LoadRegistry = P.PatterSave.LoadRegistry,
        };

        private static readonly Saver ThroughStoryletSave = new Saver
        {
            Name = "the Storylet Engine's StoryletSave",
            SaveRegistry = S.StoryletSave.SaveRegistry,
            LoadRegistry = S.StoryletSave.LoadRegistry,
        };

        private static Saver _saver = ThroughPatterSave;

        /// <summary>The game's one save, through a string and back as a save file
        /// would travel: the registry's values once, and each engine's part.</summary>
        private static JObject SaveAll(Game g)
        {
            var file = new JObject
            {
                ["registry"] = _saver.SaveRegistry(g.Registry),
                ["patter"] = P.PatterSave.Envelope(g.Patter.SaveGame()),
                ["storylets"] = S.StoryletSave.ToJson(g.Storylets.SaveGame()),
            }.ToString(Formatting.None);
            return JObject.Parse(file);
        }

        private static void LoadPatter(P.Engine engine, JObject save) => P.PatterSave.DeserializeState(engine, save["patter"].ToString(Formatting.None));

        private static void LoadStorylets(S.Engine engine, JObject save) => engine.LoadGame(S.StoryletSave.FromJson((JObject)save["storylets"]));

        private static List<string> Dealt(S.Flow flow) => flow.Deal("q").Select(c => c.GameId).ToList();

        // --- the cases -----------------------------------------------------------------

        private static readonly List<(string Name, Action Run)> Cases = new List<(string, Action)>
        {
            ("each engine reads the other's writes through the one registry", () =>
            {
                var g = CombinedGameOf();
                PlayFirstPart(g);
                End(g.Patter.GetFlow("guard").Advance(), "onExit: alarm +10, visits +1");
                Num(g.Registry.Get("world", "alarm"), 11, "1 from the heist, 10 from the guard");
                Num(g.Patter.GetProperty("@story.act"), 2, "Patter reads the Storylet Engine's scope");
                Num(g.Storylets.GetProperty("patter.visits"), 1, "and the Storylet Engine reads Patter's");
                var dealt = Dealt(g.Storylets.GetFlow("thief"));
                Check(dealt.Contains("manhunt"), "the storylet gated on Patter's write is dealt now: " + string.Join(",", dealt));
            }),

            ("saves every property once, in the registry; neither engine's save holds one", () =>
            {
                var g = CombinedGameOf();
                PlayFirstPart(g);
                g.Patter.GetFlow("guard").Advance();
                var save = SaveAll(g);
                Same(save["registry"]["world"], @"{ ""alarm"": 11 }", "save.registry.world");
                Same(save["registry"]["story"], @"{ ""act"": 2 }", "save.registry.story");
                Same(save["registry"]["patter"], @"{ ""visits"": 1 }", "save.registry.patter");
                // Patter's part is its envelope, { schema, save }: the registry would sit in `save`.
                Check(save["patter"]["registry"] == null && save["patter"]["save"] != null && save["patter"]["save"]["registry"] == null,
                    "Patter's save holds a registry: " + save["patter"].ToString(Formatting.None));
                Check(save["storylets"]["registry"] == null, "the Storylet Engine's save holds a registry: " + save["storylets"].ToString(Formatting.None));
                Same(save["storylets"]["shared"], @"{ ""spent"": [] }", "save.storylets.shared");
                // The owner label groups one examiner's rows by engine.
                var owners = g.Registry.ListProperties().Select(r => r.Owner).Distinct().OrderBy(o => o, StringComparer.Ordinal).ToList();
                Check(owners.SequenceEqual(new[] { "Game", "Patter", "Storylet Engine" }), "the owner labels: " + string.Join(",", owners));
            }),

            ("resumes both engines from the one save, registry first", () => Resumes(true)),

            ("resumes both engines from the one save, engines first", () => Resumes(false)),

            ("loads across content drift in both engines, and Patter hot-swaps without disturbing the other", () =>
            {
                var g1 = CombinedGameOf();
                PlayFirstPart(g1);
                var save = SaveAll(g1);

                // A newer build: the Storylet Engine declares a new @story property, Patter rewords a line.
                var g2 = CombinedGameOf(StoryletBundle(true), "Stop, thief!");
                _saver.LoadRegistry(g2.Registry, (JObject)save["registry"]);
                LoadPatter(g2.Patter, save);
                LoadStorylets(g2.Storylets, save);
                Num(g2.Storylets.GetProperty("story.rumours"), 0, "new: its default");
                Num(g2.Storylets.GetProperty("story.act"), 2, "known: restored");

                End(g2.Patter.GetFlow("guard").Advance(), "the guard ends (visits 0 -> 1, alarm 1 -> 11)");

                // A live Patter edit mid-game: its bags are handed over on the same registry.
                var swapped = g2.Patter.HotSwap(PatterBundle("Halt!"));
                Num(swapped.GetProperty("@visits"), 1, "Patter's own value, carried over");
                Num(swapped.GetProperty("@story.act"), 2, "@story.act after the swap");
                var watch = swapped.GetFlow("watch");
                Check(watch != null, "the watch's flow survived the swap");
                var step = watch.Advance();
                Check(step.Type == P.StepType.Line && step.Text == "Halt!", $"the watch speaks the new line (got {Describe(step)})");
                End(watch.Advance(), "then ends");
                Num(swapped.GetProperty("@visits"), 2, "@visits after the watch");
                Num(g2.Registry.Get("world", "alarm"), 21, "world.alarm after the watch");
                Num(g2.Storylets.GetProperty("story.act"), 2, "the other engine never noticed");
            }),

            ("a card names @patter directly, and the Storylet Engine hot-swaps on the shared registry", () =>
            {
                var g = CombinedGameOf();
                PlayFirstPart(g);
                var thief = g.Storylets.GetFlow("thief");
                var dealt = Dealt(thief);
                Check(!dealt.Contains("patron"), "visits 0: the patron is not dealt yet: " + string.Join(",", dealt));
                g.Patter.GetFlow("guard").Advance();                                   // the guard's exit: visits 1
                dealt = Dealt(thief);
                Check(dealt.Contains("patron"), "visits 1: the patron is dealt: " + string.Join(",", dealt));
                thief.Play("patron", "tip", "q");
                Num(g.Patter.GetProperty("@visits"), 11, "a storylet wrote Patter's value");

                // A live Storylets edit mid-game, on the registry Patter shares.
                var swap = g.Storylets.HotSwap(StoryletBundle(true));
                var defaulted = string.Join(",", swap.Report.DefaultedProperties.Select(d => (d.Flow ?? "") + ":" + d.Path));
                Check(defaulted == ":story.rumours", "report.defaultedProperties: " + defaulted);
                Num(swap.Engine.GetProperty("story.act"), 2, "story.act carried");
                Num(swap.Engine.GetProperty("story.rumours"), 0, "story.rumours defaulted");
                Num(g.Patter.GetProperty("@story.act"), 2, "Patter reads the replacement's @story");
                Num(g.Registry.Get("patter", "visits"), 11, "and its own values stand");
            }),

            ("a token clash fails as the game combines its engines, naming who holds it", () =>
            {
                var registry = new ScopeRegistry();
                new S.Engine(StoryletBundle(), new S.EngineOptions { Registry = registry });
                var before = _saver.SaveRegistry(registry).ToString(Formatting.None);
                ThrowsExactly<S.StoryletError>(() => new S.Engine(StoryletBundle(), new S.EngineOptions { Registry = registry }),
                    "scope '@story' is already registered by Storylet Engine", "a second Storylet Engine");
                Check(_saver.SaveRegistry(registry).ToString(Formatting.None) == before, "the refused engine left the registry changed");
                new P.Engine(PatterBundle(), new P.EngineOptions { Registry = registry });
                ThrowsExactly<P.EvalError>(() => new P.Engine(PatterBundle(), new P.EngineOptions { Registry = registry }),
                    "scope '@patter' is already registered by Patter", "a second Patter");
            }),
        };

        private static void Resumes(bool registryFirst)
        {
            var g1 = CombinedGameOf();
            PlayFirstPart(g1);
            var save = SaveAll(g1);

            var g2 = CombinedGameOf();
            if (registryFirst) _saver.LoadRegistry(g2.Registry, (JObject)save["registry"]);
            LoadPatter(g2.Patter, save);
            LoadStorylets(g2.Storylets, save);
            if (!registryFirst) _saver.LoadRegistry(g2.Registry, (JObject)save["registry"]);

            Num(g2.Registry.Get("story", "act"), 2, "story.act");
            Num(g2.Registry.Get("world", "alarm"), 1, "world.alarm");
            // Patter resumes the guard mid-line: the exit writes land on the restored world.
            var guard = g2.Patter.GetFlow("guard");
            Check(guard != null, "the guard's flow resumed");
            End(guard.Advance(), "the guard ends");
            Num(g2.Registry.Get("world", "alarm"), 11, "world.alarm after the guard");
            // The Storylet Engine's spent heist stayed spent; the manhunt is open.
            var thief = g2.Storylets.GetFlow("thief");
            Check(thief != null, "the thief's flow resumed");
            var dealt = Dealt(thief);
            Check(dealt.Contains("manhunt"), "the manhunt is open: " + string.Join(",", dealt));
            Check(!dealt.Contains("heist"), "the heist stayed spent: " + string.Join(",", dealt));
            // And a second save of the resumed game carries the same shape.
            var keys = ((JObject)save["registry"]).Properties().Select(p => p.Name).OrderBy(k => k, StringComparer.Ordinal).ToList();
            var again = ((JObject)SaveAll(g2)["registry"]).Properties().Select(p => p.Name).OrderBy(k => k, StringComparer.Ordinal).ToList();
            Check(again.SequenceEqual(keys), $"a second save's registry keys: {string.Join(",", again)}, expected {string.Join(",", keys)}");
        }

        /// <summary>Not in the JS test, which has one registry saver: a game running
        /// both packages may write its registry through either and read it through
        /// the other.</summary>
        private static void CrossedSavers()
        {
            var g1 = CombinedGameOf();
            PlayFirstPart(g1);
            var byPatter = P.PatterSave.SaveRegistry(g1.Registry);
            var byStorylets = S.StoryletSave.SaveRegistry(g1.Registry);
            Check(JToken.DeepEquals(Normalise(byPatter), Normalise(byStorylets)),
                $"the two helpers wrote different JSON: {byPatter.ToString(Formatting.None)} / {byStorylets.ToString(Formatting.None)}");
            foreach (var (write, read, label) in new[]
            {
                (ThroughPatterSave, ThroughStoryletSave, "written by PatterSave, read by StoryletSave"),
                (ThroughStoryletSave, ThroughPatterSave, "written by StoryletSave, read by PatterSave"),
            })
            {
                var text = write.SaveRegistry(g1.Registry).ToString(Formatting.None);
                var g2 = CombinedGameOf();
                read.LoadRegistry(g2.Registry, JObject.Parse(text));
                Num(g2.Registry.Get("story", "act"), 2, label + ": story.act");
                Num(g2.Registry.Get("world", "alarm"), 1, label + ": world.alarm");
                Num(g2.Patter.GetProperty("@story.act"), 2, label + ": Patter reads it");
            }
        }

        // --- the run ---------------------------------------------------------------------

        /// <summary>Run every case on each registry saver, then the crossed case.
        /// Prints an ok / FAIL line per case through <paramref name="print"/> and
        /// returns the passes, the total, and each failure as "case: what".</summary>
        public static (int Passed, int Total, List<string> Failures) Run(Action<string> print)
        {
            var failures = new List<string>();
            int passed = 0, total = 0;
            void One(string label, Action body)
            {
                total++;
                string failure = null;
                try { body(); }
                catch (Exception e) { failure = e is Failed ? e.Message : $"threw {e.GetType().Name}: {e.Message}"; }
                if (failure == null)
                {
                    passed++;
                    print("  ok   " + label);
                }
                else
                {
                    failures.Add(label + ": " + failure);
                    print("  FAIL " + label + "\n         " + failure);
                }
            }
            foreach (var saver in new[] { ThroughPatterSave, ThroughStoryletSave })
            {
                _saver = saver;
                print("-- the registry saved through " + saver.Name);
                foreach (var (name, run) in Cases) One(name, run);
            }
            print("-- either package's registry helpers");
            One("a registry written through either package reads back through the other", CrossedSavers);
            return (passed, total, failures);
        }

        // --- assertions --------------------------------------------------------------------

        private sealed class Failed : Exception
        {
            public Failed(string message) : base(message) { }
        }

        private static void Check(bool ok, string what)
        {
            if (!ok) throw new Failed(what);
        }

        private static void End(P.StepResult step, string what)
        {
            if (step == null || step.Type != P.StepType.End) throw new Failed($"{what}: expected the end, got {Describe(step)}");
        }

        private static string Describe(P.StepResult step)
        {
            if (step == null) return "nothing";
            return step.Type + (step.Character != null ? " " + step.Character : "") + (step.Text != null ? " \"" + step.Text + "\"" : "");
        }

        private static void Num(ExprValue v, double want, string what)
        {
            if (v == null || !v.IsNumber || v.AsNumber != want) throw new Failed($"{what}: expected {want}, got {(v == null ? "nothing" : v.ToJsonString())}");
        }

        /// <summary>A refusal the engine must throw as ITS OWN type (exactly T, never
        /// the kernel's RegistryError), carrying the kernel's message.</summary>
        private static void ThrowsExactly<T>(Action act, string contains, string what) where T : Exception
        {
            try { act(); }
            catch (Exception e)
            {
                if (e.GetType() != typeof(T)) throw new Failed($"{what}: threw {e.GetType().Name} \"{e.Message}\", expected {typeof(T).Name}");
                // As a whole name: "registered by Patter" must not pass for a
                // holder named "Patterplay".
                var at = e.Message.IndexOf(contains, StringComparison.Ordinal);
                var end = at + contains.Length;
                if (at < 0 || (end < e.Message.Length && char.IsLetterOrDigit(e.Message[end])))
                {
                    throw new Failed($"{what}: threw \"{e.Message}\", expected \"{contains}\"");
                }
                return;
            }
            throw new Failed($"{what}: did not throw");
        }

        /// <summary>Numbers as JSON sees them: an integral float and an integer are
        /// one value to a save file (and to the JS test's toEqual).</summary>
        private static JToken Normalise(JToken t)
        {
            if (t == null) return JValue.CreateNull();
            switch (t.Type)
            {
                case JTokenType.Object:
                    var o = new JObject();
                    foreach (var p in ((JObject)t).Properties()) o[p.Name] = Normalise(p.Value);
                    return o;
                case JTokenType.Array:
                    return new JArray(((JArray)t).Select(Normalise));
                case JTokenType.Float:
                    var d = t.Value<double>();
                    return d == Math.Floor(d) && Math.Abs(d) < 9e15 ? new JValue((long)d) : new JValue(d);
                default:
                    return t.DeepClone();
            }
        }

        /// <summary>Key order does not matter (the JS test's toEqual); every key and
        /// value does.</summary>
        private static void Same(JToken actual, string expectedJson, string what)
        {
            var expected = JToken.Parse(expectedJson);
            if (!JToken.DeepEquals(Normalise(actual), Normalise(expected)))
            {
                throw new Failed($"{what}: expected {expected.ToString(Formatting.None)}, got {(actual == null ? "nothing" : actual.ToString(Formatting.None))}");
            }
        }
    }
}
