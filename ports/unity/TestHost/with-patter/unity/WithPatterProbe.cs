// The probe scripts/check-unity-with-patter.sh runs inside a real Unity project
// holding both real packages (Patterplay staged at 0.14.0, the Storylet Engine
// by file path). Never compiled by the dotnet host: the script copies it, with
// CombinedGame.cs beside it, into the scratch project's Assets.
//
// It runs the whole combined proof (CombinedGame.Run: one registry through both
// engines, the one save round trip in either order, drift, a hot swap, clashes)
// and adds what only a real Unity build can show: which assembly the kernel came
// from, that it came from exactly one, and that the Storylet Engine's runtime was
// compiled against Patterplay's kernel rather than its own. It writes a result
// file; the script passes only on that file's positive evidence.
//
// In the editor, WithPatterEditor.Probe (-executeMethod) calls Run. In a player
// build, RunInPlayer fires as the first scene loads, writes the same file to
// $PROBE_OUT, and quits.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEngine;

namespace StoryletStudio.CombinedProof
{
    public static class WithPatterProbe
    {
        /// <summary>Every line of the result, ending in WITH PATTER ALL PASS or
        /// WITH PATTER N FAILED. Never throws: an exception is a failure line.</summary>
        public static List<string> Run(string where)
        {
            var lines = new List<string> { "where " + where + " (" + Application.platform + ", Unity " + Application.unityVersion + ")" };
            int fails = 0;
            void Check(bool ok, string what)
            {
                lines.Add((ok ? "  ok   " : "  FAIL ") + what);
                if (!ok) fails++;
            }
            try
            {
                // Which assembly holds the kernel, and how many do: in a game with both
                // packages, Patterplay's and nothing else.
                var kernel = typeof(Wildwinter.Expr.ScopeRegistry).Assembly.GetName().Name;
                lines.Add("kernel " + kernel);
                Check(kernel == "Patterplay.Expr", "the kernel is Patterplay's (Patterplay.Expr), got " + kernel);
                var holders = AppDomain.CurrentDomain.GetAssemblies()
                    .Where(a => a.GetType("Wildwinter.Expr.ScopeRegistry", false) != null)
                    .Select(a => a.GetName().Name).OrderBy(n => n, StringComparer.Ordinal).ToList();
                Check(holders.Count == 1, "exactly one loaded assembly defines Wildwinter.Expr.ScopeRegistry: " + string.Join(", ", holders));
                // Both engines' runtimes were compiled against that one kernel.
                foreach (var t in new[] { typeof(StoryletStudio.StoryletEngine.Engine), typeof(Patterkit.Patterplay.Engine) })
                {
                    var refs = t.Assembly.GetReferencedAssemblies().Select(r => r.Name).ToList();
                    var name = t.Assembly.GetName().Name;
                    Check(refs.Contains("Patterplay.Expr") && !refs.Contains("StoryletEngine.Expr"),
                        name + " is compiled against Patterplay.Expr and not StoryletEngine.Expr: " + string.Join(", ", refs.Where(r => r.EndsWith(".Expr", StringComparison.Ordinal))));
                }

                var (passed, total, failures) = CombinedGame.Run(lines.Add);
                lines.Add($"with patter: {passed}/{total}");
                fails += failures.Count;
            }
            catch (Exception e)
            {
                Check(false, "the probe threw " + e);
            }
            lines.Add(fails == 0 ? "WITH PATTER ALL PASS" : $"WITH PATTER {fails} FAILED");
            return lines;
        }

        public static bool Write(string path, List<string> lines)
        {
            File.WriteAllText(path, string.Join("\n", lines) + "\n");
            return lines[lines.Count - 1] == "WITH PATTER ALL PASS";
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void RunInPlayer()
        {
            if (Application.isEditor) return;
            var outPath = Environment.GetEnvironmentVariable("PROBE_OUT");
            var lines = Run("player");
            foreach (var l in lines) Debug.Log("[with-patter] " + l);
            var ok = !string.IsNullOrEmpty(outPath) && Write(outPath, lines);
            Application.Quit(ok ? 0 : 1);
        }
    }
}
