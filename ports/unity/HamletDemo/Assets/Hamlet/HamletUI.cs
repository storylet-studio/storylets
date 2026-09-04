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
            // Plain black behind the panel. The scene's camera clears to Unity's default
            // skybox, whose bright band sits right under this text and makes it unreadable;
            // this demo is a wall of words over an empty 3D scene, so it wants no sky at all.
            var cam = Camera.main;
            if (cam != null) { cam.clearFlags = CameraClearFlags.SolidColor; cam.backgroundColor = Color.black; }
            _savePath = Path.Combine(Application.persistentDataPath, "hamlet-save.json");
            var sa = Application.streamingAssetsPath;
            _game.Setup(File.ReadAllText(Path.Combine(sa, "hamlet.storyletsc")), File.ReadAllText(Path.Combine(sa, "hamlet.patterc")));
            if (File.Exists(_savePath)) { try { if (!_game.Load(File.ReadAllText(_savePath))) File.Delete(_savePath); } catch { File.Delete(_savePath); } }
        }

        private void Save() => File.WriteAllText(_savePath, _game.Save());

        private void OnGUI()
        {
            // IMGUI delivers a click in the MIDDLE of the draw, so acting on the game here
            // would change what the rest of this pass is walking: Choose refills the very
            // list the choice loop is enumerating (Collection was modified), and Finish drops
            // Playing entirely (a null a line later). Every click is NOTED and acted on once,
            // at the end, so the panel is always drawn from one consistent state.
            System.Action act = null;
            GUILayout.BeginArea(new Rect(20, 20, Screen.width - 40, Screen.height - 40));
            GUILayout.Label("<size=24><b>The Hamlet</b></size>", Rich());
            GUILayout.Label("The Storylet Engine chooses the beat. Patter performs it.    " + _game.WorldLine());
            GUILayout.BeginHorizontal();
            foreach (var (gameId, title) in _game.Places)
            {
                // The place you are standing in is SELECTED, not disabled: greying it out says
                // "you may not go here", which is the opposite of what it means. It takes an
                // accent tint instead, and a click on it does nothing.
                var place = gameId;   // the loop variable, captured per iteration
                var here = gameId == _game.At;
                var wasTint = GUI.backgroundColor;
                if (here) GUI.backgroundColor = new Color(0.44f, 0.64f, 0.57f);
                if (GUILayout.Button(title, GUILayout.Height(30)) && !here) act = () => { _game.Go(place); Save(); };
                GUI.backgroundColor = wasTint;
            }
            GUILayout.EndHorizontal();
            GUILayout.Space(10);
            _scroll = GUILayout.BeginScrollView(_scroll, GUILayout.ExpandHeight(true));
            if (_game.Playing != null)
            {
                foreach (var s in _game.Playing.Shown) GUILayout.Label(s.kind == "line" ? $"{s.character}: {s.text}" : $"<i>{s.text}</i>", Rich());
                // The scene has ended: the outcome plays when the player has read it.
                if (_game.Playing.Done && GUILayout.Button("Continue", GUILayout.Height(28))) act = () => { _game.Finish(); Save(); };
                foreach (var (id, text, _, enabled, why) in _game.Playing.Choices)
                {
                    // Shut options are shown and unclickable, rather than hidden: the player
                    // sees what the scene could have offered, which is half the point.
                    GUI.enabled = enabled;
                    var option = id;
                    if (GUILayout.Button(enabled ? text : $"{text}  ({why})", GUILayout.Height(28))) act = () => { _game.Choose(option); Save(); };
                    GUI.enabled = true;   // IMGUI is modal: leave it on, or every control after this stays dead
                }
            }
            else if (_game.At == "") GUILayout.Label("Choose somewhere to be.");
            else
            {
                var hand = _game.Hand();
                if (hand.Count == 0) GUILayout.Label("Nothing here just now.");
                foreach (var card in hand)
                {
                    var dealt = card;
                    if (GUILayout.Button(card.Title ?? card.GameId, GUILayout.Height(28))) act = () => { _game.Start(dealt); Save(); };
                }
            }
            GUILayout.EndScrollView();
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Let time pass")) act = () => { _game.Wait(); Save(); };
            if (GUILayout.Button("Step outside")) act = () => { _game.Go(""); Save(); };
            if (GUILayout.Button("Restart")) { if (File.Exists(_savePath)) File.Delete(_savePath); UnityEngine.SceneManagement.SceneManager.LoadScene(UnityEngine.SceneManagement.SceneManager.GetActiveScene().name); }
            GUILayout.EndHorizontal();
            foreach (var line in _game.Log) { GUILayout.Label(line); }
            GUILayout.EndArea();
            act?.Invoke();   // the whole panel is drawn; now the click may change the game
        }

        private static GUIStyle Rich() { var s = new GUIStyle(GUI.skin.label) { richText = true, wordWrap = true }; return s; }
    }
}
