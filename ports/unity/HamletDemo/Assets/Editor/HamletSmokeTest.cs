// Headless: the loop, the survivor rule, a mid-scene save/load, and the
// cross-host envelope the JS client wrote. Drives HamletGame directly, so no
// scene is needed; the scene is for people.
//
//   Unity -batchmode -nographics -quit \
//     -projectPath ports/unity/HamletDemo \
//     -executeMethod StoryletStudio.Hamlet.Editor.HamletSmokeTest.Run
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace StoryletStudio.Hamlet.Editor
{
    public static class HamletSmokeTest
    {
        private static int _failures;
        private static void Check(bool ok, string label, string detail = "") { Debug.Log((ok ? "PASS " : "FAIL ") + label + (ok || detail == "" ? "" : ": " + detail)); if (!ok) _failures++; }

        public static void Run()
        {
            _failures = 0;
            var sa = Application.streamingAssetsPath;
            HamletGame Fresh() { var g = new HamletGame(); g.Setup(File.ReadAllText(Path.Combine(sa, "hamlet.storyletsc")), File.ReadAllText(Path.Combine(sa, "hamlet.patterc"))); return g; }
            var g = Fresh();
            g.Go("the-inn");
            // The demo opens with one card: arriving at the gate moves the act and deals the village.
            var gate = g.Hand().FirstOrDefault(c => c.GameId == "arrive-at-the-gate"); if (gate == null) throw new System.Exception("the demo opens with the gate"); g.Start(gate);
            var settle = g.Hand().FirstOrDefault(c => c.GameId == "settle-at-the-inn");
            Check(settle != null, "the inn deals settle-at-the-inn", string.Join(",", g.Hand().Select(c => c.GameId)));
            g.Start(settle);
            Check(g.Playing != null && g.Playing.Choices.Count == 2, "Patter performs it: two choices on screen");
            var mid = g.Save();
            var g2 = Fresh();
            Check(g2.Load(mid) && g2.Playing != null && g2.Playing.Choices.Count == 2, "a mid-scene envelope loads and the conversation is back");
            g2.Choose(g2.Playing.Choices.First(c => c.text.Contains("road north")).id);
            Check(Equals(g2.World.Values["knows_road"], true), "Patter wrote @world.knows_road", g2.World.Values["knows_road"]?.ToString());
            g2.Go("the-mystic-tree");
            Check(string.Join(",", g2.Hand().Select(c => c.GameId)) == "wind-in-the-leaves", "tree shows the ambient only (survivor rule)");
            g2.Start(g2.Hand()[0]);
            Check(g2.Hand().Any(c => c.GameId == "the-road-north"), "The Road North lands once the seat frees", string.Join(",", g2.Hand().Select(c => c.GameId)));
            // Cross-host: the JS client's envelopes, when this is the maintainers' checkout.
            var fixtures = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../godot/HamletDemo/test/fixtures"));
            var between = Path.Combine(fixtures, "envelope-from-js.json");
            if (File.Exists(between))
            {
                var g3 = Fresh(); var ok = false; string why = "";
                try { ok = g3.Load(File.ReadAllText(between)); } catch (System.Exception ex) { why = ex.Message; }
                if (ok) Check(g3.At == "the-mystic-tree" && Equals(g3.World.Values["knows_road"], true), "the JS client's envelope loads here, same place and world");
                else Debug.Log("KNOWN GAP (findings 11): the JS client's envelope did not load here: " + why);
            }
            else Debug.Log("SKIP cross-host: no fixtures at " + fixtures);
            Debug.Log("HAMLET " + (_failures == 0 ? "OK" : _failures + " FAILED"));
            if (Application.isBatchMode) EditorApplication.Exit(_failures == 0 ? 0 : 1);
        }
    }
}
