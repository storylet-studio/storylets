// The Hamlet's screen, immediate-mode OnGUI like the Board demo: places across
// the top, the stage (the hand, or the conversation), a footer. All the game is
// HamletGame; this only draws it and forwards clicks. The scene carries this
// component already; open the project and press Play.
using System.IO;
using UnityEngine;

namespace StoryletStudio.Hamlet
{
    public sealed class HamletUI : MonoBehaviour
    {
        private readonly HamletGame _game = new HamletGame();
        private string _savePath;
        private Vector2 _scroll;

        private void Start()
        {
            _savePath = Path.Combine(Application.persistentDataPath, "hamlet-save.json");
            var sa = Application.streamingAssetsPath;
            _game.Setup(File.ReadAllText(Path.Combine(sa, "hamlet.storyletsc")), File.ReadAllText(Path.Combine(sa, "hamlet.patterc")));
            if (File.Exists(_savePath)) { try { if (!_game.Load(File.ReadAllText(_savePath))) File.Delete(_savePath); } catch { File.Delete(_savePath); } }
        }

        private void Save() => File.WriteAllText(_savePath, _game.Save());

        private void OnGUI()
        {
            GUILayout.BeginArea(new Rect(20, 20, Screen.width - 40, Screen.height - 40));
            GUILayout.Label("<size=24><b>The Hamlet</b></size>", Rich());
            GUILayout.Label("The Storylet Engine chooses the beat. Patter performs it.    " + _game.WorldLine());
            GUILayout.BeginHorizontal();
            foreach (var (gameId, title) in _game.Places)
            {
                GUI.enabled = gameId != _game.At;
                if (GUILayout.Button(title, GUILayout.Height(30))) { _game.Go(gameId); Save(); }
                GUI.enabled = true;
            }
            GUILayout.EndHorizontal();
            GUILayout.Space(10);
            _scroll = GUILayout.BeginScrollView(_scroll, GUILayout.ExpandHeight(true));
            if (_game.Playing != null)
            {
                foreach (var s in _game.Playing.Shown) GUILayout.Label(s.kind == "line" ? $"{s.character}: {s.text}" : $"<i>{s.text}</i>", Rich());
                foreach (var (id, text) in _game.Playing.Choices) if (GUILayout.Button(text, GUILayout.Height(28))) { _game.Choose(id); Save(); }
            }
            else if (_game.At == "") GUILayout.Label("Choose somewhere to be.");
            else
            {
                var hand = _game.Hand();
                if (hand.Count == 0) GUILayout.Label("Nothing here just now.");
                foreach (var card in hand) if (GUILayout.Button(card.Title ?? card.GameId, GUILayout.Height(28))) { _game.Start(card); Save(); }
            }
            GUILayout.EndScrollView();
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Let time pass")) { _game.Wait(); Save(); }
            if (GUILayout.Button("Step outside")) { _game.Go(""); Save(); }
            if (GUILayout.Button("Restart")) { if (File.Exists(_savePath)) File.Delete(_savePath); UnityEngine.SceneManagement.SceneManager.LoadScene(UnityEngine.SceneManagement.SceneManager.GetActiveScene().name); }
            GUILayout.EndHorizontal();
            foreach (var line in _game.Log) { GUILayout.Label(line); }
            GUILayout.EndArea();
        }

        private static GUIStyle Rich() { var s = new GUIStyle(GUI.skin.label) { richText = true, wordWrap = true }; return s; }
    }
}
