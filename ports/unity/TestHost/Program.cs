// The corpus TestHost: load corpus.json and replay every family through the C#
// Storylet Engine runtime, asserting the results the JS reference produces -
// the port's half of the parity contract. The four runner obligations are
// documented in packages/conformance/src/runner.ts and re-implemented here
// exactly.
//
//   dotnet run --project ports/unity/TestHost [-- <path-to-corpus.json>]
//
// Families: expressions (evaluator + dialect), specificity (matched-constraint
// scorer), peek (bundle + one ask, asked twice), scripted (deals, plays,
// turns, save/load).

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using StoryletStudio.StoryletEngine;

namespace StoryletStudio.StoryletEngine.TestHost
{
    internal static class Program
    {
        private static int _fails;

        private static int Main(string[] args)
        {
            // The manual Live Link pairing check (LiveLinkFixture.Connect): not a
            // corpus run, it needs a listening Storyletter.
            if (args.Length > 0 && args[0] == "--live-link-connect")
            {
                var corpus = FindCorpus();
                if (corpus == null) { Console.Error.WriteLine("repo root not found"); return 2; }
                var repoRoot = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(corpus), "..", ".."));
                return LiveLinkFixture.Connect(repoRoot, args.Length > 1 ? args[1] : StoryletLiveLink.DefaultUrl);
            }

            string path = args.Length > 0 ? args[0] : FindCorpus();
            if (path == null || !File.Exists(path))
            {
                Console.Error.WriteLine($"corpus not found: {path ?? "packages/conformance/corpus.json"}");
                return 2;
            }

            var root = JObject.Parse(File.ReadAllText(path));
            int version = root.Value<int>("version");

            var expressions = (JArray)root["expressions"];
            var specificity = (JArray)root["specificity"];
            var peek = (JArray)root["peek"];
            var scripted = (JArray)root["scripted"];

            int e = RunExpressions(expressions);
            int sp = RunSpecificity(specificity);
            int p = RunPeek(peek);
            int s = RunScripted(scripted);
            // Read-only @world with a HOST resolver bound: the corpus case pins the
            // self-backed (kernel) path; this reaches the engine's own check, which
            // only a bound resolver does. Same probe in the JS, C++ and Godot harnesses.
            foreach (var c in scripted)
            {
                var cname = c.Value<string>("name") ?? "";
                if (!cname.StartsWith("an outcome may not write a read-only")) continue;
                foreach (var f in RunReadOnlyWorldProbe((JObject)c["bundle"])) { Fail("scripted", cname, f); s = Math.Max(0, s - 1); }
            }
            int d = RunDescribe(peek);
            int m = RunDescribeMaps();
            int l = RunLiveLinkFixture(path);

            Console.WriteLine($"corpus version {version}");
            Console.WriteLine($"describeBundle checks: {d}/1  maps: {m}/1  live-link fixture: {l}/1");
            Console.WriteLine(
                $"expressions: {e}/{expressions.Count}  specificity: {sp}/{specificity.Count}  " +
                $"peek: {p}/{peek.Count}  scripted: {s}/{scripted.Count}");
            // The expr parity corpus sits beside ours, vendored from ../expr. Absent is
            // a FAILURE, not a skip: a parity gate that quietly does nothing when its
            // fixture is missing is the shape of check this codebase has been bitten by.
            string exprPath = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(path)) ?? ".", "expr-corpus.json");
            if (!File.Exists(exprPath))
            {
                Console.Error.WriteLine($"expr parity corpus not found: {exprPath}");
                return 2;
            }
            var exprRoot = JObject.Parse(File.ReadAllText(exprPath));
            var xprng = (JArray)exprRoot["prng"];
            var xexpr = (JArray)exprRoot["expressions"];
            int xp = RunExprPrng(xprng);
            int xe = RunExpressions(xexpr);
            // A family the corpus carries and this harness does not run is a check
            // that cannot fail here, so a missing key is a failure, not a skip.
            if (exprRoot["registry"] is not JArray xreg)
            {
                Console.Error.WriteLine("expr parity corpus has no registry family");
                return 2;
            }
            int xr = RunExprRegistry(xreg);
            Console.WriteLine(
                $"expr corpus v{exprRoot.Value<int>("version")} - " +
                $"prng: {xp}/{xprng.Count}  expressions: {xe}/{xexpr.Count}  registry: {xr}/{xreg.Count}");

            Console.WriteLine(_fails == 0 ? "ALL PASS" : $"{_fails} FAILED");
            return _fails == 0 ? 0 : 1;
        }

        /// <summary>Walk up from the working directory and the binary for the
        /// repo's packages/conformance/corpus.json.</summary>
        private static string FindCorpus()
        {
            foreach (var start in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
            {
                var dir = new DirectoryInfo(start);
                while (dir != null)
                {
                    var candidate = Path.Combine(dir.FullName, "packages", "conformance", "corpus.json");
                    if (File.Exists(candidate)) return candidate;
                    dir = dir.Parent;
                }
            }
            return null;
        }

        /// <summary>The Live Link client held to the shared fixture beside the
        /// corpus (packages/conformance/live-link/): same repo root as the corpus.</summary>
        private static int RunLiveLinkFixture(string corpusPath)
        {
            var repoRoot = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(corpusPath), "..", ".."));
            try
            {
                var failures = LiveLinkFixture.Run(repoRoot);
                foreach (var f in failures) Fail("live-link", "fixture", f);
                var applyFailures = LiveLinkFixture.RunApply(repoRoot);
                foreach (var f in applyFailures) Fail("live-link", "apply", f);
                if (failures.Count == 0 && applyFailures.Count == 0) return 1;
            }
            catch (Exception ex)
            {
                Fail("live-link", "fixture", ex.Message);
            }
            return 0;
        }

        private static void Fail(string family, string name, string detail)
        {
            _fails++;
            Console.Error.WriteLine($"  FAIL [{family}] {name}: {detail}");
        }

        private static bool ConditionPasses(StoryletValue v)
        {
            if (v.IsBool) return v.AsBool;
            if (v.IsNumber) return v.AsNumber != 0;
            return false;
        }

        // -- expressions ----------------------------------------------------------

        private static EvalContext ScopesContext(JObject scopes)
        {
            var ctx = new EvalContext();
            foreach (var scope in scopes)
            {
                var bag = new OrderedMap<string, StoryletValue>();
                foreach (var prop in (JObject)scope.Value) bag.Set(prop.Key, StoryletJson.ToValue(prop.Value));
                ctx.Scopes[scope.Key] = new BagScope(bag);
            }
            return ctx;
        }


        // -- the @wildwinter/expr parity corpus ---------------------------------
        //
        // A SECOND corpus, authored in ../expr and vendored here, holding the
        // primitives both product families share and neither family's own corpus
        // tests: seed coercion, the PRNG draw and state sequence, operator typing,
        // short-circuiting, value equality and the comparison rules. The evaluator
        // is exercised only incidentally by the storylet corpus (through dealing),
        // so a divergence in expr itself failed nothing anywhere until this existed.
        //
        // Its `expressions` section has the same shape as ours and reuses
        // RunExpressions; only the PRNG section is new.

        /// <summary>JSON has no literal for the non-finite doubles, and they are exactly
        /// the interesting coercion cases, so the corpus carries them as strings.</summary>
        private static double ExprSeed(JToken v)
        {
            if (v.Type != JTokenType.String) return v.ToObject<double>();
            switch (v.ToObject<string>())
            {
                case "NaN": return double.NaN;
                case "Infinity": return double.PositiveInfinity;
                case "-Infinity": return double.NegativeInfinity;
                default: throw new Exception($"unknown seed literal: {v.ToObject<string>()}");
            }
        }

        /// <summary>A foreign scope over a plain map, for the registry cases: the
        /// registry's own writable rule is what is under test, so the resolver
        /// accepts everything.</summary>
        private sealed class RecordResolver : IScopeResolver
        {
            private readonly Dictionary<string, StoryletValue> _store;
            public RecordResolver(Dictionary<string, StoryletValue> store) { _store = store; }
            public StoryletValue Get(string name) => _store.TryGetValue(name, out var v) ? v : null;
            public bool CanSet => true;
            public void Set(string name, StoryletValue value) { _store[name] = value; }
        }

        // The scope kernel's `writable` rule: decl.writable ?? scope.writable ?? true. A
        // case with no "scope" seeds a PropertyBag and writes to it; one with a "scope"
        // mounts the declarations as a FOREIGN scope on a ScopeRegistry, with the scope
        // default, and writes through the registry - the registry's own rule, not the
        // bag's. The value is read back on BOTH outcomes: a refusal that half-wrote is a
        // failure, and so is a "landed" write that went nowhere.
        private static int RunExprRegistry(JArray cases)
        {
            int pass = 0;
            foreach (var c in cases.Cast<JObject>())
            {
                var name = c.Value<string>("name");
                var decls = new List<ScopeDeclaration>();
                foreach (var d in ((JArray)c["declarations"]).Cast<JObject>())
                {
                    decls.Add(new ScopeDeclaration
                    {
                        Name = d.Value<string>("name"),
                        Type = d.Value<string>("type"),
                        Default = StoryletJson.ToValue(d["default"]),
                        Writable = d["writable"] == null ? (bool?)null : d.Value<bool>("writable"),
                    });
                }
                string setName = c["set"].Value<string>("name");
                var value = StoryletJson.ToValue(c["set"]["value"]);
                bool expectError = c.Value<bool?>("expectError") ?? false;
                var expected = StoryletJson.ToValue(c["expected"]);

                string error = null;
                StoryletValue readBack;
                try
                {
                    if (c["scope"] is not JObject scope)
                    {
                        var bag = new PropertyBag(decls);
                        try { bag.Set(setName, value); } catch (Exception ex) { error = ex.Message; }
                        readBack = bag.Get(setName);
                    }
                    else
                    {
                        var store = new Dictionary<string, StoryletValue>();
                        foreach (var d in decls) store[d.Name.ToLowerInvariant()] = d.Default;
                        var registry = new ScopeRegistry().DefineForeign(
                            "s", new RecordResolver(store), decls, scope.Value<bool?>("writable") ?? true);
                        try { registry.Set("s", setName, value); } catch (Exception ex) { error = ex.Message; }
                        readBack = registry.Get("s", setName);
                    }
                }
                catch (Exception ex)
                {
                    Fail("expr/registry", name, "the runner itself failed: " + ex.Message);
                    continue;
                }

                bool ok = true;
                if (expectError)
                {
                    if (error == null) { Fail("expr/registry", name, "expected a read-only refusal, the write landed"); ok = false; }
                    else if (!error.Contains("is read-only")) { Fail("expr/registry", name, "refused, but not as read-only: " + error); ok = false; }
                }
                else if (error != null) { Fail("expr/registry", name, "unexpected refusal: " + error); ok = false; }
                bool same = readBack == null ? expected == null : (expected != null && readBack.ValueEquals(expected));
                if (!same)
                {
                    Fail("expr/registry", name, $"read back {(readBack == null ? "<unset>" : readBack.ToJsonString())}, expected {expected.ToJsonString()}");
                    ok = false;
                }
                if (ok) pass++;
            }
            return pass;
        }

        private static int RunExprPrng(JArray cases)
        {
            int pass = 0;
            foreach (var c in cases.Cast<JObject>())
            {
                var name = c.Value<string>("name");
                var prng = new Mulberry32(ExprSeed(c["seed"]));

                uint wantSeed = c.Value<uint>("expectSeedState");
                if (prng.State != wantSeed)
                {
                    Fail("expr/prng", name, $"seed state {prng.State}, expected {wantSeed}");
                    continue;
                }

                var states = (JArray)c["expectStates"];
                var draws = (JArray)c["expectDraws"];
                bool ok = true;
                for (int i = 0; i < states.Count && ok; i++)
                {
                    double d = prng.Next();
                    // The corpus pins the draw's NUMERATOR, an exact uint32, so no port
                    // is held to another language's float printing.
                    uint gotDraw = (uint)Math.Round(d * 4294967296.0);
                    uint wantDraw = draws[i].ToObject<uint>();
                    uint wantState = states[i].ToObject<uint>();
                    if (gotDraw != wantDraw)
                    {
                        Fail("expr/prng", name, $"draw {i + 1} is {gotDraw}, expected {wantDraw}");
                        ok = false;
                    }
                    else if (prng.State != wantState)
                    {
                        Fail("expr/prng", name, $"state after draw {i + 1} is {prng.State}, expected {wantState}");
                        ok = false;
                    }
                    else if (!(d >= 0.0 && d < 1.0))
                    {
                        Fail("expr/prng", name, $"draw {i + 1} is {d}, outside [0, 1)");
                        ok = false;
                    }
                }
                if (ok) pass++;
            }
            return pass;
        }

        private static int RunExpressions(JArray cases)
        {
            int pass = 0;
            foreach (var c in cases.Cast<JObject>())
            {
                var name = c.Value<string>("name");
                var expectError = c.Value<bool?>("expectError") ?? false;
                try
                {
                    var node = StoryletJson.ToAst(c["ast"]);
                    var ctx = ScopesContext((JObject)c["scopes"]);
                    // The reference runner always supplies a PRNG (seed ?? 0).
                    var prng = new Mulberry32(c.Value<double?>("seed") ?? 0);
                    ctx.Host = new StoryletsHost { NextRandom = prng.Next };

                    StoryletValue actual;
                    string error = null;
                    try
                    {
                        actual = Expr.Evaluate(node, ctx, StoryletsDialect.Instance);
                    }
                    catch (Exception ex)
                    {
                        actual = null;
                        error = ex.Message;
                    }

                    if (expectError)
                    {
                        if (error != null) pass++;
                        else Fail("expressions", name, $"expected an eval error, got {actual.ToJsonString()}");
                    }
                    else if (error != null)
                    {
                        Fail("expressions", name, $"unexpected error: {error}");
                    }
                    else
                    {
                        var expected = StoryletJson.ToValue(c["expected"]);
                        if (actual.ValueEquals(expected)) pass++;
                        else Fail("expressions", name, $"expected {expected.ToJsonString()}, got {actual.ToJsonString()}");
                    }
                }
                catch (Exception ex)
                {
                    Fail("expressions", name, ex.Message);
                }
            }
            return pass;
        }

        // -- specificity ----------------------------------------------------------

        private static int RunSpecificity(JArray cases)
        {
            int pass = 0;
            foreach (var c in cases.Cast<JObject>())
            {
                var name = c.Value<string>("name");
                try
                {
                    var node = StoryletJson.ToAst(c["ast"]);
                    var ctx = ScopesContext((JObject)c["scopes"]);
                    int actual = Specificity.MatchedSpecificity(node, n =>
                    {
                        try
                        {
                            return ConditionPasses(Expr.Evaluate(n, ctx, StoryletsDialect.Instance));
                        }
                        catch (Exception)
                        {
                            return false;
                        }
                    });
                    int expected = c.Value<int>("expected");
                    if (actual == expected) pass++;
                    else Fail("specificity", name, $"expected {expected}, got {actual}");
                }
                catch (Exception ex)
                {
                    Fail("specificity", name, ex.Message);
                }
            }
            return pass;
        }

        // -- shared scripted/peek plumbing ------------------------------------------

        /// <summary>Direct store writes for setup and setState: story/world are
        /// single bags; box/deck/hand/value are keyed by immutable id.</summary>
        private static void ApplyState(Flow session, JObject selector)
        {
            foreach (var scope in new[] { "story", "world" })
            {
                if (!(selector[scope] is JObject bag)) continue;
                foreach (var prop in bag)
                {
                    session.SetProperty($"{scope}.{prop.Key}", StoryletJson.ToValue(prop.Value));
                }
            }
            foreach (var kind in new[] { "box", "deck", "hand", "value" })
            {
                if (!(selector[kind] is JObject byId)) continue;
                foreach (var entry in byId)
                {
                    foreach (var prop in (JObject)entry.Value)
                    {
                        session.SetProperty($"{kind}.{entry.Key}.{prop.Key}", StoryletJson.ToValue(prop.Value));
                    }
                }
            }
        }

        /// <summary>"turn.&lt;boxId&gt;" reads that box's clock (schema 3.4);
        /// everything else is a property path.</summary>
        private static StoryletValue ReadState(Flow session, string path)
        {
            return path.StartsWith("turn.", StringComparison.Ordinal)
                ? StoryletValue.Num(session.Turn(path.Substring("turn.".Length)))
                : session.GetProperty(path);
        }

        private static List<string> Ids(IEnumerable<DealtCard> cards) => cards.Select(card => card.Id).ToList();

        private static List<string> StringList(JToken token) =>
            token == null ? null : ((JArray)token).Select(t => t.Value<string>()).ToList();

        private static bool SameList(List<string> a, List<string> b)
        {
            if (a.Count != b.Count) return false;
            for (int i = 0; i < a.Count; i++) if (a[i] != b[i]) return false;
            return true;
        }

        private static string Show(IEnumerable<string> list) =>
            "[" + string.Join(",", list.Select(s => "\"" + s + "\"")) + "]";

        // -- the load report (design/engine-server.md 4.9) --------------------------
        //
        // A report's lists are compared as SORTED lists of canonical strings, not
        // as objects: key order in a struct is not a contract, and four runtimes
        // have four idioms for one of these entries. An absent flow (the shared
        // half) canonicalises to the empty string, which is why the separator is a
        // character no id, gameId or property name can hold.

        private const string FieldSep = "\u001f";

        private static List<string> SortedKeys(IEnumerable<string> keys)
        {
            var list = new List<string>(keys);
            list.Sort(StringComparer.Ordinal);
            return list;
        }

        private static List<string> WantKeys(JToken array, params string[] fields)
        {
            var keys = new List<string>();
            foreach (var entry in (JArray)array)
            {
                var parts = new List<string>();
                foreach (var f in fields) parts.Add(entry.Value<string>(f) ?? "");
                keys.Add(string.Join(FieldSep, parts));
            }
            return SortedKeys(keys);
        }

        /// <summary>The whole report as one comparable string, for "did the
        /// preview predict the restore".</summary>
        private static string ReportShape(LoadReport r)
        {
            var parts = new List<string>
            {
                r.Exact ? "exact" : "inexact", r.Project,
                r.Version.Saved, r.Version.Bundle, r.Hash.Saved, r.Hash.Bundle,
                Show(r.Flows),
                Show(r.Evicted.Select(e => string.Join(FieldSep, e.Flow, e.Hand, e.Card, e.Reason))),
                Show(r.DroppedCooldowns.Select(x => string.Join(FieldSep, x.Flow, x.Card))),
                Show(r.DroppedSpent),
                Show(r.DroppedProperties.Select(p => string.Join(FieldSep, p.Flow ?? "", p.Path))),
                Show(r.DefaultedProperties.Select(p => string.Join(FieldSep, p.Flow ?? "", p.Path))),
                Show(r.RetypedProperties.Select(p => string.Join(FieldSep, p.Flow ?? "", p.Path))),
            };
            return string.Join(" ", parts);
        }

        /// <summary>Check the fields expectReport names, and only those.</summary>
        private static void CheckReport(string at, JToken expected, LoadReport actual, List<string> failures)
        {
            if (!(expected is JObject want)) return;
            void Cmp(string field, string wantShown, string gotShown)
            {
                if (wantShown != gotShown) failures.Add($"{at}: report.{field} expected {wantShown}, got {gotShown}");
            }
            if (want["exact"] != null) Cmp("exact", want.Value<bool>("exact") ? "true" : "false", actual.Exact ? "true" : "false");
            if (want["project"] != null) Cmp("project", want.Value<string>("project"), actual.Project);
            if (want["version"] is JObject v)
            {
                Cmp("version.saved", v.Value<string>("saved"), actual.Version.Saved);
                Cmp("version.bundle", v.Value<string>("bundle"), actual.Version.Bundle);
            }
            if (want["hash"] is JObject h)
            {
                Cmp("hash.saved", h.Value<string>("saved"), actual.Hash.Saved);
                Cmp("hash.bundle", h.Value<string>("bundle"), actual.Hash.Bundle);
            }
            if (want["flows"] is JArray flows)
            {
                Cmp("flows", Show(flows.Select(x => x.Value<string>())), Show(actual.Flows));
            }
            if (want["evicted"] != null)
            {
                Cmp("evicted", Show(WantKeys(want["evicted"], "flow", "hand", "card", "reason")),
                    Show(SortedKeys(actual.Evicted.Select(e => string.Join(FieldSep, e.Flow, e.Hand, e.Card, e.Reason)))));
            }
            if (want["droppedCooldowns"] != null)
            {
                Cmp("droppedCooldowns", Show(WantKeys(want["droppedCooldowns"], "flow", "card")),
                    Show(SortedKeys(actual.DroppedCooldowns.Select(x => string.Join(FieldSep, x.Flow, x.Card)))));
            }
            if (want["droppedSpent"] is JArray spent)
            {
                Cmp("droppedSpent", Show(SortedKeys(spent.Select(x => x.Value<string>()))), Show(SortedKeys(actual.DroppedSpent)));
            }
            var propFields = new (string Name, List<LoadProperty> Got)[]
            {
                ("droppedProperties", actual.DroppedProperties),
                ("defaultedProperties", actual.DefaultedProperties),
                ("retypedProperties", actual.RetypedProperties),
            };
            foreach (var (name, got) in propFields)
            {
                if (want[name] == null) continue;
                Cmp(name, Show(WantKeys(want[name], "flow", "path")),
                    Show(SortedKeys(got.Select(p => string.Join(FieldSep, p.Flow ?? "", p.Path)))));
            }
        }

        /// <summary>Ops that run ON a flow, and so open one lazily. The rest -
        /// engine reads, flow management, save/load - must NOT, or a harness
        /// quietly opens "main" where the JS reference does not and `assertFlows`
        /// answers differently for no engine reason.</summary>
        private static bool NeedsFlow(string kind)
        {
            switch (kind)
            {
                case "setState":
                case "peek":
                case "deal":
                case "assertBoard":
                case "play":
                case "advanceTurns":
                case "assertOutcomes":
                case "assertOutcomeOrder":
                case "assertState":
                    return true;
                default:
                    return false;
            }
        }

        // -- peek -------------------------------------------------------------------

        /// <summary>Build a session, apply setup, peek, check the ordered list -
        /// then peek AGAIN and require the identical list: a peek registers
        /// nothing and asking twice is free (schema 3.5).</summary>
        private static int RunPeek(JArray cases)
        {
            int pass = 0;
            foreach (var c in cases.Cast<JObject>())
            {
                var name = c.Value<string>("name");
                try
                {
                    var bundle = BundleLoader.Parse((JObject)c["bundle"]);
                    var session = new StoryletStudio.StoryletEngine.Engine(bundle, new EngineOptions { Seed = c.Value<double?>("seed") ?? 0 }).OpenFlow("main");
                    if (c["setup"] is JObject setup) ApplyState(session, setup);
                    var box = c.Value<string>("box");
                    var criteria = StoryletJson.ToStringMap(c["criteria"]);
                    var n = c.Value<int?>("n");
                    var expect = StringList(c["expect"]);

                    var failures = new List<string>();
                    var first = Ids(session.Peek(box, criteria, n).Cards);
                    if (!SameList(first, expect))
                    {
                        failures.Add($"peek: expected {Show(expect)}, got {Show(first)}");
                    }
                    var second = Ids(session.Peek(box, criteria, n).Cards);
                    if (!SameList(second, first))
                    {
                        failures.Add($"second peek diverged (a peek must register nothing): {Show(first)} then {Show(second)}");
                    }

                    if (failures.Count == 0) pass++;
                    else foreach (var f in failures) Fail("peek", name, f);
                }
                catch (Exception ex)
                {
                    Fail("peek", name, ex.Message);
                }
            }
            return pass;
        }

        // -- the bundle inspector (design/engine-runtimes.md 2, piece 6) --------------

        /// <summary>describeBundle is a bundle-level API with no corpus family of
        /// its own (it reports the bundle's declared shape, not dealing
        /// behaviour). This check holds it to the one contract that could
        /// silently drift: the criteria surface it advertises must be the
        /// criteria Peek() accepts, and its property scopes must be the static
        /// twin of the session's ListProperties() - same names, same order. Run
        /// over the first peek case's bundle.</summary>
        /// <summary>A bundle that carries a map: parsed, reported, and above all
        /// IGNORED. The corpus has no map in it (geometry is inert payload, so it
        /// has no dealing behaviour to conform to), which would leave the whole
        /// path compiled and never executed - so the map arrives here instead.</summary>
        private static int RunDescribeMaps()
        {
            const string json = @"{
                ""schema"": ""storylets/bundle@0"",
                ""content"": { ""project"": ""p"", ""version"": ""1"", ""hash"": """" },
                ""metadata"": ""full"",
                ""settings"": { ""playAdvancesTurns"": 1 },
                ""world"": { ""properties"": [] },
                ""story"": { ""properties"": [] },
                ""boxes"": [],
                ""maps"": [{
                    ""box"": ""village"", ""group"": ""zone"",
                    ""zones"": [{ ""tag"": ""tavern"", ""polygon"": [
                        { ""x"": 0, ""y"": 0 }, { ""x"": 4, ""y"": 0 }, { ""x"": 4, ""y"": 3 }] }],
                    ""backgrounds"": [{ ""file"": ""assets/village/plan.png"",
                        ""x"": 1, ""y"": 2, ""width"": 8, ""height"": 6, ""opacity"": 0.6 }],
                    ""sites"": [{ ""hand"": ""the-forge"", ""x"": 5, ""y"": 6 },
                        { ""hand"": ""the-well"", ""x"": 7, ""y"": 8 }]
                }]
            }";
            try
            {
                var bundle = BundleLoader.Parse(json);
                if (bundle.Maps.Count != 1) { Fail("describe", "maps", "the map did not parse"); return 0; }
                var map = bundle.Maps[0];
                if (map.Box != "village" || map.Group != "zone") { Fail("describe", "maps", "box/group lost"); return 0; }
                if (map.Zones.Count != 1 || map.Zones[0].Polygon.Count != 3) { Fail("describe", "maps", "the polygon lost points"); return 0; }
                if (map.Zones[0].Polygon[2].X != 4 || map.Zones[0].Polygon[2].Y != 3) { Fail("describe", "maps", "a point moved"); return 0; }
                if (map.Backgrounds.Count != 1 || map.Backgrounds[0].File != "assets/village/plan.png") { Fail("describe", "maps", "the picture lost its path"); return 0; }
                if (map.Backgrounds[0].Opacity != 0.6) { Fail("describe", "maps", "opacity lost"); return 0; }
                // The placed hands (design/engine-server.md 4.3): a position is
                // content in a physical experience, so it travels in the block.
                if (map.Sites.Count != 2) { Fail("describe", "maps", "the sites did not parse"); return 0; }
                if (map.Sites[0].Hand != "the-forge" || map.Sites[0].X != 5 || map.Sites[0].Y != 6)
                {
                    Fail("describe", "maps", "a site moved");
                    return 0;
                }

                var d = BundleInspector.DescribeBundle(bundle);
                if (d.Maps.Count != 1 || d.Maps[0].Zones != 1 || d.Maps[0].Backgrounds != 1 || d.Maps[0].Sites != 2)
                {
                    Fail("describe", "maps", "the description does not report the map");
                    return 0;
                }
                // And a session over it still runs: inert means inert.
                new StoryletStudio.StoryletEngine.Engine(bundle, new EngineOptions()).OpenFlow("main");
                return 1;
            }
            catch (Exception ex)
            {
                Fail("describe", "maps", ex.Message);
                return 0;
            }
        }

        private static int RunDescribe(JArray cases)
        {
            if (cases.Count == 0) return 0;
            var c = (JObject)cases[0];
            var name = "describeBundle over " + c.Value<string>("name");
            try
            {
                var bundle = BundleLoader.Parse((JObject)c["bundle"]);
                var d = BundleInspector.DescribeBundle(bundle);
                var session = new StoryletStudio.StoryletEngine.Engine(bundle, new EngineOptions()).OpenFlow("main");

                if (d.Identity.Schema != Model.BUNDLE_SCHEMA)
                {
                    Fail("describe", name, $"Identity.Schema is {d.Identity.Schema}");
                }
                if (d.Totals.Boxes != bundle.Boxes.Count)
                {
                    Fail("describe", name, "Totals.Boxes disagrees with the bundle");
                }
                // Every advertised criteria pair is a peek the session accepts.
                foreach (var box in d.Boxes)
                {
                    foreach (var group in box.TagGroups)
                    {
                        foreach (var tag in group.Tags)
                        {
                            var criteria = new OrderedMap<string, string>();
                            criteria.Set(group.GameId, tag);
                            try
                            {
                                session.Peek(box.GameId, criteria);
                            }
                            catch (Exception ex)
                            {
                                Fail("describe", name,
                                    $"advertised criteria {group.GameId}={tag} rejected by Peek: {ex.Message}");
                            }
                        }
                    }
                }
                // The declared surface, flattened, equals the live examiner rows.
                var declared = d.Properties.SelectMany(s => s.Properties).Select(p => p.Name).ToList();
                var live = session.ListProperties().Select(r => r.Name).ToList();
                if (!SameList(declared, live))
                {
                    Fail("describe", name,
                        $"declared properties {Show(declared)} disagree with ListProperties {Show(live)}");
                }
                return 1;
            }
            catch (Exception ex)
            {
                Fail("describe", name, ex.Message);
                return 0;
            }
        }

        sealed class RecordingWorld : IScopeResolver
        {
            public readonly Dictionary<string, StoryletValue> Values = new Dictionary<string, StoryletValue>();
            public readonly List<string> Sets = new List<string>();
            public StoryletValue Get(string name) => Values.TryGetValue(name, out var v) ? v : null;
            public bool CanSet => true;
            public void Set(string name, StoryletValue value) { Sets.Add(name); Values[name] = value; }
        }

        static List<string> RunReadOnlyWorldProbe(JObject bundleJson)
        {
            var failures = new List<string>();
            var world = new RecordingWorld();
            world.Values["clock"] = StoryletValue.Num(0);
            world.Values["mood"] = StoryletValue.Num(0);
            var bundle = BundleLoader.Parse(bundleJson);
            var flow = new StoryletStudio.StoryletEngine.Engine(bundle, new EngineOptions { Seed = 0, World = world }).OpenFlow("main");
            flow.Deal("h_q");
            try { flow.Play("c_tick", "tick", "h_q"); failures.Add("bound-world probe: the story wrote a read-only @world value and was not refused"); }
            catch (StoryletError ex) { if (!ex.Message.Contains("is read-only")) failures.Add("bound-world probe: refused, but not as read-only: " + ex.Message); }
            if (world.Sets.Count != 0) failures.Add("bound-world probe: the host's Set was called for a read-only write: " + string.Join(",", world.Sets));
            try { flow.Play("c_cheer", "cheer", "h_q"); } catch (StoryletError ex) { failures.Add("bound-world probe: a writable property was refused: " + ex.Message); }
            if (world.Sets.Count != 1 || world.Sets[0] != "mood") failures.Add("bound-world probe: expected the host's Set once, for mood; got " + string.Join(",", world.Sets));
            return failures;
        }

        // -- scripted -----------------------------------------------------------------

        /// <summary>Hand id -> gameId (the board keys by gameId; scripts speak ids).</summary>
        private static Dictionary<string, string> HandGameIds(Bundle bundle)
        {
            var names = new Dictionary<string, string>();
            foreach (var box in bundle.Boxes)
            {
                foreach (var hand in box.Hands) names[hand.Id] = Model.EffectiveGameId(hand);
            }
            return names;
        }

        /// <summary>Execute the ops in order; every expect must match exactly,
        /// expectError ops must fail without side effects.</summary>
        private static int RunScripted(JArray cases)
        {
            int pass = 0;
            foreach (var c in cases.Cast<JObject>())
            {
                var name = c.Value<string>("name");
                try
                {
                    var failures = RunScriptedCase(c);
                    if (failures.Count == 0) pass++;
                    else foreach (var f in failures) Fail("scripted", name, f);
                }
                catch (Exception ex)
                {
                    Fail("scripted", name, ex.Message);
                }
            }
            return pass;
        }

        private static List<string> RunScriptedCase(JObject c)
        {
            var failures = new List<string>();
            var bundle = BundleLoader.Parse((JObject)c["bundle"]);
            var bundleB = c["bundleB"] is JObject bb ? BundleLoader.Parse(bb) : null;
            var seed = c.Value<double?>("seed") ?? 0;
            var engine = new StoryletStudio.StoryletEngine.Engine(bundle, new EngineOptions { Seed = seed });
            // Flow handles as the SCRIPT knows them: kept across closeFlow so a
            // later op on a closed name exercises the inert handle, never a
            // quiet re-open.
            var handles = new Dictionary<string, Flow>();
            // Verdicts from the deal or peek an op just ran, card id -> verdict,
            // taken from the trace because that is the only place the REASON
            // lives: a board read says a card is absent, never why, and
            // "claimed" against "claimed-elsewhere" is exactly the distinction
            // it cannot make. A deal fires one event per hand, so the sink
            // accumulates across them; subscribing also switches tracing on.
            var verdicts = new Dictionary<string, string>();
            // What the ask SAID, as opposed to what it dealt. A hole filled
            // from a property that names no tag deals a wildcard hand (4.6),
            // which is indistinguishable on a board read from a hole that was
            // never movable: the diagnostic is where the difference lives.
            var diagnostics = new List<string>();
            // Parked flow blobs, by the name they were parked under. Held OUTSIDE
            // the engine on purpose: a park survives a content swap, which is the
            // case that makes a resume interesting.
            var parked = new Dictionary<string, FlowSave>();
            Flow Watch(Flow f)
            {
                f.SubscribeTrace(e =>
                {
                    if (e is DiagnosticEvent dg) { diagnostics.Add(dg.Message); return; }
                    List<TraceCard> cards = null;
                    if (e is DealEvent d) cards = d.Cards;
                    else if (e is PeekEvent pk) cards = pk.Cards;
                    if (cards == null) return;
                    foreach (var card in cards) verdicts[card.Id] = Flow.VerdictWire(card.Verdict);
                });
                return f;
            }
            Flow FlowOf(JObject o)
            {
                var flowName = o.Value<string>("flow") ?? "main";
                if (!handles.TryGetValue(flowName, out var f))
                {
                    f = Watch(engine.OpenFlow(flowName));
                    handles[flowName] = f;
                }
                return f;
            }
            void CheckVerdicts(string at, JObject o)
            {
                if (!(o["expectVerdicts"] is JObject expected)) return;
                foreach (var pair in expected)
                {
                    var want = pair.Value.Value<string>();
                    var got = verdicts.TryGetValue(pair.Key, out var v) ? v : null;
                    if (got != want)
                    {
                        failures.Add($"{at}: verdict for {pair.Key} expected \"{want}\", got {(got == null ? "no verdict" : $"\"{got}\"")}");
                    }
                }
            }
            void CheckDiagnostic(string at, JObject o)
            {
                var want = o.Value<string>("expectDiagnostic");
                if (want == null) return;
                if (!diagnostics.Exists(m => m.Contains(want)))
                {
                    failures.Add($"{at}: expected a diagnostic containing \"{want}\", got {(diagnostics.Count == 0 ? "none" : Show(diagnostics))}");
                }
            }
            var names = HandGameIds(bundle);

            var script = (JArray)c["script"];
            for (int index = 0; index < script.Count; index++)
            {
                var op = (JObject)script[index];
                var kind = op.Value<string>("op");
                var at = $"op {index} ({kind})";
                var session = NeedsFlow(kind) ? FlowOf(op) : null;
                switch (kind)
                {
                    case "setState":
                        ApplyState(session, op);
                        break;

                    case "peek":
                    {
                        List<string> ids = null;
                        string peekError = null;
                        verdicts.Clear();
                        diagnostics.Clear();
                        try
                        {
                            var list = session.Peek(op.Value<string>("box") ?? "box",
                                StoryletJson.ToStringMap(op["criteria"]), op.Value<int?>("n"));
                            ids = Ids(list.Cards);
                        }
                        catch (Exception ex)
                        {
                            peekError = ex.Message;
                        }
                        CheckVerdicts(at, op);
                        var expectPeekError = op.Value<bool?>("expectError") ?? false;
                        if (expectPeekError && peekError == null)
                        {
                            failures.Add($"{at}: expected an error, peek returned {Show(ids)}");
                        }
                        if (!expectPeekError && peekError != null)
                        {
                            failures.Add($"{at}: unexpected error: {peekError}");
                        }
                        var expect = StringList(op["expect"]);
                        if (expect != null && ids != null && !SameList(ids, expect))
                        {
                            failures.Add($"{at}: expected {Show(expect)}, got {Show(ids)}");
                        }
                        break;
                    }

                    case "deal":
                    {
                        verdicts.Clear();
                        diagnostics.Clear();
                        var dealt = session.DealMany(StringList(op["hands"]));
                        CheckVerdicts(at, op);
                        CheckDiagnostic(at, op);
                        if (op["expectBoard"] is JObject expectBoard)
                        {
                            foreach (var pair in expectBoard)
                            {
                                var board = session.Board();
                                var key = names.TryGetValue(pair.Key, out var mapped) ? mapped : pair.Key;
                                var actual = Ids(board.GetOrDefault(key) ?? new List<DealtCard>());
                                var expected = StringList(pair.Value);
                                if (!SameList(actual, expected))
                                {
                                    failures.Add($"{at}: board[{pair.Key}] expected {Show(expected)}, got {Show(actual)}");
                                }
                            }
                        }
                        if (op["expectDealt"] is JObject expectDealt)
                        {
                            // The dealt slice holds exactly the hands this call
                            // dealt: the key set must match, not merely include.
                            var expectedKeys = expectDealt.Properties()
                                .Select(p => names.TryGetValue(p.Name, out var mapped) ? mapped : p.Name)
                                .OrderBy(k => k, StringComparer.Ordinal).ToList();
                            var actualKeys = dealt.Keys.OrderBy(k => k, StringComparer.Ordinal).ToList();
                            if (!SameList(actualKeys, expectedKeys))
                            {
                                failures.Add($"{at}: dealt hands expected {Show(expectedKeys)}, got {Show(actualKeys)}");
                            }
                            foreach (var pair in expectDealt)
                            {
                                var key = names.TryGetValue(pair.Key, out var mapped) ? mapped : pair.Key;
                                var actual = Ids(dealt.GetOrDefault(key) ?? new List<DealtCard>());
                                var expected = StringList(pair.Value);
                                if (!SameList(actual, expected))
                                {
                                    failures.Add($"{at}: dealt[{pair.Key}] expected {Show(expected)}, got {Show(actual)}");
                                }
                            }
                        }
                        break;
                    }

                    case "assertBoard":
                    {
                        var boxRef = op.Value<string>("box");
                        OrderedMap<string, List<DealtCard>> board = null;
                        string boardError = null;
                        try
                        {
                            board = boxRef == null ? session.Board() : session.Board(boxRef);
                        }
                        catch (Exception ex)
                        {
                            boardError = ex.Message;
                        }
                        var expectBoardError = op.Value<bool?>("expectError") ?? false;
                        if (expectBoardError && boardError == null)
                        {
                            failures.Add($"{at}: expected an error, board returned {Show(board.Keys.ToList())}");
                        }
                        if (!expectBoardError && boardError != null)
                        {
                            failures.Add($"{at}: unexpected error: {boardError}");
                        }
                        if (op["expect"] is JObject expectHands && board != null)
                        {
                            // The filtered board holds exactly the hands of that
                            // box: the key set must match, not merely include.
                            var expectedKeys = expectHands.Properties()
                                .Select(p => names.TryGetValue(p.Name, out var mapped) ? mapped : p.Name)
                                .OrderBy(k => k, StringComparer.Ordinal).ToList();
                            var actualKeys = board.Keys.OrderBy(k => k, StringComparer.Ordinal).ToList();
                            if (!SameList(actualKeys, expectedKeys))
                            {
                                failures.Add($"{at}: board hands expected {Show(expectedKeys)}, got {Show(actualKeys)}");
                            }
                            foreach (var pair in expectHands)
                            {
                                var key = names.TryGetValue(pair.Key, out var mapped) ? mapped : pair.Key;
                                var actual = Ids(board.GetOrDefault(key) ?? new List<DealtCard>());
                                var expected = StringList(pair.Value);
                                if (!SameList(actual, expected))
                                {
                                    failures.Add($"{at}: board[{pair.Key}] expected {Show(expected)}, got {Show(actual)}");
                                }
                            }
                        }
                        break;
                    }

                    case "play":
                    {
                        var expectError = op.Value<bool?>("expectError") ?? false;
                        string error = null;
                        try
                        {
                            var advance = op.Value<double?>("advanceTurns");
                            session.Play(op.Value<string>("card"), op.Value<string>("outcome"), op.Value<string>("from"),
                                advance != null ? new PlayOptions { AdvanceTurns = advance } : new PlayOptions());
                        }
                        catch (Exception ex)
                        {
                            error = ex.Message;
                        }
                        if (expectError && error == null)
                        {
                            failures.Add($"{at}: expected an error, play succeeded");
                        }
                        if (!expectError && error != null)
                        {
                            failures.Add($"{at}: unexpected error: {error}");
                        }
                        break;
                    }

                    case "advanceTurns":
                        session.AdvanceTurns(op.Value<string>("box"), op.Value<double>("n"));
                        break;

                    case "assertOutcomes":
                    {
                        var expect = (JObject)op["expect"];
                        var views = session.Outcomes(op.Value<string>("card"), op.Value<string>("from"));
                        foreach (var pair in expect)
                        {
                            var view = views.Find(v => v.GameId == pair.Key);
                            var actual = view != null && view.Available;
                            var expected = pair.Value.Value<bool>();
                            if (actual != expected)
                            {
                                failures.Add($"{at}: {pair.Key} expected {(expected ? "true" : "false")}, got {(actual ? "true" : "false")}");
                            }
                        }
                        break;
                    }

                    case "assertOutcomeOrder":
                    {
                        // The ORDER outcomes come back in, which is the player's
                        // menu: the bundle carries the author's order, not id order.
                        var want = ((JArray)op["expect"]).Select(x => x.Value<string>()).ToList();
                        var got = session.Outcomes(op.Value<string>("card"), op.Value<string>("from"))
                            .Select(v => v.GameId).ToList();
                        if (!want.SequenceEqual(got))
                        {
                            failures.Add($"{at}: expected [{string.Join(", ", want)}], got [{string.Join(", ", got)}]");
                        }
                        break;
                    }

                    case "assertState":
                    {
                        foreach (var pair in (JObject)op["expect"])
                        {
                            StoryletValue actual = null;
                            string error = null;
                            try
                            {
                                actual = ReadState(session, pair.Key);
                            }
                            catch (Exception ex)
                            {
                                error = ex.Message;
                            }
                            var expected = StoryletJson.ToValue(pair.Value);
                            if (error != null || !actual.ValueEquals(expected))
                            {
                                failures.Add($"{at}: {pair.Key} expected {expected.ToJsonString()}, got {error ?? actual.ToJsonString()}");
                            }
                        }
                        break;
                    }

                    case "saveLoad":
                    {
                        // Serialise the WHOLE engine, discard it, restore into a
                        // fresh one (semantic parity, not byte parity). into: "B"
                        // restores into the case's EDITED bundle: the
                        // drifted-content contract. LoadGame rebuilds every flow,
                        // so the script's handles are re-taken.
                        var envelope = engine.SaveGame();
                        var into = op.Value<string>("into") == "B" ? bundleB : bundle;
                        var target = new StoryletStudio.StoryletEngine.Engine(into, new EngineOptions { Seed = seed });
                        if (op.Value<bool?>("previewOnly") == true)
                        {
                            // The purity claim, checked rather than asserted: the
                            // engine that was asked what a load would cost writes
                            // the same envelope after the question as before it.
                            // The LIVE engine is not replaced, so the ops after
                            // this one prove the load did not happen.
                            var before = StoryletSave.ToJson(target.SaveGame()).ToString();
                            var previewReport = target.PreviewLoad(envelope);
                            if (StoryletSave.ToJson(target.SaveGame()).ToString() != before)
                            {
                                failures.Add($"{at}: PreviewLoad changed the engine it was asked about");
                            }
                            CheckReport(at, op["expectReport"], previewReport, failures);
                            break;
                        }
                        engine = target;
                        CheckReport(at, op["expectReport"], engine.LoadGame(envelope), failures);
                        handles = new Dictionary<string, Flow>();
                        foreach (var f in engine.Flows()) handles[f.Id] = f;
                        break;
                    }

                    case "parkFlow":
                    {
                        // Park: take the blob, then close. Closing is what
                        // releases the shared claims, which is the whole reason a
                        // visit parks rather than idling.
                        var name = op.Value<string>("flow");
                        parked[name] = engine.SaveFlow(name);
                        engine.CloseFlow(name);
                        break;
                    }

                    case "resumeFlow":
                    {
                        var name = op.Value<string>("flow");
                        if (!parked.TryGetValue(name, out var saved))
                        {
                            failures.Add($"{at}: nothing is parked under \"{name}\"");
                            break;
                        }
                        // Ask before doing, then require the two answers to
                        // agree: a preview that does not predict the restore is
                        // worse than no preview.
                        var preview = engine.PreviewFlowRestore(name, saved);
                        LoadReport applied = null;
                        var opts = new OpenFlowOptions { Restore = saved, OnRestoreReport = r => applied = r };
                        if (op["seed"] != null) opts.Seed = op.Value<double>("seed");
                        handles[name] = Watch(engine.OpenFlow(name, opts));
                        if (applied == null)
                        {
                            failures.Add($"{at}: the restore produced no report");
                        }
                        else if (ReportShape(preview) != ReportShape(applied))
                        {
                            failures.Add($"{at}: PreviewFlowRestore said {ReportShape(preview)}, the restore did {ReportShape(applied)}");
                        }
                        CheckReport(at, op["expectReport"], applied ?? preview, failures);
                        break;
                    }

                    case "openFlow":
                    {
                        var opts = new OpenFlowOptions();
                        if (op["seed"] != null) opts.Seed = op.Value<double>("seed");
                        handles[op.Value<string>("flow")] = engine.OpenFlow(op.Value<string>("flow"), opts);
                        break;
                    }

                    case "closeFlow":
                        engine.CloseFlow(op.Value<string>("flow"));
                        break;

                    case "assertFlows":
                    {
                        // Order is a contract: SaveGame keys its flows in it,
                        // so two runtimes that disagree write different
                        // .storyletsave bytes for the same run.
                        var liveIds = new List<string>();
                        foreach (var f in engine.Flows()) liveIds.Add(f.Id);
                        var wantIds = new List<string>();
                        foreach (var v in (JArray)op["expect"]) wantIds.Add(v.Value<string>());
                        if (Show(liveIds) != Show(wantIds))
                        {
                            failures.Add($"{at}: flows are {Show(liveIds)}, expected {Show(wantIds)}");
                        }
                        break;
                    }

                    case "assertEngineRead":
                    {
                        // Engine-level read: world.* and shared refs answer; a
                        // per-flow ref must THROW (the teaching rule).
                        var path = op.Value<string>("path");
                        StoryletValue engineValue = null;
                        string readError = null;
                        try { engineValue = engine.GetProperty(path); }
                        catch (StoryletError e) { readError = e.Message; }
                        var expectReadError = op.Value<bool?>("expectError") ?? false;
                        if (expectReadError && readError == null)
                        {
                            failures.Add($"{at}: expected an error, engine read of {path} returned {engineValue}");
                        }
                        if (!expectReadError && readError != null)
                        {
                            failures.Add($"{at}: unexpected error: {readError}");
                        }
                        if (op["expect"] != null && readError == null)
                        {
                            var expected = StoryletJson.ToValue(op["expect"]);
                            if (engineValue == null || !engineValue.ValueEquals(expected))
                            {
                                failures.Add($"{at}: {path} expected {expected}, got {engineValue}");
                            }
                        }
                        break;
                    }

                    case "reset":
                        engine = new StoryletStudio.StoryletEngine.Engine(bundle, new EngineOptions { Seed = seed });
                        handles = new Dictionary<string, Flow>();
                        break;

                    default:
                        failures.Add($"{at}: unknown op");
                        break;
                }
            }
            return failures;
        }
    }
}
