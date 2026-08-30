// A headless check that the committed demo project is actually runnable: it
// opens the demo scene, confirms the BoardDemo component is there with its
// bundle assigned, then drives the same API the buttons drive (open a flow,
// deal, play an outcome, deal again) and confirms the played card's hand
// refilled. It is the batch-mode equivalent of opening the project and pressing
// Play, and it is what CI runs.
//
//   Unity -batchmode -nographics -quit \
//     -projectPath ports/unity/StoryletEngineDemo \
//     -executeMethod StoryletStudio.StoryletEngine.Demo.Editor.BoardDemoSmokeTest.Run
//
// Nothing in the demo itself depends on this file; delete it freely when you
// lift the project as a starting point for your own game.

using System.Linq;
using StoryletStudio.StoryletEngine.Demo;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace StoryletStudio.StoryletEngine.Demo.Editor
{
    public static class BoardDemoSmokeTest
    {
        private const string ScenePath = "Assets/BoardDemo.unity";

        private static int _failures;

        public static void Run()
        {
            _failures = 0;

            var scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            Check(scene.IsValid(), $"scene opens: {ScenePath}");

            var buildScenes = EditorBuildSettings.scenes;
            Check(buildScenes.Length > 0 && buildScenes[0].path == ScenePath && buildScenes[0].enabled,
                "scene is first and enabled in EditorBuildSettings");

            var demo = Object.FindFirstObjectByType<BoardDemo>();
            Check(demo != null, "BoardDemo component resolves in the scene");
            if (demo == null) { Done(); return; }

            Check(demo.Bundle != null, "BoardDemo.Bundle is assigned");
            if (demo.Bundle == null) { Done(); return; }

            Check(string.IsNullOrEmpty(demo.Bundle.LoadError),
                $"bundle parses cleanly (LoadError: '{demo.Bundle.LoadError}')");

            var session = demo.Bundle.CreateEngine(demo.Seed, new EngineOptions { Log = true }).OpenFlow("main");
            Check(session != null, "flow opened off the assigned bundle");
            if (session == null) { Done(); return; }

            var dealt = session.DealMany();
            Check(dealt.Count > 0, $"deal filled the board ({dealt.Count} hands)");

            // Find a hand with a card that has a playable outcome, and play it.
            string playedHand = null;
            string playedCardId = null;
            int handCountBefore = 0;
            foreach (var pair in dealt)
            {
                foreach (var card in pair.Value)
                {
                    var outcome = session.Outcomes(card.Id, pair.Key).FirstOrDefault(o => o.Available);
                    if (outcome == null) continue;
                    playedHand = pair.Key;
                    playedCardId = card.Id;
                    handCountBefore = pair.Value.Count;
                    session.Play(card.Id, outcome.GameId, pair.Key);
                    Debug.Log($"PASS played '{card.GameId}' -> '{outcome.GameId}' from hand '{pair.Key}'");
                    break;
                }
                if (playedHand != null) break;
            }
            Check(playedHand != null, "found a dealt card with an available outcome and played it");
            if (playedHand == null) { Done(); return; }

            var afterPlay = session.Board();
            var gone = !afterPlay[playedHand].Any(c => c.Id == playedCardId);
            Check(gone, $"played card left hand '{playedHand}'");

            session.DealMany();
            var refilled = session.Board()[playedHand];
            Check(refilled.Count >= handCountBefore,
                $"hand '{playedHand}' refilled: {handCountBefore} before, {afterPlay[playedHand].Count} after the play, {refilled.Count} after the re-deal");

            Done();
        }

        private static void Check(bool ok, string what)
        {
            if (ok)
            {
                Debug.Log($"PASS {what}");
            }
            else
            {
                _failures++;
                Debug.LogError($"FAIL {what}");
            }
        }

        private static void Done()
        {
            if (_failures == 0)
            {
                Debug.Log("PASS BoardDemo smoke test: ALL PASS");
                EditorApplication.Exit(0);
            }
            else
            {
                Debug.LogError($"FAIL BoardDemo smoke test: {_failures} failure(s)");
                EditorApplication.Exit(1);
            }
        }
    }
}
