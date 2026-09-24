// The -executeMethod entry points scripts/check-unity-with-patter.sh calls in its
// scratch Unity project. Copied into Assets/Editor there; never compiled by the
// dotnet host.
//
//   Probe        runs WithPatterProbe in the editor and writes $PROBE_OUT
//   BuildPlayer  builds a macOS IL2CPP player of an empty scene to $PLAYER_OUT,
//                whose RuntimeInitializeOnLoadMethod runs the same probe
//
// Both exit through EditorApplication.Exit with their verdict, but the script
// never trusts that alone: it reads the result file and the build's output.

using System;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace StoryletStudio.CombinedProof
{
    public static class WithPatterEditor
    {
        public static void Probe()
        {
            int code = 1;
            try
            {
                var outPath = Environment.GetEnvironmentVariable("PROBE_OUT");
                var lines = WithPatterProbe.Run("editor");
                foreach (var l in lines) Debug.Log("[with-patter] " + l);
                code = !string.IsNullOrEmpty(outPath) && WithPatterProbe.Write(outPath, lines) ? 0 : 1;
            }
            catch (Exception e)
            {
                Debug.LogError("[with-patter] the probe threw " + e);
            }
            EditorApplication.Exit(code);
        }

        public static void BuildPlayer()
        {
            int code = 1;
            try
            {
                var outPath = Environment.GetEnvironmentVariable("PLAYER_OUT");
                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                EditorSceneManager.SaveScene(scene, "Assets/WithPatter.unity");
                PlayerSettings.SetScriptingBackend(NamedBuildTarget.Standalone, ScriptingImplementation.IL2CPP);
                var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
                {
                    scenes = new[] { "Assets/WithPatter.unity" },
                    locationPathName = outPath,
                    target = BuildTarget.StandaloneOSX,
                    options = BuildOptions.None,
                });
                Debug.Log("[with-patter] BUILD RESULT: " + report.summary.result + " errors=" + report.summary.totalErrors);
                code = report.summary.result == BuildResult.Succeeded ? 0 : 1;
            }
            catch (Exception e)
            {
                Debug.LogError("[with-patter] the player build threw " + e);
            }
            EditorApplication.Exit(code);
        }
    }
}
