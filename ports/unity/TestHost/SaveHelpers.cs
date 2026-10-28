// The save helpers' @world order (2026-10-28, the hands-on review's foundation
// 7 left open): a port of play-helpers' save.test.ts "puts the saved @world into
// a container it is given before the engine loads". A load checks every held
// card against the world it will play in, so a container handed to LoadState
// takes the saved world FIRST; without one the check reads the game's own world
// and drops the card; a refused load leaves the container as it was.
//
// The bundles are the JS test's, expanded by the conformance scaffold
// (expandBundle).

using System.Collections.Generic;
using System.Linq;
using StoryletStudio.StoryletEngine;
using Wildwinter.Expr;

namespace StoryletStudio.StoryletEngine.TestHost
{
    internal static class SaveHelpers
    {
        private const string OwlJson = @"{""schema"":""storylets/bundle@0"",""content"":{""project"":""conf"",""version"":""0.0.0"",""hash"":""""},""metadata"":""full"",""settings"":{""playAdvancesTurns"":1},""world"":{""properties"":[{""name"":""night"",""type"":""boolean"",""default"":false}]},""story"":{""properties"":[]},""boxes"":[{""id"":""b_x"",""gameId"":""box"",""ranking"":{""specificity"":true},""fields"":[],""properties"":[],""tagGroups"":[{""id"":""d_zone"",""gameId"":""zone"",""tags"":[{""id"":""v_docks"",""gameId"":""docks"",""properties"":[{""name"":""danger"",""type"":""number"",""default"":0}]},{""id"":""v_market"",""gameId"":""market""}]}],""decks"":[{""id"":""k_main"",""gameId"":""main"",""properties"":[],""cards"":[{""id"":""c_owl"",""gameId"":""owl"",""condition"":{""src"":""@world.night"",""ast"":[""sv"",""world"",""night""]},""priority"":0,""redraw"":""always"",""outcomes"":[]}]}],""handTemplates"":[],""hands"":[{""id"":""h_q"",""gameId"":""q"",""rule"":{""slots"":""unbounded""}}]}]}";
        private const string ElsewhereJson = @"{""schema"":""storylets/bundle@0"",""content"":{""project"":""elsewhere"",""version"":""0.0.0"",""hash"":""""},""metadata"":""full"",""settings"":{""playAdvancesTurns"":1},""world"":{""properties"":[{""name"":""night"",""type"":""boolean"",""default"":false}]},""story"":{""properties"":[]},""boxes"":[{""id"":""b_x"",""gameId"":""box"",""ranking"":{""specificity"":true},""fields"":[],""properties"":[],""tagGroups"":[{""id"":""d_zone"",""gameId"":""zone"",""tags"":[{""id"":""v_docks"",""gameId"":""docks"",""properties"":[{""name"":""danger"",""type"":""number"",""default"":0}]},{""id"":""v_market"",""gameId"":""market""}]}],""decks"":[{""id"":""k_main"",""gameId"":""main"",""properties"":[],""cards"":[{""id"":""c_x"",""gameId"":""x"",""priority"":0,""redraw"":""always"",""outcomes"":[]}]}],""handTemplates"":[],""hands"":[{""id"":""h_q"",""gameId"":""q"",""rule"":{""slots"":""unbounded""}}]}]}";

        /// <summary>A game's own @world: a host scope and the helpers' container at once.</summary>
        private sealed class World : IHostScope, IWorldContainer
        {
            private readonly OrderedMap<string, ExprValue> _values = new OrderedMap<string, ExprValue>();
            public World(bool night) { _values.Set("night", ExprValue.Bool(night)); }
            public ExprValue Get(string name) => _values.TryGetValue(name, out var v) ? v : null;
            public bool CanSet => true;
            public void Set(string name, ExprValue value) { _values.Set(name, value); }
            public bool Night => Get("night").AsBool;
            public OrderedMap<string, ExprValue> Snapshot()
            {
                var copy = new OrderedMap<string, ExprValue>();
                foreach (var pair in _values) copy.Set(pair.Key, pair.Value);
                return copy;
            }
            public void Load(OrderedMap<string, ExprValue> values) { foreach (var pair in values) _values.Set(pair.Key, pair.Value); }
        }

        private static Engine EngineOver(string json, World world) =>
            new Engine(BundleLoader.Parse(json), new EngineOptions { Seed = 0, HostScopes = new Dictionary<string, IHostScope> { ["world"] = world } });

        public static (int Passed, int Total, List<string> Failures) Run()
        {
            var failures = new List<string>();
            var total = 0;
            void Check(bool ok, string what) { total++; if (!ok) failures.Add(what); }

            var saving = new World(true);
            var a = EngineOver(OwlJson, saving);
            Check(a.OpenFlow("main").Deal("q").Select(c => c.GameId).SequenceEqual(new[] { "owl" }), "the owl is dealt at night");
            var file = StoryletSave.SaveState(a, saving.Snapshot());

            var loading = new World(false);
            var b = EngineOver(OwlJson, loading);
            LoadReport report = null;
            StoryletSave.LoadState(b, file, r => report = r, loading);
            Check(loading.Night, "the container took the saved world");
            Check(report != null && report.Evicted.Count == 0, "the load kept the owl: it read the saved world");
            Check(b.GetFlow("main").Board()["q"].Select(c => c.GameId).SequenceEqual(new[] { "owl" }), "the owl is held after the load");

            var plain = new World(false);
            var c2 = EngineOver(OwlJson, plain);
            LoadReport costly = null;
            StoryletSave.LoadState(c2, file, r => costly = r);
            Check(costly != null && costly.Evicted.Select(e => e.Card).SequenceEqual(new[] { "owl" }), "without the container the check reads the game's own world and drops the owl");

            var kept = new World(false);
            var other = EngineOver(ElsewhereJson, kept);
            var refused = false;
            try { StoryletSave.LoadState(other, file, null, kept); } catch (StoryletError) { refused = true; }
            Check(refused, "a save for another project is refused");
            Check(!kept.Night, "a refused load puts the container back");

            var bag = new PropertyBag(new List<ScopeDeclaration> { new ScopeDeclaration { Name = "night", Type = "boolean", Default = ExprValue.Bool(false) } });
            var wrapped = StoryletSave.WorldOf(bag);
            var snap = wrapped.Snapshot();
            bag.Set("night", ExprValue.Bool(true), host: true);
            Check(!snap["night"].AsBool, "a bag's snapshot is a copy");
            wrapped.Load(snap);
            Check(!bag.Get("night").AsBool, "and loads back into the bag");

            return (total - failures.Count, total, failures);
        }
    }
}
