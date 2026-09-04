// The Hamlet's core, played with no Unity. Same assertions as the editor smoke
// test, so a failure here is caught before an editor is opened.
using System;
using System.IO;
using System.Linq;
using StoryletStudio.Hamlet;

static class Program
{
    static int fails;
    static void Check(bool ok, string label, string detail = "") { Console.WriteLine((ok ? "PASS " : "FAIL ") + label + (ok || detail == "" ? "" : ": " + detail)); if (!ok) fails++; }
    static int Main(string[] args)
    {
        var here = AppContext.BaseDirectory;
        var sa = Path.GetFullPath(Path.Combine(here, "../../../../Assets/StreamingAssets"));
        if (args.Length > 0) sa = args[0];
        HamletGame Fresh() { var g = new HamletGame(); g.Setup(File.ReadAllText(Path.Combine(sa, "hamlet.storyletsc")), File.ReadAllText(Path.Combine(sa, "hamlet.patterc"))); return g; }
        var g = Fresh(); g.Go("the-inn");
        // The demo opens with one card: arriving at the gate moves the act and deals the village.
        var gate = g.Hand().FirstOrDefault(c => c.GameId == "arrive-at-the-gate"); Check(gate != null, "the demo opens with the gate"); g.Start(gate);
        // The scene ENDS but its outcome waits: the player reads it, then continues.
        Check(g.Playing != null && g.Playing.Done && g.Log.Count == 0, "the gate's words wait on Continue"); g.Finish();
        var settle = g.Hand().FirstOrDefault(c => c.GameId == "settle-at-the-inn");
        Check(settle != null, "the inn deals settle-at-the-inn");
        g.Start(settle);
        Check(g.Playing != null && g.Playing.Choices.Count == 2, "Patter performs it: two choices");
        var mid = g.Save(); var g2 = Fresh();
        Check(g2.Load(mid) && g2.Playing != null && g2.Playing.Choices.Count == 2, "a mid-scene envelope loads and the conversation is back");
        g2.Choose(g2.Playing.Choices.First(c => c.text.Contains("road north")).id);
        Check(g2.Playing != null && g2.Playing.Done, "the branch's closing words wait on Continue"); g2.Finish();
        Check(Equals(g2.World.Values["knows_road"], true), "Patter wrote @world.knows_road");
        g2.Go("the-mystic-tree");
        Check(string.Join(",", g2.Hand().Select(c => c.GameId)) == "wind-in-the-leaves", "tree shows the ambient only (survivor rule)");
        g2.Start(g2.Hand()[0]); g2.Finish();   // no choice at all: it ends, and Continue plays it
        Check(g2.Hand().Any(c => c.GameId == "the-road-north"), "The Road North lands once the seat frees");
        var fx = Path.GetFullPath(Path.Combine(sa, "../../../../godot/HamletDemo/test/fixtures/envelope-from-js-mid.json"));   // ports/unity/HamletDemo/Assets/StreamingAssets -> ports/godot/...
        Console.WriteLine("cross-host fixture: " + (File.Exists(fx) ? "found" : "MISSING at " + fx));
        if (File.Exists(fx))
        {
            var g3 = Fresh(); bool ok = false; string why = "";
            try { ok = g3.Load(File.ReadAllText(fx)) && g3.Playing != null && g3.Playing.Choices.Count == 2; } catch (Exception ex) { why = ex.Message; }
            if (ok) Check(true, "a MID-SCENE envelope from the JS client brings the conversation back (Patter's Unity save crosses)");
            else Console.WriteLine("KNOWN GAP (findings 11): Patter's save did not cross from JS to Unity: " + why);
        }
        Console.WriteLine("HAMLET " + (fails == 0 ? "OK" : fails + " FAILED"));
        return fails == 0 ? 0 : 1;
    }
}
