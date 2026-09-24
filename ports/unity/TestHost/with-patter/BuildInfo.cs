// Where the build looked for Patterplay (WithPatter.csproj's PatterDir), stamped
// into the assembly so the host can say which Patter it proved, or which it
// could not find.

using System.Linq;
using System.Reflection;

namespace StoryletStudio.CombinedProof
{
    internal static class BuildInfo
    {
        public static string PatterDir => typeof(BuildInfo).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(a => a.Key == "PatterDir")?.Value ?? "(unknown)";
    }
}
