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
// Wire protocol (one JSON object per message):
//   hello : { t:"hello", v:2, build, project?, boxes?, flows:[id...] }
//                                                           - on open, and again on SetBuild
//   flowOpen / flowClose : { t:"flowOpen"|"flowClose", flow }
//   trace : { t:"trace", flow, event }                      - every TraceEvent any flow emits
//   board : { t:"board", flow, hands:{ hand: [card...] }, turns:{ box: n } }
//                                                           - after hello, and after every deal /
//                                                             play / evict / turns event
//   bundle: { t:"bundle", v:1, build, data }                - EDITOR -> game: the full .storyletsc JSON
// Identity in frames is by gameId; the trace event is the runtime's own, in
// the reference's key order, so the shared fixture
// (packages/conformance/live-link/) can hold this client byte for byte.
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

namespace StoryletStudio.StoryletEngine
{
    /// <summary>Where the link is, for a debug window: Connecting until the
    /// editor answers, Connected while it does, Closed once it is gone (or was
    /// never there).</summary>
    public enum LiveLinkState { Connecting, Connected, Closed }

    public sealed class StoryletLiveLink : IDisposable
    {
        public const string DefaultUrl = "ws://127.0.0.1:4472";

        private string _build; // mutable: SetBuild() after a live refresh lands
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
        private volatile bool _closed;
        private volatile bool _connected;

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
        {
            _build = build ?? "";
            _project = project;
            _url = string.IsNullOrEmpty(url) ? DefaultUrl : url;
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
            lock (_flowLock) { _helloFlowIds = ids; _helloBoxes = boxes; }
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
            // flow's table as the new engine has it. Before the socket opens the
            // hello it sends on opening already carries the new build.
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

        /// <summary>Close the link; every later call is a no-op.</summary>
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
                Post(TraceJson(flowId, evt));
                if (evt is DealEvent || evt is PlayEvent || evt is EvictEvent || evt is TurnsEvent)
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
            try { Post(BoardJson(flow)); } catch { /* never into the game */ }
        }

        private void Post(string json)
        {
            if (_closed) return;
            _outbox.Enqueue(json);
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
                sb.Append(Esc(box.GameId)).Append(":").Append(StoryletValue.JsNumber(box.Turn));
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
                      .Append(",\"turn\":").Append(StoryletValue.JsNumber(e.Turn)).Append("}");
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
                      .Append(",\"turn\":").Append(StoryletValue.JsNumber(e.Turn)).Append("}");
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
                    if (card.Priority != null) sb.Append(",\"priority\":").Append(StoryletValue.JsNumber(card.Priority.Value));
                    if (card.Specificity != null) sb.Append(",\"specificity\":").Append(StoryletValue.JsNumber(card.Specificity.Value));
                    sb.Append("}");
                }
            }
            sb.Append("]");
        }

        private static string Esc(string s) => s == null ? "null" : StoryletValue.JsonQuote(s);

        // -- the socket side ---------------------------------------------------------

        /// <summary>The socket tells the link it is open (the link answers with
        /// the hello, ahead of the queue) or gone.</summary>
        internal void OnSocketOpened() => _connected = true;
        internal void OnSocketClosed()
        {
            _connected = false;
            _closed = true;
            while (_outbox.TryDequeue(out _)) { }
        }
        internal bool TryDequeueOutgoing(out string json) => _outbox.TryDequeue(out json);
        internal void EnqueueIncoming(string json) => _inbox.Enqueue(json);
        internal bool IsClosed => _closed;
    }

    /// <summary>The wire under the link: the real one is a ClientWebSocket on a
    /// worker thread; the TestHost's is hand-driven and records what it is given.
    /// The socket sends the link's HelloJson() first when it opens, then drains
    /// TryDequeueOutgoing, and puts every editor message into EnqueueIncoming.</summary>
    internal interface ILiveLinkSocket
    {
        /// <summary>Connect in the background; never throws past the ctor.</summary>
        void Start(StoryletLiveLink link, string url);
        /// <summary>A frame was queued (a polling socket ignores this).</summary>
        void Kick();
        void Close();
    }

    /// <summary>Patterplay's PatterDebugLink transport, verbatim: connect, hello,
    /// then send and receive loops run concurrently on the thread pool until the
    /// editor goes away or the link closes.</summary>
    internal sealed class ClientWebSocketLink : ILiveLinkSocket
    {
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private ClientWebSocket _ws;

        public void Start(StoryletLiveLink link, string url)
        {
            _ = RunAsync(link, url, _cts.Token);
        }

        public void Kick() { }

        public void Close()
        {
            try { _cts.Cancel(); } catch { /* already disposed */ }
            try { _ws?.Abort(); } catch { /* already gone */ }
        }

        private async Task RunAsync(StoryletLiveLink link, string url, CancellationToken ct)
        {
            try
            {
                _ws = new ClientWebSocket();
                await _ws.ConnectAsync(new Uri(url), ct).ConfigureAwait(false);
                // Handshake first, so the editor can verify the build before any frame.
                await SendRaw(link.HelloJson(), ct).ConfigureAwait(false);
                link.OnSocketOpened();
                await Task.WhenAll(SendLoop(link, ct), ReceiveLoop(link, ct)).ConfigureAwait(false);
            }
            catch
            {
                // Editor not listening / link closed: go quiet and stop queuing (never throw into the game).
            }
            finally
            {
                link.OnSocketClosed();
            }
        }

        private async Task SendLoop(StoryletLiveLink link, CancellationToken ct)
        {
            while (!ct.IsCancellationRequested && _ws.State == WebSocketState.Open)
            {
                if (link.TryDequeueOutgoing(out var msg)) await SendRaw(msg, ct).ConfigureAwait(false);
                else await Task.Delay(15, ct).ConfigureAwait(false);
            }
        }

        private async Task ReceiveLoop(StoryletLiveLink link, CancellationToken ct)
        {
            var buffer = new byte[64 * 1024];
            // Bytes, not text, until the message ends: a pushed bundle spans many
            // chunks and a chunk boundary can fall inside a multi-byte character.
            var frame = new System.IO.MemoryStream();
            while (!ct.IsCancellationRequested && _ws.State == WebSocketState.Open)
            {
                var result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close) return;
                if (result.MessageType != WebSocketMessageType.Text) continue;
                frame.Write(buffer, 0, result.Count);
                if (!result.EndOfMessage) continue;
                link.EnqueueIncoming(Encoding.UTF8.GetString(frame.GetBuffer(), 0, (int)frame.Length));
                frame.SetLength(0);
            }
        }

        private async Task SendRaw(string json, CancellationToken ct)
        {
            var bytes = Encoding.UTF8.GetBytes(json);
            await _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct).ConfigureAwait(false);
        }
    }
}
