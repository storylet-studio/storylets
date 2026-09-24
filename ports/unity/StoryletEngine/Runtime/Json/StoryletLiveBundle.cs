// Live refresh - the game-side applier (the C# parity of
// @storylet-studio/play-helpers' applyLiveBundle). The editor pushes
// {t:"bundle", build, data} over the Live Link; the game drains it on ITS OWN
// thread (StoryletLiveLink.TryReceive, e.g. from Update()) and applies it
// through the engine's own HotSwap: a new engine over the pushed bundle,
// carrying the old one's run, on the same registry. The runtime's
// Load already tolerates edited content (a deleted card leaves the table,
// orphaned cooldowns and hand contents drop, a new property takes its
// default), so the run carries across; it refuses only a save from another
// project. Patterplay's applier has two tiers (strings-only vs hot swap)
// because it has string tables and a cursor to re-find; we have neither, so
// this is the one tier. Wire-up (in a MonoBehaviour's Update, behind your debug flag):
//
//   if (_link.TryReceive(out var raw) && StoryletLiveBundle.TryParsePush(raw, out var build, out var data))
//   {
//       var r = StoryletLiveBundle.Apply(_engine, data);
//       if (!r.Ok) { Debug.LogWarning(r.Error); return; }
//       _engine = r.Engine;                            // re-bind: HotSwap rebuilt
//       _flow = _engine.GetFlow("main");               // every flow, so re-take handles
//       _link.Attach(_engine);                         // re-attach the ENGINE
//       _link.SetBuild(build);
//   }
//
// Lives in the Json assembly (needs Newtonsoft to parse the envelope and the
// bundle); pure, so the dotnet TestHost compiles and exercises it too.

using System;
using Newtonsoft.Json.Linq;

namespace StoryletStudio.StoryletEngine
{
    /// <summary>What applying a pushed bundle produced: on success the new
    /// ENGINE carrying the old one's run (every flow of it) and the bundle it
    /// runs, and the report its load gave; on failure the reason, and the
    /// engine you had is left as it was. The swap rebuilt every flow, so
    /// re-take your handles.</summary>
    public sealed class StoryletLiveBundleResult
    {
        public bool Ok;
        public Engine Engine;
        public Bundle Bundle;
        /// <summary>What the load did that was not a plain restore (a property
        /// the edit dropped, defaulted or retyped, a card it evicted); null on
        /// failure.</summary>
        public LoadReport Report;
        public string Error;
    }

    public static class StoryletLiveBundle
    {
        /// <summary>Parse an editor push frame. True only for a well-formed
        /// <c>{t:"bundle", build, data}</c> message; anything else is not for us.</summary>
        public static bool TryParsePush(string rawMessage, out string build, out string data)
        {
            build = null; data = null;
            try
            {
                var msg = JObject.Parse(rawMessage);
                if ((string)msg["t"] != "bundle") return false;
                build = (string)msg["build"];
                data = (string)msg["data"];
                return build != null && data != null;
            }
            catch { return false; }
        }

        /// <summary>Apply a pushed bundle: parse <paramref name="data"/> (the
        /// .storyletsc JSON) and swap it in through the engine's own
        /// <see cref="Engine.HotSwap"/>, returning the replacement. Never
        /// throws; a failure (bad JSON, a bundle the runtime rejects, another
        /// project) comes back with Ok false and <paramref name="engine"/> left
        /// as it was.
        ///
        /// Works whether the engine made its own registry or was given the
        /// game's: on the game's registry the old engine hands its keys to the
        /// replacement, which a plain save and load into a second engine cannot
        /// do (the two would clash). The engine remembers the options it was
        /// built with (Seed, Log, World, Registry), so <paramref name="change"/>
        /// is only for building the replacement with different ones: it edits a
        /// copy of them, and whatever it leaves alone is kept (a Registry it
        /// sets is ignored), as in <see cref="Engine.HotSwap"/>.</summary>
        public static StoryletLiveBundleResult Apply(Engine engine, string data, Action<EngineOptions> change = null)
        {
            Bundle bundle;
            try
            {
                bundle = BundleLoader.Parse(data);
            }
            catch (Exception e)
            {
                return new StoryletLiveBundleResult { Ok = false, Error = "pushed bundle is not a valid bundle: " + e.Message };
            }
            try
            {
                // The engine's own HotSwap: on the game's registry the old engine
                // has to hand its keys over, which a plain save and load into a
                // new engine cannot do.
                var swapped = engine.HotSwap(bundle, change);
                return new StoryletLiveBundleResult { Ok = true, Engine = swapped.Engine, Bundle = bundle, Report = swapped.Report };
            }
            catch (Exception e)
            {
                return new StoryletLiveBundleResult { Ok = false, Error = e.Message };
            }
        }
    }
}
