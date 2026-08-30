// Live refresh - the game-side applier (the C# parity of
// @storylet-studio/play-helpers' applyLiveBundle). The editor pushes
// {t:"bundle", build, data} over the Live Link; the game drains it on ITS OWN
// thread (StoryletLiveLink.TryReceive, e.g. from Update()) and applies: a new
// session over the pushed bundle, loaded from the old one's save. The runtime's
// Load already tolerates edited content (a deleted card leaves the table,
// orphaned cooldowns and hand contents drop, a new property takes its
// default), so the run carries across; it refuses only a save from another
// project. Patterplay's applier has two tiers (strings-only vs hot swap)
// because it has string tables and a cursor to re-find; we have neither, so
// this is the one tier. Wire-up (in a MonoBehaviour's Update, behind your debug flag):
//
//   if (_link.TryReceive(out var raw) && StoryletLiveBundle.TryParsePush(raw, out var build, out var data))
//   {
//       var r = StoryletLiveBundle.Apply(_engine, data, new EngineOptions { Seed = Seed, Log = true });
//       if (!r.Ok) { Debug.LogWarning(r.Error); return; }
//       _engine = r.Engine;                            // re-bind: LoadGame rebuilt
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
    /// runs; on failure the reason, and the engine you had is untouched.
    /// LoadGame rebuilt every flow, so re-take your handles.</summary>
    public sealed class StoryletLiveBundleResult
    {
        public bool Ok;
        public Engine Engine;
        public Bundle Bundle;
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
        /// .storyletsc JSON), create an ENGINE over it with <paramref name="opts"/>
        /// (the options the old engine was created with; the seed does not
        /// matter here, the save carries each flow's PRNG state, but Log and
        /// World do - neither rides the envelope), and load the old engine's
        /// save into it. Never throws; a failure (bad JSON, a bundle the
        /// runtime rejects, another project) comes back with Ok false and
        /// <paramref name="engine"/> is untouched.</summary>
        public static StoryletLiveBundleResult Apply(Engine engine, string data, EngineOptions opts = null)
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
                var next = new Engine(bundle, opts);
                next.LoadGame(engine.SaveGame());
                return new StoryletLiveBundleResult { Ok = true, Engine = next, Bundle = bundle };
            }
            catch (Exception e)
            {
                return new StoryletLiveBundleResult { Ok = false, Error = e.Message };
            }
        }
    }
}
