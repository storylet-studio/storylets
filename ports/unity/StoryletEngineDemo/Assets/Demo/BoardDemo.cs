// The Unity Board demo: the board itself, playable. Every hand on the table is
// a labelled group, every dealt card a button, every outcome a button beneath
// the card it belongs to, and a transcript records each deal, play and turn.
// It mirrors the Board demo shipped with the other three Storylet Engine
// runtimes (JS, Unreal, Godot): same content, same control labels, same
// transcript lines, so one demo reads four ways.
//
// The bundle is the-hamlet.storyletsc sitting beside this file, the compiled
// form of the repo's examples/the-hamlet.storylets. Seed 7 with the retained
// log on, so every runtime's Board demo deals the same cards and the examiner's
// log fills as you play.
//
// Run it: open this project and press Play (Assets/BoardDemo.unity is the scene
// it opens on). The scene already carries a wired-up BoardDemo, and the
// .storyletsc imports as a StoryletBundleAsset by itself. Then open
// Window > Storylet Engine > Runtime State to watch the live session.
//
// In the editor (and a development build) it also opens a Live Link to
// Storyletter (design/live-link.md): turn the link on in the editor, press
// Play, and the editor's Board shows this run; save in the editor and the new
// bundle lands in Update() via StoryletLiveBundle.Apply, the run carried
// across. A player build strips all of it (the #if guard), and with no editor
// listening the link is a silent no-op.
//
// The smallest possible integration is Start() plus DealAllHands(): load the
// bundle, create a session, deal, read Board(). Everything else here is the UI
// around that handful of calls. The whole UI is immediate-mode OnGUI, so there
// is no prefab or scene wiring to unpick: to run it in your own game, add this
// component to any GameObject and assign an imported bundle to it.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using UnityEngine;

namespace StoryletStudio.StoryletEngine.Demo
{
    public sealed class BoardDemo : MonoBehaviour
    {
        [Tooltip("The imported the-hamlet.storyletsc (a StoryletBundleAsset).")]
        public StoryletBundleAsset Bundle;

        [Tooltip("Flow PRNG seed; every Board demo uses 7, so all four runtimes deal the same cards.")]
        public double Seed = 7;

        /// <summary>The label this session shows up under in the debug registry.</summary>
        private const string DebugLabel = "board demo";

        /// <summary>What an empty hand says, on the board and in the transcript.</summary>
        private const string EmptyHand = "(nothing here right now)";

        private const string ExaminerHint =
            "Open Window > Storylet Engine > Runtime State to watch this session live.";

        /// <summary>One hand on the board: the gameId Deal / Play take, its
        /// display label, and what is dealt to it right now.</summary>
        private sealed class HandRow
        {
            public string Hand;
            public string Label;
            public List<DealtCard> Cards;
        }

        private Engine _engine;
        private Flow _session;
        private BundleContent _content;

#if UNITY_EDITOR || DEVELOPMENT_BUILD
        /// <summary>The Live Link to Storyletter: the session's trace streams to
        /// the editor's Board, and saved edits come back as pushed bundles.</summary>
        private StoryletLiveLink _link;
#endif

        /// <summary>Hand gameId -> title-or-gameId, read once off the bundle
        /// (the board is keyed by gameId; titles are what a player should see).</summary>
        private readonly Dictionary<string, string> _handLabels = new Dictionary<string, string>();

        private string _header = "";
        private readonly List<HandRow> _rows = new List<HandRow>();
        private readonly List<string> _transcript = new List<string>();

        // The one open card (only ever one), and the outcomes read for it.
        private string _openHand;
        private string _openCard;
        private List<OutcomeView> _openOutcomes;

        // Clicks mutate the board, so they run after the GUI pass, never inside it.
        private Action _pending;

        private Vector2 _boardScroll;
        private Vector2 _transcriptScroll;
        private GUIStyle _groupStyle;

        private void Start()
        {
            if (Bundle == null)
            {
                Debug.LogWarning("BoardDemo: assign the imported the-hamlet.storyletsc to the Bundle field.");
                enabled = false;
                return;
            }
            if (!string.IsNullOrEmpty(Bundle.LoadError))
            {
                Debug.LogError($"BoardDemo: bundle failed to load - {Bundle.LoadError}");
                enabled = false;
                return;
            }

            var compiled = Bundle.Bundle;
            _content = compiled.Content;
            foreach (var box in compiled.Boxes)
            {
                foreach (var hand in box.Hands)
                {
                    var gameId = Model.EffectiveGameId(hand);
                    _handLabels[gameId] = Label(hand.Title, gameId);
                }
            }

            StartSession();
#if UNITY_EDITOR || DEVELOPMENT_BUILD
            // Attached before the socket opens, so the hello carries the boxes.
            _link = new StoryletLiveLink(_content.Hash, _content.Project);
            _link.Attach(_engine);
            StoryletDebug.RegisterLink(_link);
#endif
            // The board opens dealt: the first hands are already out, so there is
            // something to read and play the moment the demo starts.
            DealAllHands();
        }

#if UNITY_EDITOR || DEVELOPMENT_BUILD
        /// <summary>Live refresh: the editor pushed a bundle. Drained here so the
        /// swap runs on the main thread; the run carries across, the handle and
        /// the registry re-bind, and the link re-hellos with the new build.</summary>
        private void Update()
        {
            if (_link == null || !_link.TryReceive(out var raw)) return;
            if (!StoryletLiveBundle.TryParsePush(raw, out var build, out var data)) return;
            var r = StoryletLiveBundle.Apply(_engine, data, new EngineOptions { Seed = Seed, Log = true });
            if (!r.Ok)
            {
                Append($"! live refresh refused: {r.Error}");
                return;
            }
            StoryletDebug.Unregister(_engine);
            _engine = r.Engine;
            _session = _engine.GetFlow("main") ?? _engine.OpenFlow("main");
            StoryletDebug.Register(_engine, DebugLabel);
            _link.Attach(_engine);
            _link.SetBuild(build);
            Append($"live refresh: build {build}");
            Refresh();
        }
#endif

        private void OnDestroy()
        {
#if UNITY_EDITOR || DEVELOPMENT_BUILD
            if (_link != null) StoryletDebug.UnregisterLink(_link);
            _link?.Close();
            _link = null;
#endif
            if (_engine != null) StoryletDebug.Unregister(_engine);
            _session = null;
            _engine = null;
        }

        // --- the session ------------------------------------------------------

        private void StartSession()
        {
            // Retained log on: the Runtime State window's log panel fills as you play.
            _engine = new Engine(Bundle.Bundle, new EngineOptions { Seed = Seed, Log = true });
            _session = _engine.OpenFlow("main");
            StoryletDebug.Register(_engine, DebugLabel);
        }

        // --- the controls -----------------------------------------------------

        /// <summary>Deal every hand in one call, then report the dealt slice.</summary>
        private void DealAllHands()
        {
            foreach (var pair in _session.DealMany())
            {
                var names = pair.Value.Select(c => Label(c.Title, c.GameId)).ToList();
                Append($"dealt: {HandLabel(pair.Key)} <- {(names.Count == 0 ? EmptyHand : string.Join(", ", names))}");
            }
            CollapseCard();
            Refresh();
        }

        /// <summary>Every box has its own clock (schema 3.4); this winds them all on.</summary>
        private void NextTurn()
        {
            foreach (var box in _session.ListBoxes())
            {
                _session.AdvanceTurns(box.GameId, 1);
                Append($"turn {Label(box.Title, box.GameId)} -> {Num(box.Turn + 1)}");
            }
            Refill();   // time passed: cooldowns lapse, so the hands refresh too
        }

        /// <summary>Drop the session and build a fresh one on the same seed: the
        /// board empties, every clock goes back to 0, the transcript starts over.</summary>
        private void Restart()
        {
            if (_engine != null) StoryletDebug.Unregister(_engine);
            _session = null;
            StartSession();
#if UNITY_EDITOR || DEVELOPMENT_BUILD
            _link?.Attach(_engine);   // the editor follows the new run
#endif
            CollapseCard();
            _transcript.Clear();
            Append($"restarted (seed {Num(Seed)})");
            DealAllHands();   // a restart deals too, so the board is never empty
        }

        private void PlayOutcome(string hand, DealtCard card, string outcomeGameId, string outcomeLabel)
        {
            try
            {
                _session.Play(card.Id, outcomeGameId, hand);
                Append($"played \"{Label(card.Title, card.GameId)}\" -> {outcomeLabel}");
                CollapseCard();
            }
            catch (StoryletError e)
            {
                Append($"! {e.Message}");
            }
            Refill();
        }

        /// <summary>The world moved, so the board does too: re-deal every hand,
        /// which fills the slots a play emptied and drops any card the new state
        /// invalidated. Silently, on purpose: the transcript keeps the beats you
        /// caused, and the arrivals and departures are already in the Runtime
        /// State window's log panel.</summary>
        private void Refill()
        {
            _session.DealMany();
            Refresh();
        }

        private void ToggleCard(string hand, DealtCard card)
        {
            if (_openHand == hand && _openCard == card.Id)
            {
                CollapseCard();
                return;
            }
            _openHand = hand;
            _openCard = card.Id;
            _openOutcomes = _session.Outcomes(card.Id, hand);
        }

        private void CollapseCard()
        {
            _openHand = null;
            _openCard = null;
            _openOutcomes = null;
        }

        // --- reading the session back ------------------------------------------

        /// <summary>Re-read the header and the board off the session. Outcome
        /// availability is never snapshotted, so an open card's outcomes are
        /// re-asked here too (a turn can unlock one).</summary>
        private void Refresh()
        {
            var boxes = _session.ListBoxes()
                .Select(b => $"{Label(b.Title, b.GameId)} turn {Num(b.Turn)}");
            _header = $"{_content.Project} {_content.Version} - {string.Join(", ", boxes)}";

            _rows.Clear();
            foreach (var pair in _session.Board())
            {
                _rows.Add(new HandRow { Hand = pair.Key, Label = HandLabel(pair.Key), Cards = pair.Value });
            }

            if (_openCard == null) return;
            var open = _rows.FirstOrDefault(r => r.Hand == _openHand);
            if (open != null && open.Cards.Any(c => c.Id == _openCard))
            {
                _openOutcomes = _session.Outcomes(_openCard, _openHand);
            }
            else
            {
                CollapseCard();
            }
        }

        private void Append(string line)
        {
            _transcript.Add(line);
            _transcriptScroll.y = float.MaxValue;   // newest last, always in view
        }

        private static string Label(string title, string gameId)
        {
            return string.IsNullOrEmpty(title) ? gameId : title;
        }

        private string HandLabel(string gameId)
        {
            return _handLabels.TryGetValue(gameId, out var label) ? label : gameId;
        }

        /// <summary>Turns and seeds read as integers, culture-independently.</summary>
        private static string Num(double value)
        {
            return value.ToString("0.##", CultureInfo.InvariantCulture);
        }

        // --- the board on screen ------------------------------------------------

        private void OnGUI()
        {
            if (_session == null) return;
            if (_groupStyle == null)
            {
                _groupStyle = new GUIStyle(GUI.skin.label) { fontStyle = FontStyle.Bold };
            }

            GUILayout.BeginArea(new Rect(12, 12, Screen.width - 24, Screen.height - 24));

            GUILayout.Label(_header, _groupStyle);
            GUILayout.Label(ExaminerHint);
            GUILayout.Space(8);

            _boardScroll = GUILayout.BeginScrollView(_boardScroll, GUILayout.ExpandHeight(true));
            foreach (var row in _rows)
            {
                GUILayout.Label(row.Label, _groupStyle);
                if (row.Cards.Count == 0)
                {
                    GUILayout.BeginHorizontal();
                    GUILayout.Space(20);
                    GUILayout.Label(EmptyHand);
                    GUILayout.EndHorizontal();
                }
                else
                {
                    var hand = row.Hand;
                    foreach (var card in row.Cards)
                    {
                        var clicked = card;
                        GUILayout.BeginHorizontal();
                        GUILayout.Space(20);
                        if (GUILayout.Button(Label(card.Title, card.GameId), GUILayout.Width(280)))
                        {
                            _pending = () => ToggleCard(hand, clicked);
                        }
                        GUILayout.EndHorizontal();
                        if (_openHand == hand && _openCard == card.Id) DrawOutcomes(hand, card);
                    }
                }
                GUILayout.Space(8);
            }
            GUILayout.EndScrollView();

            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Deal all hands", GUILayout.Width(140))) _pending = DealAllHands;
            if (GUILayout.Button("Next turn", GUILayout.Width(140))) _pending = NextTurn;
            if (GUILayout.Button("Restart", GUILayout.Width(140))) _pending = Restart;
            GUILayout.EndHorizontal();
            GUILayout.Space(8);

            _transcriptScroll = GUILayout.BeginScrollView(_transcriptScroll, GUILayout.Height(150));
            foreach (var line in _transcript) GUILayout.Label(line);
            GUILayout.EndScrollView();

            GUILayout.EndArea();

            // Out of the layout pass: safe to rebuild the board now.
            if (_pending != null)
            {
                var action = _pending;
                _pending = null;
                action();
            }
        }

        /// <summary>An open card's outcomes, beneath it. Unavailable ones still
        /// show (the gate is part of the story), disabled and marked.</summary>
        private void DrawOutcomes(string hand, DealtCard card)
        {
            if (_openOutcomes == null) return;
            foreach (var outcome in _openOutcomes)
            {
                var label = Label(outcome.Title, outcome.GameId);
                var gameId = outcome.GameId;
                var available = outcome.Available;
                GUILayout.BeginHorizontal();
                GUILayout.Space(40);
                GUI.enabled = available;
                if (GUILayout.Button(available ? label : label + " (locked)", GUILayout.Width(260)))
                {
                    _pending = () => PlayOutcome(hand, card, gameId, label);
                }
                GUI.enabled = true;
                GUILayout.EndHorizontal();
            }
        }
    }
}
