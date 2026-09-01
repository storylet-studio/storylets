// Window > Storylet Engine > Runtime State - the property examiner / editor
// (engine-runtimes.md section 2, piece 4): watch AND edit a live session's
// properties, filter them by name/path, save / load the whole run to a
// .storyletsave file, and read the board. Register sessions from your game
// with StoryletDebug.Register(engine, "label"); the window asks each engine
// for its open flows.
//
// The value refresh runs at ~4 Hz and skips the focused control: text and
// number editors are Delayed fields, which hold their own edit buffer while
// focused, so a repaint never clobbers half-typed input; edits commit through
// Flow.SetProperty (a silent host write under the firing rule).
//
// The log panel (design 2.3: the session's retained log surfaced in every
// examiner; the old port's Unreal log panel is the high-water mark): the
// lines of Flow.Log() behind per-kind filters (a peek files under Deal -
// both are asks), with Autoscroll, Copy and Clear. Empty until the session
// is created with the log option (EngineOptions.Log).

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace StoryletStudio.StoryletEngine.Editor
{
    public sealed class StoryletStateWindow : EditorWindow
    {
        private Vector2 _scroll;
        private double _lastRepaint;
        private string _filter = "";

        // The log panel's state: kind filters and autoscroll are window-wide;
        // scroll position and the autoscroll edge detector are per session.
        private static readonly string[] LogKinds = { "deal", "play", "write", "evict", "turns", "diagnostic" };
        private static readonly string[] LogKindLabels = { "Deal", "Play", "Write", "Evict", "Turns", "Diag" };
        private readonly Dictionary<string, bool> _logKindOn = new Dictionary<string, bool>();
        private bool _autoscroll = true;
        // Keyed by the log's OWNER, which is a Flow for its own log and the
        // Engine for the run log, so both keep their own scroll and position.
        //
        // PRUNED at the end of every OnGUI to the owners actually drawn. These
        // hold STRONG references, and until 2026-08-29 nothing ever removed an
        // entry: pressing Restart in the demo ten times, or taking ten live
        // refreshes, left this window holding all ten dead engines, their
        // flows and their bundles - which quietly defeated the whole point of
        // StoryletDebug keying its registry weakly. Weak keys would need a
        // ConditionalWeakTable and a boxed value per entry; pruning is simpler
        // and obviously right, because the window redraws from the live
        // registry and anything absent from a frame is gone.
        private readonly Dictionary<object, Vector2> _logScrolls = new Dictionary<object, Vector2>();
        private readonly Dictionary<object, long> _logLastSeq = new Dictionary<object, long>();
        /// <summary>The log owners drawn this frame, collected by DrawLogPanel.</summary>
        private readonly HashSet<object> _drawnThisFrame = new HashSet<object>();

        [MenuItem("Window/Storylet Engine/Runtime State")]
        public static void Open()
        {
            // Dock it on first open rather than letting it float: a floating
            // EditorWindow slides behind the main window the moment you click
            // the Game view, which is exactly when you want to be watching it.
            // Docked next to the Inspector it sits beside the game while it
            // plays, and it stays a normal dockable window, so drag it wherever
            // you like afterwards and Unity remembers. (A utility window,
            // GetWindow(true, ...), would stay on top but could never be
            // docked, which is the worse trade.)
            var w = GetWindow<StoryletStateWindow>("Storylet State", DockNextTo());
            w.minSize = new Vector2(380, 300);
            w.Show();
            w.Focus();
        }

        /// <summary>The windows we would like to dock beside, best first. The
        /// Inspector is internal, so it is looked up by name and quietly skipped
        /// if a future Unity renames it; SceneView is the public fallback.</summary>
        private static System.Type[] DockNextTo()
        {
            var wanted = new List<System.Type>();
            var inspector = System.Type.GetType("UnityEditor.InspectorWindow,UnityEditor");
            if (inspector != null) wanted.Add(inspector);
            wanted.Add(typeof(SceneView));
            return wanted.ToArray();
        }

        private void OnEnable()
        {
            StoryletDebug.OnChanged += HandleRegistryChanged;
        }

        private void OnDisable()
        {
            StoryletDebug.OnChanged -= HandleRegistryChanged;
        }

        private void HandleRegistryChanged() => Repaint();

        // OnInspectorUpdate fires ~10 Hz; throttle the live-value refresh to ~4 Hz.
        private void OnInspectorUpdate()
        {
            var now = EditorApplication.timeSinceStartup;
            if (now - _lastRepaint < 0.25) return;
            _lastRepaint = now;
            Repaint();
        }

        private void OnGUI()
        {
            _drawnThisFrame.Clear();
            DrawLiveLink();
            var engines = StoryletDebug.List();
            if (engines.Count == 0)
            {
                EditorGUILayout.HelpBox(
                    "No engines registered. Call " +
                    "StoryletDebug.Register(engine, \"label\") to watch and edit its state here.",
                    MessageType.Info);
                return;
            }

            _filter = EditorGUILayout.TextField("Filter properties", _filter);

            _scroll = EditorGUILayout.BeginScrollView(_scroll);
            int idx = 0;
            foreach (var entry in engines)
            {
                var title = string.IsNullOrEmpty(entry.Label) ? $"Engine #{idx}" : entry.Label;
                EditorGUILayout.LabelField(title, EditorStyles.boldLabel);
                DrawSaveLoad(entry.Engine);
                EditorGUILayout.Space();
                DrawRunLog(entry.Engine);
                EditorGUILayout.Space();

                // One section per open flow: a flow IS the playthrough, so its
                // properties, clocks, board and log are what a debugger wants,
                // and a game with several flows gets each of them.
                var flows = entry.Engine.Flows();
                if (flows.Count == 0)
                {
                    EditorGUILayout.LabelField("(no open flows - call OpenFlow)");
                }
                foreach (var flow in flows)
                {
                    EditorGUILayout.LabelField($"flow: {flow.Id}");
                    DrawProperties(flow);
                    EditorGUILayout.Space();
                    DrawReadOnlyState(flow);
                    EditorGUILayout.Space();
                    DrawLog(flow);
                    EditorGUILayout.Space();
                }
                idx++;
            }
            EditorGUILayout.EndScrollView();

            // Drop the state of any log owner that is no longer on screen, so a
            // window left open across restarts and live refreshes stops holding
            // dead engines alive. Repaint-only frames redraw every panel, so the
            // set is complete whenever this runs.
            PruneLogState();
        }

        // -- the Live Link to Storyletter, if the game registered one ----------------

        private void DrawLiveLink()
        {
            var link = StoryletDebug.Link;
            if (link == null) return;
            string state;
            switch (link.State)
            {
                case LiveLinkState.Connected: state = "connected, build " + link.Build; break;
                case LiveLinkState.Connecting: state = "connecting"; break;
                default: state = "closed"; break;
            }
            EditorGUILayout.LabelField("Live Link", $"{state} ({link.Url})");
        }

        // -- Save / Load (in every examiner, the parity rule) --------------------

        private void DrawSaveLoad(Engine engine)
        {
            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button("Save State...", GUILayout.Width(110)))
            {
                string path = EditorUtility.SaveFilePanel(
                    "Save storylets state", "", "save.storyletsave", "storyletsave");
                if (!string.IsNullOrEmpty(path))
                {
                    try { File.WriteAllText(path, StoryletSave.SerializeState(engine)); }
                    catch (Exception e) { EditorUtility.DisplayDialog("Save failed", e.Message, "OK"); }
                }
            }
            if (GUILayout.Button("Load State...", GUILayout.Width(110)))
            {
                string path = EditorUtility.OpenFilePanel(
                    "Load storylets state", "", "storyletsave");
                if (!string.IsNullOrEmpty(path))
                {
                    try { StoryletSave.DeserializeState(engine, File.ReadAllText(path)); }
                    catch (Exception e) { EditorUtility.DisplayDialog("Load failed", e.Message, "OK"); }
                }
            }
            EditorGUILayout.EndHorizontal();
        }

        // -- The property examiner / editor ---------------------------------------

        private void DrawProperties(Flow session)
        {
            EditorGUILayout.LabelField("Properties", EditorStyles.miniBoldLabel);
            var rows = session.ListProperties();
            if (rows.Count == 0)
            {
                EditorGUILayout.LabelField("  (none declared)");
                return;
            }
            int shown = 0;
            foreach (var row in rows)
            {
                // The property filter (name/path substring, case-blind - the
                // parity member Unreal renders as an SSearchBox).
                if (_filter.Length > 0 && row.Path.IndexOf(_filter, StringComparison.OrdinalIgnoreCase) < 0)
                {
                    continue;
                }
                shown++;
                EditorGUILayout.BeginHorizontal();
                EditorGUILayout.LabelField(row.Path, GUILayout.Width(200));

                using (new EditorGUI.DisabledScope(!row.Writable))
                {
                    var edited = DrawValueField(row);
                    if (edited != null && !edited.ValueEquals(row.Value))
                    {
                        session.SetProperty(row.Path, edited);
                    }

                    // Reset-to-default, disabled while already at default.
                    using (new EditorGUI.DisabledScope(row.Value != null && row.Value.ValueEquals(row.Default)))
                    {
                        if (GUILayout.Button("Reset", GUILayout.Width(48)))
                        {
                            session.SetProperty(row.Path, row.Default);
                            GUI.FocusControl(null);
                        }
                    }
                }
                EditorGUILayout.EndHorizontal();
            }
            if (shown == 0)
            {
                EditorGUILayout.LabelField("  (none match the filter)");
            }
        }

        /// <summary>One type-aware editor. Returns the edited value, or null when
        /// nothing committed this frame. Delayed fields keep the focused control's
        /// half-typed buffer safe across the ~4 Hz refresh.
        ///
        /// The delayed fields are passed GUIContent.none rather than using the
        /// no-label overload: that overload reaches Style.DrawPrefixLabel with a
        /// null GUIContent and throws ("may not be called with GUIContent that is
        /// null"). These rows draw their own label, so none is the right content.</summary>
        private StoryletValue DrawValueField(PropertyRow row)
        {
            switch (row.Type)
            {
                case PropertyTypes.Boolean:
                    return StoryletValue.Bool(EditorGUILayout.Toggle(row.Value != null && row.Value.IsBool && row.Value.AsBool));
                case PropertyTypes.Number:
                {
                    double current = row.Value != null && row.Value.IsNumber ? row.Value.AsNumber : 0;
                    return StoryletValue.Num(EditorGUILayout.DelayedDoubleField(GUIContent.none, current));
                }
                case PropertyTypes.String:
                {
                    string current = row.Value != null && row.Value.IsString ? row.Value.AsString : "";
                    return StoryletValue.Str(EditorGUILayout.DelayedTextField(GUIContent.none, current));
                }
                case PropertyTypes.Enum:
                case PropertyTypes.Quality:
                {
                    // A quality edits as a dropdown of its STAGE LADDER, closed exactly
                    // like an enum's values. ListProperties has carried Stages for this
                    // all along; until 2026-09-01 nothing read it and a quality fell to
                    // the read-only label below.
                    var opts = (row.Type == PropertyTypes.Quality ? row.Stages : row.Values)
                               ?? new List<string>();
                    if (opts.Count == 0)
                    {
                        EditorGUILayout.LabelField(row.Value?.ToString() ?? "");
                        return null;
                    }
                    int cur = row.Value != null && row.Value.IsString
                        ? Mathf.Max(0, opts.IndexOf(row.Value.AsString))
                        : 0;
                    int next = EditorGUILayout.Popup(cur, opts.ToArray());
                    return StoryletValue.Str(opts[Mathf.Clamp(next, 0, opts.Count - 1)]);
                }
                case PropertyTypes.Flags:
                {
                    string current = row.Value != null && row.Value.IsFlags
                        ? string.Join(", ", row.Value.AsFlags)
                        : "";
                    string next = EditorGUILayout.DelayedTextField(GUIContent.none, current);
                    if (next == current) return null;
                    var list = next.Split(',').Select(s => s.Trim()).Where(s => s.Length > 0).ToList();
                    return StoryletValue.Flags(list);
                }
                default:
                    EditorGUILayout.LabelField(row.Value?.ToString() ?? "");
                    return null;
            }
        }

        // -- The log panel (design 2.3) ---------------------------------------------

        /// <summary>Which filter bucket an entry files under; a peek files
        /// under "deal" (both are asks).</summary>
        private static string LogKindOf(TraceEvent evt)
        {
            if (evt is DealEvent || evt is PeekEvent) return "deal";
            if (evt is PlayEvent) return "play";
            if (evt is WriteEvent) return "write";
            if (evt is EvictEvent) return "evict";
            if (evt is TurnsEvent) return "turns";
            return "diagnostic";
        }

        private static string ShowValue(StoryletValue v) => v == null ? "<unset>" : v.ToJsonString();

        private static string DealtIds(List<TraceCard> cards)
        {
            var dealt = cards.Where(c => c.Verdict == TraceVerdict.Dealt).Select(c => c.Id).ToList();
            return dealt.Count > 0 ? string.Join(", ", dealt) : "(none)";
        }

        /// <summary>One line per entry, [turn]-stamped where the event has a
        /// box context (write lines share the state logger's
        /// "path: from -> to" reading).</summary>
        /// <summary>One line of either log: a flow's own, or the engine's run
        /// log, which is the same events plus the flow that caused each. Named
        /// rather than generic so both call sites read the same.</summary>
        private struct LogLine
        {
            public TraceEvent Event;
            public long Seq;
            public double? Turn;
            /// <summary>Set on the run log only; a flow's own log would just be
            /// repeating its own heading.</summary>
            public string Flow;
        }

        private static string FormatLogLine(LogLine line)
        {
            var prefix = string.IsNullOrEmpty(line.Flow) ? "" : line.Flow + " ";
            return FormatLogEntry(new LogEntry { Event = line.Event, Seq = line.Seq, Turn = line.Turn }, prefix);
        }

        internal static string FormatLogEntry(LogEntry entry, string flowPrefix = "")
        {
            var stamp = (entry.Turn != null ? $"[{StoryletValue.JsNumber(entry.Turn.Value)}] " : "[-] ") + flowPrefix;
            switch (entry.Event)
            {
                case DealEvent e:
                    return $"{stamp}deal {e.Hand}: {DealtIds(e.Cards)} ({e.Cards.Count} considered)";
                case PeekEvent e:
                {
                    var crit = string.Join(", ", e.Criteria.Select(p => $"{p.Key}={p.Value}"));
                    var suffix = crit.Length > 0 ? $" [{crit}]" : "";
                    return $"{stamp}peek {e.Box}{suffix}: {DealtIds(e.Cards)} ({e.Cards.Count} considered)";
                }
                case EvictEvent e:
                    return $"{stamp}evict {e.Card} from {e.Hand} ({e.Reason})";
                case PlayEvent e:
                    return $"{stamp}play {e.Card} -> {e.Outcome}";
                case WriteEvent e:
                    return $"{stamp}write {e.Path}: {ShowValue(e.Prev)} -> {ShowValue(e.Value)}";
                case TurnsEvent e:
                    return $"{stamp}turns {e.Box} -> {StoryletValue.JsNumber(e.Turn)}";
                case DiagnosticEvent e:
                    return $"{stamp}diagnostic {e.Where}: {e.Message}";
                default:
                    return $"{stamp}(unknown)";
            }
        }

        private void DrawLog(Flow session)
        {
            var lines = session.Log()
                .Select(e => new LogLine { Event = e.Event, Seq = e.Seq, Turn = e.Turn })
                .ToList();
            DrawLogPanel(session, "Log", lines, session.ClearLog);
        }

        /// <summary>The RUN's log: every flow's events in one order, each naming
        /// its flow. It sits with the engine because that is whose it is - a
        /// flow's own log cannot show a story action in another flow moving
        /// shared state (design/shared-scarcity.md 8.2).</summary>
        private void DrawRunLog(Engine engine)
        {
            var lines = engine.Log()
                .Select(e => new LogLine { Event = e.Event, Seq = e.Seq, Turn = e.Turn, Flow = e.Flow })
                .ToList();
            DrawLogPanel(engine, "Run log (every flow)", lines, engine.ClearLog);
        }

        /// <summary>Forget the scroll and sequence state of every log owner
        /// that was not drawn this frame.</summary>
        private void PruneLogState()
        {
            if (_logScrolls.Count == _drawnThisFrame.Count && _logLastSeq.Count == _drawnThisFrame.Count) return;
            var stale = new List<object>();
            foreach (var key in _logScrolls.Keys) if (!_drawnThisFrame.Contains(key)) stale.Add(key);
            foreach (var key in _logLastSeq.Keys) if (!_drawnThisFrame.Contains(key) && !stale.Contains(key)) stale.Add(key);
            foreach (var key in stale) { _logScrolls.Remove(key); _logLastSeq.Remove(key); }
        }

        private void DrawLogPanel(object key, string caption, List<LogLine> entries, System.Action clear)
        {
            _drawnThisFrame.Add(key);
            EditorGUILayout.LabelField(caption, EditorStyles.miniBoldLabel);

            // Per-kind visibility filters + Autoscroll + Copy / Clear.
            EditorGUILayout.BeginHorizontal();
            for (int i = 0; i < LogKinds.Length; i++)
            {
                var kind = LogKinds[i];
                if (!_logKindOn.ContainsKey(kind)) _logKindOn[kind] = true;
                _logKindOn[kind] = GUILayout.Toggle(_logKindOn[kind], LogKindLabels[i], EditorStyles.miniButton);
            }
            EditorGUILayout.EndHorizontal();

            var visible = entries
                .Where(e => _logKindOn[LogKindOf(e.Event)])
                .Select(FormatLogLine)
                .ToList();

            EditorGUILayout.BeginHorizontal();
            _autoscroll = GUILayout.Toggle(_autoscroll, "Autoscroll");
            if (GUILayout.Button("Copy", GUILayout.Width(60)))
            {
                // The visible (filtered) log to the clipboard.
                EditorGUIUtility.systemCopyBuffer = string.Join("\n", visible);
            }
            if (GUILayout.Button("Clear", GUILayout.Width(60)))
            {
                // Cosmetic - no game state changes; Seq keeps counting.
                clear();
                visible.Clear();
            }
            EditorGUILayout.EndHorizontal();

            _logScrolls.TryGetValue(key, out var scroll);
            var log = entries;
            var lastSeq = log.Count > 0 ? log[log.Count - 1].Seq : -1;
            _logLastSeq.TryGetValue(key, out var seenSeq);
            if (_autoscroll && lastSeq != seenSeq)
            {
                scroll.y = float.MaxValue;   // scroll to the latest entry
            }
            _logLastSeq[key] = lastSeq;

            scroll = EditorGUILayout.BeginScrollView(scroll, GUILayout.Height(150));
            if (visible.Count == 0)
            {
                EditorGUILayout.LabelField(log.Count == 0
                    ? "(empty - logs are retained when the engine is created with EngineOptions.Log)"
                    : "(all kinds filtered out)");
            }
            else
            {
                foreach (var line in visible)
                {
                    EditorGUILayout.LabelField(line, EditorStyles.miniLabel);
                }
            }
            EditorGUILayout.EndScrollView();
            _logScrolls[key] = scroll;
        }

        // -- Read-only: per-box turns + the board ----------------------------------

        private void DrawReadOnlyState(Flow session)
        {
            EditorGUILayout.LabelField("Turns (per box)", EditorStyles.miniBoldLabel);
            foreach (var box in session.ListBoxes())
            {
                var label = string.IsNullOrEmpty(box.Title) ? box.GameId : box.Title;
                EditorGUILayout.LabelField("  " + label, StoryletValue.JsNumber(box.Turn));
            }

            EditorGUILayout.LabelField("Board", EditorStyles.miniBoldLabel);
            var board = session.Board();
            foreach (var pair in board)
            {
                EditorGUILayout.LabelField("  " + pair.Key, EditorStyles.miniBoldLabel);
                if (pair.Value.Count == 0)
                {
                    EditorGUILayout.LabelField("    (empty)");
                    continue;
                }
                foreach (var card in pair.Value)
                {
                    EditorGUILayout.LabelField("    " + (string.IsNullOrEmpty(card.Title) ? card.GameId : card.Title));
                }
            }
        }
    }
}
