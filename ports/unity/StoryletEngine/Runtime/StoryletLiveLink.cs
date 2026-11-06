// StoryletLiveLink - the game-side client for Storyletter's Live Link
// (design/live-link.md). Joins a running game to the editor over a loopback
// WebSocket. Two things travel on it: the flow's trace stream and board
// snapshots go UP, so the editor's Board can show the game's run instead of its
// own (observe-only: the editor never drives the game); freshly compiled
// bundles come DOWN after a save, so the run picks up the edit without
// restarting (StoryletLiveBundle in the Json layer does the swap). The C#
// parity of @storylet-studio/play-helpers' createLiveLink, same
// `storyletengine/debug@1` wire protocol, and the shape of Patterplay's
// PatterDebugLink: a worker-thread ClientWebSocket, frames queued until the
// socket opens, an inbox the game drains from its own Update().
//
// It reconnects, by the rule Patter's debug link shares: until the game closes
// it, a socket that closes or never opens is tried again after 1 s, doubling to
// 10 s, and back to 1 s once a hello goes. Each new socket says hello again with
// the build and the open flows, then every flow's board, all from the
// game-thread snapshot (the worker never reads the engine). One line is logged
// (StoryletLiveLink.DefaultLog) when an open link is lost and one when it is
// back; a link that never opened logs nothing. Frames queue only while the
// first socket connects: after any attempt fails, nothing queues until a socket
// is open. The editor closes a game it replaced (another game connected) with
// code 4000, and that one does not retry, so two games do not take turns.
//
// Wire protocol (one JSON object per message):
//   hello : { t:"hello", v:2, build, project?, boxes?, flows:[id...] }
//                                                           - on open, and again on SetBuild
//   flowOpen / flowClose : { t:"flowOpen"|"flowClose", flow }
//   trace : { t:"trace", flow, event }                      - every TraceEvent any flow emits
//   board : { t:"board", flow, hands:{ hand: [card...] }, turns:{ box: n } }
//                                                           - after hello, and after every deal /
//                                                             play / evict / turns event
//   bundle: { t:"bundle", v:1, build, data }                - EDITOR -> game: the full .storyletsc JSON
// Identity in frames is by gameId, the trace event's own included since design
// change 4.4 took the runtime's whole trace to gameIds: this client no longer
// maps anything, it forwards what the engine emitted, in the reference's key
// order, so the shared fixture (packages/conformance/live-link/) can hold it
// byte for byte.
//
// It never throws into your game, and if the editor isn't listening every call
// is a silent no-op (a shipped game has nothing on 127.0.0.1:4472, so it stays
// inert). Even so it is a DEBUG tool: wire it behind
// `#if UNITY_EDITOR || DEVELOPMENT_BUILD` so it is stripped from a release build.
//
//   var link = new StoryletLiveLink(bundle.Content.Hash, "My Game");
//   link.Attach(engine);   // the ENGINE: the link discovers your flows itself
//   // ...in Update(): live refresh (see StoryletLiveBundle)
//   if (link.TryReceive(out var raw) && StoryletLiveBundle.TryParsePush(raw, out var build, out var data)) { ... }

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Wildwinter.Expr;

namespace StoryletStudio.StoryletEngine
{
    /// <summary>Where the link is, for a debug window: Connecting until the
    /// editor answers and while it retries after a socket closed or failed,
    /// Connected while a socket is open, Closed once the game closed the link,
    /// the editor replaced this game with another (close code 4000), or the
    /// address could not be dialled at all.</summary>
    public enum LiveLinkState { Connecting, Connected, Closed }

    public sealed class StoryletLiveLink : IDisposable
    {
        public const string DefaultUrl = "ws://127.0.0.1:4472";
        /// <summary>The editor closed this game because another connected: not retried.</summary>
        internal const int CloseReplaced = 4000;
        /// <summary>Frames kept while the first socket connects; beyond that
        /// the oldest go, as in the JS client.</summary>
        private const int QueueCap = 512;

        /// <summary>Where the link's few lines go (lost, back, replaced): standard
        /// error by default, which the Unity layer points at Debug.Log as the
        /// package loads (StoryletUnityLog). Called from the socket's worker
        /// thread.</summary>
        public static Action<string> DefaultLog = m => Console.Error.WriteLine(m);

        // mutable: SetBuild() after a live refresh lands; volatile because the
        // worker reads it for a re-hello.
        private volatile string _build;
        private readonly string _project;
        private readonly string _url;
        private readonly ILiveLinkSocket _socket;
        // Game -> editor frames, drained by the socket once it is open. The
        // hello never goes through here: it is sent first, ahead of anything
        // queued while the socket was still connecting.
        private readonly ConcurrentQueue<string> _outbox = new ConcurrentQueue<string>();
        // Editor -> game messages (live refresh). Filled by the receive loop on a
        // worker thread; the game DRAINS it from its own loop via TryReceive, so
        // the swap happens on the main thread (Unity objects must not be touched
        // from the socket thread).
        private readonly ConcurrentQueue<string> _inbox = new ConcurrentQueue<string>();
        private volatile bool _closed;    // the game closed it, the editor replaced it, or it cannot dial
        private volatile bool _connected;
        // An attempt has failed or closed: nothing queues until a socket is open
        // again, and the next open sends every flow's board after the hello.
        private volatile bool _dropped;
        // The retry's bookkeeping, touched only by the socket's own thread.
        private readonly int _retryFirstMs;
        private readonly int _retryMaxMs;
        private int _waitMs;
        private bool _wasOpen;          // a socket has been open, so losing it is worth a line
        private bool _lost;             // logged as lost, waiting to log it back

        /// <summary>Test hooks: the lines the link logs (DefaultLog when null),
        /// and how many frames wait in the outbox.</summary>
        internal Action<string> LogHook;
        internal int QueuedCount => _outbox.Count;

        private Engine _engine;
        // The flows the EDITOR believes are open; diffed against Engine.Flows()
        // so flowOpen / flowClose are the link's own business, not the host's.
        private readonly HashSet<string> _announced = new HashSet<string>();
        private Action _unsubscribe;
        private readonly object _flowLock = new object();
        // The hello's contents, SNAPSHOT on the game thread.
        //
        // HelloJson runs on the socket's worker thread (RunAsync, straight
        // after ConnectAsync) and used to walk Engine.Flows() and
        // Flow.ListBoxes() from there, while the game thread might be inside
        // OpenFlow mutating the very collection it was enumerating. The result
        // was an InvalidOperationException swallowed by RunAsync's catch, then
        // OnSocketClosed in the finally - so the link died silently at startup,
        // intermittently, in Unity only. The other three ports never read the
        // engine off-thread. Found by the pre-release audit, 2026-08-29.
        //
        // Both lists are written only from SnapshotForHello, called from Attach
        // and SyncFlows, both of which run on the game thread; and read only
        // under _flowLock.
        private List<string> _helloFlowIds = new List<string>();
        private List<string> _helloBoxes = new List<string>();
        // Each open flow's latest board frame, as the game thread last built
        // it: what a reconnect sends after its hello. Under _flowLock.
        private readonly Dictionary<string, string> _boards = new Dictionary<string, string>();

        /// <summary>Open a link to Storyletter at <paramref name="url"/> (default
        /// ws://127.0.0.1:4472). <paramref name="build"/> is the running bundle's
        /// Content.Hash; the editor compares it with its own compiled hash (in sync
        /// / stale). <paramref name="project"/> shows in the editor's connect-icon
        /// tooltip. Connects in the background; a missing editor is a no-op.</summary>
        public StoryletLiveLink(string build, string project = null, string url = DefaultUrl)
            : this(build, project, url, null)
        {
        }

        /// <summary>The test seam: the TestHost replays the shared fixture over a
        /// hand-driven socket. Null means the real worker-thread ClientWebSocket.</summary>
        internal StoryletLiveLink(string build, string project, string url, ILiveLinkSocket socket)
            : this(build, project, url, socket, 1000, 10000, null)
        {
        }

        /// <summary>The TestHost's real-socket check: shorter retry waits, and the
        /// log hook in place before the first dial.</summary>
        internal StoryletLiveLink(string build, string project, string url, ILiveLinkSocket socket,
            int retryFirstMs, int retryMaxMs, Action<string> log)
        {
            _build = build ?? "";
            _project = project;
            _url = string.IsNullOrEmpty(url) ? DefaultUrl : url;
            _retryFirstMs = retryFirstMs;
            _retryMaxMs = retryMaxMs;
            _waitMs = retryFirstMs;
            LogHook = log;
            _socket = socket ?? new ClientWebSocketLink();
            try { _socket.Start(this, _url); }
            catch { _closed = true; } // a malformed URL etc.: never throw into the game
        }

        public string Url => _url;
        public string Build => _build;
        public LiveLinkState State => _closed ? LiveLinkState.Closed : _connected ? LiveLinkState.Connected : LiveLinkState.Connecting;

        /// <summary>Start forwarding this ENGINE's trace: every flow's events,
        /// each frame naming the flow it came from, so the editor can follow one
        /// participant and switch. An earlier engine is detached first. Sends a
        /// board snapshot per open flow straight away, queued behind the hello if
        /// the socket is not open yet.
        ///
        /// Flows are discovered rather than declared: the link diffs
        /// Engine.Flows() whenever anything happens and emits flowOpen /
        /// flowClose itself, so the host has nothing to remember and cannot get
        /// the editor's flow list wrong.</summary>
        public void Attach(Engine engine)
        {
            if (_closed || engine == null) return;
            Detach();
            lock (_flowLock)
            {
                _engine = engine;
                try { _unsubscribe = engine.SubscribeTrace(OnTrace); }
                catch { _engine = null; return; }
                _announced.Clear();
                foreach (var f in engine.Flows()) _announced.Add(f.Id);
            }
            var live = LiveFlows();
            SnapshotForHello(live);
            foreach (var f in live) PostBoard(f);
        }

        /// <summary>Stop forwarding. A refresh replaces the engine, so attach the
        /// new one afterwards.</summary>
        public void Detach()
        {
            lock (_flowLock)
            {
                try { _unsubscribe?.Invoke(); } catch { /* an engine mid-swap */ }
                _unsubscribe = null;
                _engine = null;
                _announced.Clear();
            }
        }

        /// <summary>Refresh what a hello would say. GAME THREAD ONLY: it walks
        /// the engine's own collections, which is exactly what the socket
        /// thread must not do.</summary>
        private void SnapshotForHello(List<Flow> flows)
        {
            var ids = new List<string>();
            foreach (var f in flows) ids.Add(f.Id);
            var boxes = new List<string>();
            if (flows.Count > 0)
            {
                try { foreach (var b in flows[0].ListBoxes()) boxes.Add(b.GameId); }
                catch { /* a flow mid-swap: no boxes */ }
            }
            lock (_flowLock)
            {
                _helloFlowIds = ids;
                _helloBoxes = boxes;
                // A closed flow's board has no place in a reconnect.
                List<string> gone = null;
                foreach (var id in _boards.Keys) if (!ids.Contains(id)) (gone ??= new List<string>()).Add(id);
                if (gone != null) foreach (var id in gone) _boards.Remove(id);
            }
        }

        private List<Flow> LiveFlows()
        {
            Engine e;
            lock (_flowLock) e = _engine;
            try { return e == null ? new List<Flow>() : e.Flows(); }
            catch { return new List<Flow>(); }
        }

        /// <summary>Announce anything that opened or closed since the last look.
        /// Runs before each forwarded event, so a frame never names a flow the
        /// editor has not been told about.</summary>
        private void SyncFlows()
        {
            var now = LiveFlows();
            SnapshotForHello(now);
            var ids = new HashSet<string>();
            foreach (var f in now) ids.Add(f.Id);
            foreach (var f in now)
            {
                bool isNew;
                lock (_flowLock) isNew = _announced.Add(f.Id);
                if (!isNew) continue;
                Post("{\"t\":\"flowOpen\",\"flow\":" + Esc(f.Id) + "}");
                PostBoard(f);
            }
            List<string> gone = new List<string>();
            lock (_flowLock)
            {
                foreach (var id in _announced) if (!ids.Contains(id)) gone.Add(id);
                foreach (var id in gone) _announced.Remove(id);
            }
            foreach (var id in gone) Post("{\"t\":\"flowClose\",\"flow\":" + Esc(id) + "}");
        }

        /// <summary>After applying a pushed bundle: report the build now running
        /// (re-hellos with the new build and a fresh board snapshot, so the editor's
        /// chip goes back to in sync and it stops re-pushing the same bundle).</summary>
        public void SetBuild(string build)
        {
            if (_closed || build == null || build == _build) return;
            _build = build;
            // Re-handshake: the editor re-reads the build, then gets every
            // flow's table as the new engine has it. Before the socket opens
            // (the first, or a retry) the hello it sends on opening already
            // carries the new build.
            if (!_connected) return;
            Post(HelloJson());
            var live = LiveFlows();
            SnapshotForHello(live);
            foreach (var f in live) PostBoard(f);
        }

        /// <summary>Live refresh: drain the next editor message (a raw JSON frame),
        /// if one arrived. Call from your Update() so the swap runs on the main
        /// thread, then hand the frame to <c>StoryletLiveBundle.TryParsePush</c> +
        /// <c>Apply</c>, Attach the flow it returns and report back via SetBuild.</summary>
        public bool TryReceive(out string message) => _inbox.TryDequeue(out message);

        /// <summary>Close the link and stop retrying; every later call is a no-op.</summary>
        public void Close()
        {
            _closed = true;
            Detach();
            while (_outbox.TryDequeue(out _)) { }
            try { _socket.Close(); } catch { /* already gone */ }
        }

        public void Dispose() => Close();

        // -- frames ------------------------------------------------------------------

        private void OnTrace(string flowId, TraceEvent evt)
        {
            try
            {
                SyncFlows();
                // While the editor is away nothing queues, so the trace frame
                // is not even built; the boards below still are, for the
                // reconnect's snapshot.
                if (!(_dropped && !_connected)) Post(TraceJson(flowId, evt));
                if (evt is DealEvent || evt is PlayEvent || evt is DiscardEvent || evt is EvictEvent || evt is TurnsEvent)
                {
                    Engine e;
                    lock (_flowLock) e = _engine;
                    var f = e?.GetFlow(flowId);
                    if (f != null) PostBoard(f);
                }
            }
            catch { /* never into the game */ }
        }

        private void PostBoard(Flow flow)
        {
            if (flow == null) return;
            try
            {
                var json = BoardJson(flow);
                lock (_flowLock) _boards[flow.Id] = json;
                Post(json);
            }
            catch { /* never into the game */ }
        }

        private void Post(string json)
        {
            if (_closed) return;
            // After an attempt has failed the editor is away: nothing queues
            // until a socket is open again, and the hello and boards stand in
            // for what was missed.
            if (_dropped && !_connected) return;
            _outbox.Enqueue(json);
            // A cap for the first connecting window, where queueing is the
            // point: beyond that many, keep the most recent story.
            while (_outbox.Count > QueueCap && _outbox.TryDequeue(out _)) { }
            _socket.Kick();
        }

        /// <summary>The handshake: build, project if given, and the attached
        /// flow's boxes by gameId.</summary>
        internal string HelloJson()
        {
            // Reads the SNAPSHOT, never the engine: this runs on the socket
            // thread. See the note on _helloFlowIds.
            List<string> flowIds;
            List<string> boxes;
            var sb = new StringBuilder();
            sb.Append("{\"t\":\"hello\",\"v\":2,\"build\":").Append(Esc(_build));
            lock (_flowLock)
            {
                flowIds = _helloFlowIds;
                boxes = _helloBoxes;
                // The editor's list starts from the hello, so the diff starts there.
                _announced.Clear();
                foreach (var id in flowIds) _announced.Add(id);
            }
            sb.Append(",\"flows\":[");
            for (int i = 0; i < flowIds.Count; i++)
            {
                if (i > 0) sb.Append(",");
                sb.Append(Esc(flowIds[i]));
            }
            sb.Append("]");
            if (_project != null) sb.Append(",\"project\":").Append(Esc(_project));
            if (boxes.Count > 0)
            {
                sb.Append(",\"boxes\":[");
                for (int i = 0; i < boxes.Count; i++)
                {
                    if (i > 0) sb.Append(",");
                    sb.Append(Esc(boxes[i]));
                }
                sb.Append("]");
            }
            sb.Append("}");
            return sb.ToString();
        }

        /// <summary>The cheap snapshot: hands by gameId holding card gameIds in
        /// dealt order, and every box's clock by gameId.</summary>
        public static string BoardJson(Flow flow)
        {
            var sb = new StringBuilder();
            sb.Append("{\"t\":\"board\",\"flow\":").Append(Esc(flow.Id)).Append(",\"hands\":{");
            bool first = true;
            foreach (var pair in flow.Board())
            {
                if (!first) sb.Append(",");
                first = false;
                sb.Append(Esc(pair.Key)).Append(":[");
                for (int i = 0; i < pair.Value.Count; i++)
                {
                    if (i > 0) sb.Append(",");
                    sb.Append(Esc(pair.Value[i].GameId));
                }
                sb.Append("]");
            }
            sb.Append("},\"turns\":{");
            first = true;
            foreach (var box in flow.ListBoxes())
            {
                if (!first) sb.Append(",");
                first = false;
                sb.Append(Esc(box.GameId)).Append(":").Append(ExprValue.JsNumber(box.Turn));
            }
            sb.Append("}}");
            return sb.ToString();
        }

        /// <summary>One trace frame: the event verbatim, in the reference runtime's
        /// key order (the fixture compares bytes).</summary>
        public static string TraceJson(string flowId, TraceEvent evt)
        {
            var sb = new StringBuilder();
            sb.Append("{\"t\":\"trace\",\"flow\":").Append(Esc(flowId)).Append(",\"event\":");
            AppendEvent(sb, evt);
            sb.Append("}");
            return sb.ToString();
        }

        private static void AppendEvent(StringBuilder sb, TraceEvent evt)
        {
            switch (evt)
            {
                case DealEvent e:
                    sb.Append("{\"type\":\"deal\",\"hand\":").Append(Esc(e.Hand)).Append(",\"cards\":");
                    AppendCards(sb, e.Cards);
                    sb.Append("}");
                    break;
                case PeekEvent e:
                    sb.Append("{\"type\":\"peek\",\"box\":").Append(Esc(e.Box)).Append(",\"criteria\":{");
                    if (e.Criteria != null)
                    {
                        bool first = true;
                        foreach (var pair in e.Criteria)
                        {
                            if (!first) sb.Append(",");
                            first = false;
                            sb.Append(Esc(pair.Key)).Append(":").Append(Esc(pair.Value));
                        }
                    }
                    sb.Append("},\"cards\":");
                    AppendCards(sb, e.Cards);
                    sb.Append("}");
                    break;
                case EvictEvent e:
                    sb.Append("{\"type\":\"evict\",\"hand\":").Append(Esc(e.Hand))
                      .Append(",\"card\":").Append(Esc(e.Card))
                      .Append(",\"reason\":").Append(Esc(e.Reason)).Append("}");
                    break;
                case PlayEvent e:
                    sb.Append("{\"type\":\"play\",\"card\":").Append(Esc(e.Card))
                      .Append(",\"outcome\":").Append(Esc(e.Outcome))
                      .Append(",\"turn\":").Append(ExprValue.JsNumber(e.Turn)).Append("}");
                    break;
                case DiscardEvent e:
                    sb.Append("{\"type\":\"discard\",\"hand\":").Append(Esc(e.Hand))
                      .Append(",\"card\":").Append(Esc(e.Card))
                      .Append(",\"turn\":").Append(ExprValue.JsNumber(e.Turn)).Append("}");
                    break;
                case WriteEvent e:
                    sb.Append("{\"type\":\"write\",\"target\":").Append(Esc(e.Target))
                      .Append(",\"path\":").Append(Esc(e.Path))
                      .Append(",\"value\":").Append(e.Value == null ? "null" : e.Value.ToJsonString());
                    // prev is optional in the reference: absent when there was no prior value.
                    if (e.Prev != null) sb.Append(",\"prev\":").Append(e.Prev.ToJsonString());
                    sb.Append("}");
                    break;
                case TurnsEvent e:
                    sb.Append("{\"type\":\"turns\",\"box\":").Append(Esc(e.Box))
                      .Append(",\"turn\":").Append(ExprValue.JsNumber(e.Turn)).Append("}");
                    break;
                case DiagnosticEvent e:
                    sb.Append("{\"type\":\"diagnostic\",\"where\":").Append(Esc(e.Where))
                      .Append(",\"message\":").Append(Esc(e.Message)).Append("}");
                    break;
                default:
                    sb.Append("null");
                    break;
            }
        }

        private static void AppendCards(StringBuilder sb, List<TraceCard> cards)
        {
            sb.Append("[");
            if (cards != null)
            {
                for (int i = 0; i < cards.Count; i++)
                {
                    var card = cards[i];
                    if (i > 0) sb.Append(",");
                    sb.Append("{\"id\":").Append(Esc(card.Id))
                      .Append(",\"verdict\":").Append(Esc(Flow.VerdictWire(card.Verdict)));
                    if (card.Priority != null) sb.Append(",\"priority\":").Append(ExprValue.JsNumber(card.Priority.Value));
                    if (card.Specificity != null) sb.Append(",\"specificity\":").Append(ExprValue.JsNumber(card.Specificity.Value));
                    sb.Append("}");
                }
            }
            sb.Append("]");
        }

        private static string Esc(string s) => s == null ? "null" : ExprValue.JsonQuote(s);

        // -- the socket side ---------------------------------------------------------
        // Everything here runs on the socket's thread (the worker, or the
        // TestHost's hand), so it reads only the snapshot, never the engine.

        /// <summary>What a socket sends the moment it opens, ahead of the
        /// queue: the hello, and on a reconnect every open flow's board after it
        /// (on the first socket the boards are already queued behind the
        /// hello).</summary>
        internal List<string> HelloFrames()
        {
            var frames = new List<string>();
            // A Post racing the last close may have queued after the drop; stale.
            if (_dropped) while (_outbox.TryDequeue(out _)) { }
            frames.Add(HelloJson());
            if (_dropped)
            {
                lock (_flowLock)
                {
                    foreach (var id in _helloFlowIds)
                    {
                        if (_boards.TryGetValue(id, out var board)) frames.Add(board);
                    }
                }
            }
            return frames;
        }

        /// <summary>The socket is open and its hello has gone: the wait goes back
        /// to the first, and a link that was lost says it is back.</summary>
        internal void OnSocketOpened()
        {
            _waitMs = _retryFirstMs;
            _wasOpen = true;
            _connected = true;
            if (_lost)
            {
                _lost = false;
                Log("[storylets] Live Link is back (" + _url + ").");
            }
        }

        /// <summary>A socket closed, or an attempt never opened (<paramref
        /// name="closeCode"/> is the editor's close code, or -1 for none). Drops
        /// the queue, and answers how long to wait before the next attempt in
        /// milliseconds, or -1 to stop: the game closed the link, or the editor
        /// replaced this game with another.</summary>
        internal int OnSocketClosed(int closeCode)
        {
            _connected = false;
            _dropped = true;
            while (_outbox.TryDequeue(out _)) { }
            if (_closed) return -1;
            if (closeCode == CloseReplaced)
            {
                _closed = true;
                Log("[storylets] Live Link: another game took the editor's link (" + _url + ").");
                return -1;
            }
            if (_wasOpen && !_lost)
            {
                _lost = true;
                Log("[storylets] Live Link lost (" + _url + "); retrying.");
            }
            int wait = _waitMs;
            _waitMs = Math.Min(_waitMs * 2, _retryMaxMs);
            return wait;
        }

        /// <summary>The socket can never connect (an address that does not
        /// parse), or its worker ended: the link is closed.</summary>
        internal void OnSocketStopped()
        {
            _connected = false;
            _closed = true;
            while (_outbox.TryDequeue(out _)) { }
        }

        private void Log(string line)
        {
            try { (LogHook ?? DefaultLog)?.Invoke(line); } catch { /* never into the game */ }
        }
        internal bool TryDequeueOutgoing(out string json) => _outbox.TryDequeue(out json);
        internal void EnqueueIncoming(string json) => _inbox.Enqueue(json);
        internal bool IsClosed => _closed;
    }

    /// <summary>The wire under the link: the real one is a ClientWebSocket on a
    /// worker thread; the TestHost's is hand-driven and records what it is given.
    /// Each time a socket opens it sends the link's HelloFrames() first, then
    /// calls OnSocketOpened and drains TryDequeueOutgoing, and puts every editor
    /// message into EnqueueIncoming. Each time one closes or fails to open it
    /// calls OnSocketClosed with the close code, and waits the answer before the
    /// next attempt (a negative answer stops it).</summary>
    internal interface ILiveLinkSocket
    {
        /// <summary>Connect in the background; never throws past the ctor.</summary>
        void Start(StoryletLiveLink link, string url);
        /// <summary>A frame was queued: the real socket wakes its send loop, the
        /// TestHost's drains the queue there and then. Called from the game
        /// thread, so it must never throw.</summary>
        void Kick();
        /// <summary>The game closed the link: stop, including any wait.</summary>
        void Close();
    }

    /// <summary>Patterplay's PatterDebugLink transport: dial, hello, then send
    /// and receive loops run concurrently on the thread pool until the editor
    /// goes away, then wait and dial again, until the link stops. Two
    /// departures from it: the send loop sleeps until Kick says a frame is
    /// queued, where Patterplay's polls every 15 ms, and the retry policy lives
    /// in the link (OnSocketClosed answers the wait) so the TestHost can drive
    /// it without a socket.</summary>
    internal sealed class ClientWebSocketLink : ILiveLinkSocket
    {
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        // Kick's signal to the send loop: an auto-reset event (count 0 or 1), so
        // any number of frames queued while the loop is busy wake it once, and
        // a Kick that lands between the loop finding the queue empty and its
        // wait leaves the count at 1 and is not lost. Never disposed: a
        // SemaphoreSlim only owns a kernel handle once AvailableWaitHandle is
        // read, which nothing here does, and Kick must stay callable from the
        // game thread after the run has ended. Shared by every attempt: a count
        // left over from the last socket costs one empty pass of the next loop.
        private readonly SemaphoreSlim _queued = new SemaphoreSlim(0, 1);
        private volatile ClientWebSocket _ws;

        public void Start(StoryletLiveLink link, string url)
        {
            _ = RunAsync(link, url, _cts.Token);
        }

        public void Kick()
        {
            try { _queued.Release(); }
            catch { /* SemaphoreFullException: already signalled */ }
        }

        public void Close()
        {
            // Both may already be disposed by a run that ended on its own.
            try { _cts.Cancel(); } catch { /* already disposed */ }
            try { _ws?.Abort(); } catch { /* already gone */ }
        }

        private async Task RunAsync(StoryletLiveLink link, string url, CancellationToken ct)
        {
            byte[] buffer = null; // the receive buffers, made on the first open and kept
            System.IO.MemoryStream frame = null;
            try
            {
                Uri uri;
                try { uri = new Uri(url); }
                catch { return; } // an address that cannot parse is never going to answer
                while (!ct.IsCancellationRequested)
                {
                    var ws = new ClientWebSocket();
                    _ws = ws;
                    try
                    {
                        await ws.ConnectAsync(uri, ct).ConfigureAwait(false);
                        // Handshake first, so the editor can verify the build
                        // before any frame; on a reconnect, the boards after it.
                        foreach (var f in link.HelloFrames()) await SendRaw(ws, f, ct).ConfigureAwait(false);
                        link.OnSocketOpened();
                        if (buffer == null) { buffer = new byte[64 * 1024]; frame = new System.IO.MemoryStream(); }
                        await Task.WhenAll(SendLoop(ws, link, ct), ReceiveLoop(ws, link, buffer, frame, ct)).ConfigureAwait(false);
                    }
                    catch
                    {
                        // Editor not listening / link dropped: tried again below (never throw into the game).
                    }
                    // CloseStatus is set once the editor's Close message arrived (ReceiveLoop returns on it).
                    int code = ws.CloseStatus.HasValue ? (int)ws.CloseStatus.Value : -1;
                    try { ws.Dispose(); } catch { /* already gone */ }
                    int wait = link.OnSocketClosed(code);
                    if (wait < 0 || ct.IsCancellationRequested) return;
                    await Task.Delay(wait, ct).ConfigureAwait(false);
                }
            }
            catch
            {
                // Close() cancelled the wait: stop.
            }
            finally
            {
                link.OnSocketStopped();
                frame?.Dispose();
                // The run owns the token source from here: nothing reads it once
                // the run is over, and Close tolerates finding it disposed.
                _cts.Dispose();
            }
        }

        private async Task SendLoop(ClientWebSocket ws, StoryletLiveLink link, CancellationToken ct)
        {
            try
            {
                while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
                {
                    if (link.TryDequeueOutgoing(out var msg)) await SendRaw(ws, msg, ct).ConfigureAwait(false);
                    else await _queued.WaitAsync(ct).ConfigureAwait(false);
                }
            }
            catch
            {
                // A failed send leaves the receive waiting on a socket that is
                // gone: drop it, so the receive ends too and the run can dial again.
                try { ws.Abort(); } catch { /* already gone */ }
                throw;
            }
        }

        private async Task ReceiveLoop(ClientWebSocket ws, StoryletLiveLink link, byte[] buffer, System.IO.MemoryStream frame, CancellationToken ct)
        {
            // Bytes, not text, until the message ends: a pushed bundle spans many
            // chunks and a chunk boundary can fall inside a multi-byte character.
            frame.SetLength(0);
            try
            {
                while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
                {
                    var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct).ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close) return;
                    if (result.MessageType != WebSocketMessageType.Text) continue;
                    frame.Write(buffer, 0, result.Count);
                    if (!result.EndOfMessage) continue;
                    link.EnqueueIncoming(Encoding.UTF8.GetString(frame.GetBuffer(), 0, (int)frame.Length));
                    frame.SetLength(0);
                }
            }
            finally
            {
                // The editor went away. The send loop may be asleep with nothing
                // queued; wake it so it sees the socket is no longer open and the
                // attempt can end.
                Kick();
            }
        }

        private static async Task SendRaw(ClientWebSocket ws, string json, CancellationToken ct)
        {
            var bytes = Encoding.UTF8.GetBytes(json);
            await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct).ConfigureAwait(false);
        }
    }
}
