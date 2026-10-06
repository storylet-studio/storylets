// Durable state as a feature (ruling H, 2026-10-06), from the GAME's side. A
// port of packages/runtime/test/durable.test.ts's "durable halves", case for
// case: the corpus pins what the durable verbs carry and what a load reports
// (keepPocket, keepMemory, newRun, openFlowDurable); these are the host API's
// edges a script cannot reach. The shape of a half as a game stores it (the
// JSON below is the reference's own JSON.stringify of the same run, so the
// wire text is held byte for byte), the refusals made before anything moves,
// a memory loaded into an engine that is not fresh, and a closed flow.
//
// The bundle is the JS test's, expanded by the conformance scaffold
// (expandBundle).

using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using StoryletStudio.StoryletEngine;
using Wildwinter.Expr;

namespace StoryletStudio.StoryletEngine.TestHost
{
    internal static class Durable
    {
        /// <summary>durable.test.ts's bundle, through expandBundle: story `souls`
        /// (shared, durable), `oath` and `seal` (per flow, durable; seal is
        /// writable: false) and `gold` (shared, this run only); deck k_main's
        /// c_once (a per-flow durable one-shot) and deck k_relics, shared and
        /// durable, with c_relic; hand h_q (gameId q).</summary>
        private const string BundleJson = @"
{""schema"":""storylets/bundle@0"",""content"":{""project"":""conf"",""version"":""0.0.0"",""hash"":""""},""metadata"":""full"",""settings"":{""playAdvancesTurns"":1},""world"":{""properties"":[]},""story"":{""properties"":[{""name"":""souls"",""type"":""number"",""default"":0,""durable"":true},{""name"":""oath"",""type"":""enum"",""default"":""iron"",""values"":[""iron"",""oak""],""shared"":false,""durable"":true},{""name"":""seal"",""type"":""number"",""default"":0,""shared"":false,""durable"":true,""writable"":false},{""name"":""gold"",""type"":""number"",""default"":0}]},""boxes"":[{""id"":""b_x"",""gameId"":""box"",""ranking"":{""specificity"":true},""fields"":[],""properties"":[],""tagGroups"":[{""id"":""d_zone"",""gameId"":""zone"",""tags"":[{""id"":""v_docks"",""gameId"":""docks"",""properties"":[{""name"":""danger"",""type"":""number"",""default"":0}]},{""id"":""v_market"",""gameId"":""market""}]}],""decks"":[{""id"":""k_main"",""gameId"":""main"",""properties"":[],""cards"":[{""id"":""c_once"",""gameId"":""once"",""priority"":2,""redraw"":""never"",""durable"":true,""outcomes"":[]}]},{""id"":""k_relics"",""gameId"":""relics"",""shared"":true,""durable"":true,""properties"":[],""cards"":[{""id"":""c_relic"",""gameId"":""relic"",""priority"":1,""redraw"":""never"",""outcomes"":[]}]}],""handTemplates"":[],""hands"":[{""id"":""h_q"",""gameId"":""q"",""rule"":{""slots"":""unbounded""}}]}]}";

        /// <summary>The reference's JSON.stringify of played()'s two halves.</summary>
        private const string MemoryText =
            @"{""schema"":""storylets/durable@1"",""content"":{""project"":""conf"",""version"":""0.0.0"",""hash"":""""},""values"":{""story.souls"":4},""spent"":[""relic""]}";
        private const string PocketText =
            @"{""schema"":""storylets/durable@1"",""content"":{""project"":""conf"",""version"":""0.0.0"",""hash"":""""},""values"":{""story.oath"":""oak"",""story.seal"":9},""spent"":[""once""]}";

        private static Bundle NewBundle() => BundleLoader.Parse(BundleJson);

        /// <summary>A run that has spent both one-shots and moved every durable
        /// value.</summary>
        private static Engine Played()
        {
            var engine = new Engine(NewBundle());
            var flow = engine.OpenFlow("alice");
            flow.SetProperty("story.souls", ExprValue.Num(4));
            flow.SetProperty("story.oath", ExprValue.Str("oak"));
            flow.SetProperty("story.seal", ExprValue.Num(9));
            foreach (var card in flow.Deal("q")) flow.Play(card.GameId, "", "q");
            return engine;
        }

        private static string Text(DurableSave half) => StoryletSave.ToJson(half).ToString(Formatting.None);

        private static DurableSave Parse(string text) => StoryletSave.DurableFromJson(JObject.Parse(text));

        /// <summary>A half with one part replaced, through its JSON, as the JS
        /// test's object spread makes one.</summary>
        private static DurableSave With(DurableSave half, Action<JObject> edit)
        {
            var o = StoryletSave.ToJson(half);
            edit(o);
            return StoryletSave.DurableFromJson(o);
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

        private static void Equal(string got, string want, string what)
        {
            if (got != want) throw new Failed($"{what}: expected {want}, got {got}");
        }

        private static void Value(ExprValue got, ExprValue want, string what)
        {
            if (got == null || !got.ValueEquals(want)) throw new Failed($"{what}: expected {want.ToJsonString()}, got {(got == null ? "nothing" : got.ToJsonString())}");
        }

        /// <summary>The refusal is a StoryletError, and says what the reference
        /// says.</summary>
        private static void Throws(Action act, string contains, string what)
        {
            try { act(); }
            catch (StoryletError e)
            {
                if (!e.Message.Contains(contains)) throw new Failed($"{what}: threw \"{e.Message}\", expected \"{contains}\"");
                return;
            }
            catch (Exception e)
            {
                throw new Failed($"{what}: threw {e.GetType().Name} \"{e.Message}\", expected a StoryletError");
            }
            throw new Failed($"{what}: did not throw");
        }

        private static string Paths(List<LoadProperty> list) =>
            "[" + string.Join(",", list.Select(p => (p.Flow ?? "") + ":" + p.Path)) + "]";

        // --- the cases -------------------------------------------------------------

        private static readonly List<(string Name, Action Run)> Cases = new List<(string, Action)>
        {
            ("are plain data: the schema tag, the build, values by address and spends by gameId", () =>
            {
                var engine = Played();
                Equal(Text(engine.SaveDurable()), MemoryText, "the memory");
                var pocket = engine.GetFlow("alice").SaveDurable();
                Equal(Text(pocket), PocketText, "the pocket");
                // Keys in byte order, so the same state writes the same text.
                Equal(string.Join(",", pocket.Values.Keys), "story.oath,story.seal", "the pocket's key order");
                // A copy: changing it changes nothing in the engine.
                pocket.Values.Set("story.oath", ExprValue.Str("iron"));
                pocket.Spent.Clear();
                Value(engine.GetFlow("alice").GetProperty("story.oath"), ExprValue.Str("oak"), "the flow after its pocket was changed");
                Equal(Text(engine.GetFlow("alice").SaveDurable()), PocketText, "a second pocket");
            }),

            ("survive JSON, which is how a game keeps them", () =>
            {
                var engine = Played();
                var memory = Parse(Text(engine.SaveDurable()));
                var pocket = Parse(Text(engine.GetFlow("alice").SaveDurable()));
                var next = new Engine(NewBundle());
                Check(next.LoadDurable(memory).Exact, "the memory did not load exactly");
                bool? exact = null;
                var flow = next.OpenFlow("alice", new OpenFlowOptions { Durable = pocket, OnRestoreReport = r => exact = r.Exact });
                Check(exact == true, "the pocket did not open exactly");
                // A writable: false value goes back: that flag is the story's
                // promise, and putting a player's own state back is the game
                // speaking.
                Value(flow.GetProperty("story.seal"), ExprValue.Num(9), "story.seal");
                Equal(Text(next.SaveDurable()), MemoryText, "the memory, saved again");
                Equal(Text(flow.SaveDurable()), PocketText, "the pocket, saved again");
            }),

            ("refuse an unknown schema and another project's state before anything moves", () =>
            {
                var memory = Played().SaveDurable();
                var next = new Engine(NewBundle());
                var before = StoryletSave.ToJson(next.SaveGame()).ToString(Formatting.None);
                Throws(() => next.LoadDurable(With(memory, o => o["schema"] = "storylets/durable@9")),
                    "unsupported durable schema: storylets/durable@9", "an unknown schema");
                Throws(() => next.LoadDurable(With(memory, o => o["content"]["project"] = "other")),
                    "durable state is for project \"other\", bundle is \"conf\"", "another project");
                Throws(() => next.LoadDurable(null), "unsupported durable schema", "no memory at all");
                Equal(StoryletSave.ToJson(next.SaveGame()).ToString(Formatting.None), before, "the engine after three refusals");
            }),

            ("refuse a pocket for another project as the flow opens, leaving the open flow as it was", () =>
            {
                var engine = Played();
                var held = engine.GetFlow("alice");
                var pocket = held.SaveDurable();
                Throws(() => engine.OpenFlow("alice", new OpenFlowOptions { Durable = With(pocket, o => o["content"]["project"] = "other") }),
                    "durable state is for project \"other\"", "another project's pocket");
                Check(!held.IsClosed, "the refused open closed the flow");
                Throws(() => engine.OpenFlow("alice", new OpenFlowOptions { Durable = pocket, Restore = engine.SaveFlow("alice") }),
                    "openFlow \"alice\": restore and durable cannot be given together", "a pocket with a restore");
                Check(!held.IsClosed, "the refused open closed the flow");
                Value(held.GetProperty("story.oath"), ExprValue.Str("oak"), "the held flow's oath");
            }),

            ("make the memory exactly the engine's durable half, and touch nothing else", () =>
            {
                var memory = Played().SaveDurable();
                // An engine that is NOT fresh: a durable value moved, a run-scoped one too.
                var next = new Engine(NewBundle());
                next.OpenFlow("bob").SetProperty("story.gold", ExprValue.Num(3));
                next.SetProperty("story.souls", ExprValue.Num(8));
                var report = next.LoadDurable(With(memory, o => o["values"] = new JObject()));
                // The memory carries no souls, so it takes its default, as the report says.
                Equal(Paths(report.DefaultedProperties), "[:story.souls]", "defaultedProperties");
                Value(next.GetProperty("story.souls"), ExprValue.Num(0), "story.souls");
                Value(next.GetProperty("story.gold"), ExprValue.Num(3), "story.gold");
                Check(!next.GetFlow("bob").IsClosed, "the memory closed a flow");
            }),

            ("name spends by gameId: an internal id is a card this build does not have", () =>
            {
                var next = new Engine(NewBundle());
                var memory = Parse(@"{""schema"":""storylets/durable@1"",""content"":{""project"":""conf"",""version"":""0.0.0"",""hash"":""""},""values"":{""story.souls"":1},""spent"":[""c_relic""]}");
                Equal(string.Join(",", next.LoadDurable(memory).DroppedSpent), "c_relic", "an internal id");
                // And a pocket's spend on the memory's side is not the memory's to carry.
                Equal(string.Join(",", next.LoadDurable(With(memory, o => o["spent"] = new JArray("once"))).DroppedSpent), "once", "a pocket's spend");
            }),

            ("quote a missing or non-string schema and project as JS prints them", () =>
            {
                var next = new Engine(NewBundle());
                Throws(() => next.LoadDurable(Parse(@"{}")), "unsupported durable schema: undefined", "no schema");
                Throws(() => next.LoadDurable(Parse(@"{""schema"":null}")), "unsupported durable schema: null", "a null schema");
                Throws(() => next.LoadDurable(Parse(@"{""schema"":42}")), "unsupported durable schema: 42", "a number schema");
                Throws(() => next.LoadDurable(Parse(@"{""schema"":""storylets/durable@1""}")),
                    "durable state is for project \"undefined\", bundle is \"conf\"", "no content");
                Throws(() => next.LoadDurable(Parse(@"{""schema"":""storylets/durable@1"",""content"":{}}")),
                    "durable state is for project \"undefined\", bundle is \"conf\"", "no project");
                Throws(() => next.LoadDurable(Parse(@"{""schema"":""storylets/durable@1"",""content"":{""project"":5}}")),
                    "durable state is for project \"5\", bundle is \"conf\"", "a number project");
            }),

            ("report a value no property can hold, as JS does, and write nothing for it", () =>
            {
                // The same input the JS reference reports as below: a null or an
                // object fits no declaration (retyped where the address is
                // durable on that side, dropped where it is not), and so does [1]
                // for a number.
                var next = new Engine(NewBundle());
                next.SetProperty("story.souls", ExprValue.Num(8));
                var memory = Parse(@"{""schema"":""storylets/durable@1"",""content"":{""project"":""conf"",""version"":""0.0.0"",""hash"":""""},""values"":{""story.souls"":null,""story.gone"":{},""story.oath"":""oak""},""spent"":[]}");
                var report = next.LoadDurable(memory);
                Equal(Paths(report.DroppedProperties), "[:story.gone,:story.oath]", "the memory's droppedProperties");
                Equal(Paths(report.RetypedProperties), "[:story.souls]", "the memory's retypedProperties");
                Equal(Paths(report.DefaultedProperties), "[]", "the memory's defaultedProperties");
                Value(next.GetProperty("story.souls"), ExprValue.Num(0), "story.souls");
                // Written back out, it still carries the address, so it reports the same.
                Equal(Paths(new Engine(NewBundle()).LoadDurable(Parse(Text(memory))).RetypedProperties), "[:story.souls]",
                    "a re-written half's retypedProperties");
                LoadReport opened = null;
                var flow = next.OpenFlow("alice", new OpenFlowOptions
                {
                    Durable = Parse(@"{""schema"":""storylets/durable@1"",""content"":{""project"":""conf"",""version"":""0.0.0"",""hash"":""""},""values"":{""story.oath"":null,""story.seal"":[1],""story.souls"":[]},""spent"":[]}"),
                    OnRestoreReport = r => opened = r,
                });
                Check(opened != null, "the pocket produced no report");
                Equal(Paths(opened.DroppedProperties), "[alice:story.souls]", "the pocket's droppedProperties");
                Equal(Paths(opened.RetypedProperties), "[alice:story.oath,alice:story.seal]", "the pocket's retypedProperties");
                Equal(Paths(opened.DefaultedProperties), "[]", "the pocket's defaultedProperties");
                Value(flow.GetProperty("story.oath"), ExprValue.Str("iron"), "story.oath");
                Value(flow.GetProperty("story.seal"), ExprValue.Num(0), "story.seal");
            }),

            ("are refused on a closed flow, as every verb is", () =>
            {
                var engine = Played();
                var flow = engine.GetFlow("alice");
                engine.CloseFlow("alice");
                Throws(() => flow.SaveDurable(), "flow \"alice\" is closed", "a closed flow");
            }),
        };

        /// <summary>Run every case; returns the passes and each failure as
        /// "case: what".</summary>
        public static (int Passed, int Total, List<string> Failures) Run()
        {
            var failures = new List<string>();
            int passed = 0;
            foreach (var (name, run) in Cases)
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
            return (passed, Cases.Count, failures);
        }
    }
}
