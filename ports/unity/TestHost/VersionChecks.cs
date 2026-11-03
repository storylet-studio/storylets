// The corpus's version cases (corpus 26): StoryletEngineVersion.InRange, held to the JS reference's versionInRange,
// the check a game or an extension makes at start-up against the Storylet Engine it finds.

using System;
using Newtonsoft.Json.Linq;

namespace StoryletStudio.StoryletEngine.TestHost
{
    internal static partial class Program
    {
        private static int RunVersions(JArray arr)
        {
            int pass = 0;
            foreach (var c in arr)
            {
                string name = c.Value<string>("name");
                try
                {
                    string version = c.Value<string>("version");
                    string min = c.Value<string>("min");
                    string maxExclusive = c.Value<string>("maxExclusive");
                    bool expected = c.Value<bool>("expected");
                    bool got = StoryletEngineVersion.InRange(version, min, maxExclusive);
                    if (got == expected) pass++;
                    else Fail("versions", name, $"InRange(\"{version}\", \"{min}\", \"{maxExclusive}\"): expected {expected}, got {got}");
                }
                catch (Exception ex) { Fail("versions", name, ex.Message); }
            }
            return pass;
        }
    }
}
