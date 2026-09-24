// Compiled in place of everything else when there is no Patter checkout beside
// this repo (WithPatter.csproj decides), so a plain clone of storylets builds and
// runs this host and is told why it proved nothing, rather than failing on
// Patterplay sources it was never meant to have.
//
// REQUIRE_PATTER=1 turns the skip into a failure. CI sets it: there a skip would
// be a green that proved nothing.

using System;

namespace StoryletStudio.CombinedProof
{
    internal static class Program
    {
        private static int Main()
        {
            var msg = "no Patterplay source at " + BuildInfo.PatterDir
                + " (clone wildwinter/patter beside storylets, or pass -p:PatterDir=/path/to/patter)";
            if (Environment.GetEnvironmentVariable("REQUIRE_PATTER") == "1")
            {
                Console.WriteLine("FAIL with-patter: " + msg);
                return 1;
            }
            Console.WriteLine("SKIP with-patter: " + msg);
            return 0;
        }
    }
}
