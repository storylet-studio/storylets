// The dotnet host for the combined Patter + Storylet Engine proof
// (CombinedGame.cs). WithPatter.csproj compiles the Storylet Engine's Runtime and
// Json layers, Patterplay's from the sibling ../patter checkout, and ONE kernel:
// Patterplay's Runtime/Expr.
//
//   dotnet run --project ports/unity/TestHost/with-patter
//
// Prints an ok / FAIL line per case, then WITH PATTER ALL PASS (exit 0) or
// WITH PATTER N FAILED (exit 1). Without a Patter checkout this file is not
// compiled at all; Skip.cs is, and says so.

using System;
using System.IO;

namespace StoryletStudio.CombinedProof
{
    internal static class Program
    {
        private static int Main()
        {
            Console.WriteLine("with-patter: Patterplay from " + Path.GetFullPath(BuildInfo.PatterDir));
            var (passed, total, failures) = CombinedGame.Run(Console.WriteLine);
            Console.WriteLine($"with patter: {passed}/{total}");
            foreach (var f in failures) Console.WriteLine("  FAIL " + f);
            Console.WriteLine(failures.Count == 0 ? "WITH PATTER ALL PASS" : $"WITH PATTER {failures.Count} FAILED");
            return failures.Count == 0 ? 0 : 1;
        }
    }
}
