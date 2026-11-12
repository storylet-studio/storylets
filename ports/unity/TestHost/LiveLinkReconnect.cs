// The Live Link reconnects (the rule shared with Patter's debug link; the JS
// reference is play-helpers' "the Live Link reconnects until the game closes
// it"). Two halves:
//
// - Driven: the retry policy lives in StoryletLiveLink itself, so a hand-driven
//   FakeLiveLinkSocket opens, drops and fails attempts and reads back the wait
//   the link asks for each time, in place of a clock: 1/2/4/8/10/10 s, back to
//   1 s after a hello, a re-hello with the build and open flows then each
//   flow's board, nothing queued while a retry connects, a stop on close code
//   4000 and on Close().
// - Real socket: ClientWebSocketLink against a loopback WebSocket server, with
//   short waits (100 ms doubling to 400 ms), for the worker's own mechanics:
//   it dials again after the editor closes, says hello again with the boards,
//   reads the 4000 close code off the socket, and Close() ends a waiting retry.
//
// Not a fixture case: this is transport, so the frames are checked by kind and
// content, not byte for byte.

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Newtonsoft.Json.Linq;
using StoryletStudio.StoryletEngine;

namespace StoryletStudio.StoryletEngine.TestHost
{
    internal static class LiveLinkReconnect
    {
        /// <summary>Both halves; the failure messages (empty = pass).</summary>
        public static List<string> Run(string repoRoot)
        {
            var failures = new List<string>();
            var script = JObject.Parse(File.ReadAllText(Path.Combine(repoRoot, "packages", "conformance", "live-link", "script.json")));
            var bundleJson = File.ReadAllText(Path.Combine(repoRoot, script.Value<string>("bundle")));
            Driven(bundleJson, failures);
            RealSocket(bundleJson, failures);
            return failures;
        }

        private static void Check(List<string> failures, string what, bool ok, string detail = null)
        {
            if (!ok) failures.Add(what + (detail == null ? "" : ": " + detail));
        }

        private static string Kind(string frame) => JObject.Parse(frame).Value<string>("t");
        private static string Kinds(IEnumerable<string> frames) => string.Join(",", frames.Select(Kind));

        // -- driven ------------------------------------------------------------------

        private static void Driven(string bundleJson, List<string> failures)
        {
            // A refused link: retried after 1 s doubling to 10 s, connecting
            // throughout, and nothing logged for a link that never opened.
            {
                var log = new List<string>();
                var sock = new FakeLiveLinkSocket();
                var link = new StoryletLiveLink("B1", "Test", StoryletLiveLink.DefaultUrl, sock, 1000, 10000, log.Add);
                var states = new List<LiveLinkState>();
                for (int i = 0; i < 6; i++) { sock.Fail(); states.Add(link.State); }
                Check(failures, "driven: a refused link backs off 1/2/4/8/10/10 s", string.Join(",", sock.Waits) == "1000,2000,4000,8000,10000,10000", string.Join(",", sock.Waits));
                Check(failures, "driven: a refused link reads as connecting, not closed", states.All(s => s == LiveLinkState.Connecting), string.Join(",", states));
                Check(failures, "driven: a link that never opened logs nothing", log.Count == 0, string.Join(" | ", log));
                link.Close();
            }

            // A dropped link: retried, queues nothing while away, then says hello
            // again with the build and open flows, then each flow's board.
            {
                var log = new List<string>();
                var sock = new FakeLiveLinkSocket();
                var link = new StoryletLiveLink("B1", "Test", StoryletLiveLink.DefaultUrl, sock, 1000, 10000, log.Add);
                var engine = new Engine(BundleLoader.Parse(bundleJson), new EngineOptions { Seed = 7 });
                var main = engine.OpenFlow("main");
                engine.OpenFlow("side");
                link.Attach(engine);
                sock.Open();
                main.DealMany();
                int wait = sock.Drop();                                   // the editor quit
                Check(failures, "driven: a dropped link retries after 1 s", wait == 1000, wait.ToString());
                Check(failures, "driven: and reads as connecting", link.State == LiveLinkState.Connecting, link.State.ToString());
                Check(failures, "driven: and logs that it was lost, once", log.Count == 1 && log[0] == "[storylets] Live Link lost (ws://127.0.0.1:4472); retrying.", string.Join(" | ", log));
                wait = sock.Fail();                                       // not back yet
                Check(failures, "driven: a failed retry doubles the wait", wait == 2000, wait.ToString());
                Check(failures, "driven: and logs nothing per attempt", log.Count == 1, string.Join(" | ", log));
                // The game plays on while the editor is away: nothing queues.
                // A flow opened while away reaches the snapshot at the next
                // event (the worker never reads the engine itself).
                engine.OpenFlow("bob");
                main.AdvanceTurns("village", 1);
                link.SetBuild("B2");                                      // a pushed bundle took while it was away
                Check(failures, "driven: nothing is queued while a retry connects", link.QueuedCount == 0, $"{link.QueuedCount} queued");
                int before = sock.Sent.Count;
                sock.Open();
                var again = sock.Sent.Skip(before).ToList();
                Check(failures, "driven: a reconnect sends hello then every open flow's board", Kinds(again) == "hello,board,board,board", Kinds(again));
                if (again.Count == 4)
                {
                    var hello = JObject.Parse(again[0]);
                    Check(failures, "driven: the re-hello carries the current build", hello.Value<string>("build") == "B2", again[0]);
                    var flows = string.Join(",", hello["flows"].Select(f => (string)f));
                    Check(failures, "driven: and the flows open now", flows == "main,side,bob", flows);
                    Check(failures, "driven: and the project", hello.Value<string>("project") == "Test", again[0]);
                    Check(failures, "driven: the main board is the board as it is now", again[1] == StoryletLiveLink.BoardJson(main), again[1]);
                    var boardFlows = string.Join(",", again.Skip(1).Select(b => JObject.Parse(b).Value<string>("flow")));
                    Check(failures, "driven: one board per open flow, in the hello's order", boardFlows == "main,side,bob", boardFlows);
                }
                Check(failures, "driven: reads as connected again", link.State == LiveLinkState.Connected, link.State.ToString());
                Check(failures, "driven: and logs that it is back, once", log.Count == 2 && log[1] == "[storylets] Live Link is back (ws://127.0.0.1:4472).", string.Join(" | ", log));
                // Frames flow again.
                before = sock.Sent.Count;
                main.AdvanceTurns("village", 1);
                var after = sock.Sent.Skip(before).Select(Kind).ToList();
                Check(failures, "driven: frames flow again after a reconnect", after.Count >= 2 && after.First() == "trace" && after.Last() == "board" && after.All(k => k == "trace" || k == "board"), string.Join(",", after));

                // The hello reset the wait: the next close waits 1 s again.
                wait = sock.Drop(1001);
                Check(failures, "driven: a hello puts the wait back to 1 s", wait == 1000, wait.ToString());
                Check(failures, "driven: and the next loss is logged", log.Count == 3 && log[2].Contains("lost"), string.Join(" | ", log));
                sock.Open();

                // Replaced by another game: closed for good, no retry.
                wait = sock.Drop(4000);
                Check(failures, "driven: a replaced link (4000) does not retry", wait < 0, wait.ToString());
                Check(failures, "driven: and reads as closed", link.State == LiveLinkState.Closed, link.State.ToString());
                Check(failures, "driven: and says another game took the link", log.Count == 5 && log[4] == "[storylets] Live Link: another game took the editor's link (ws://127.0.0.1:4472).", string.Join(" | ", log));
                main.AdvanceTurns("village", 1);
                Check(failures, "driven: and queues nothing after", link.QueuedCount == 0, $"{link.QueuedCount} queued");
                link.Close();
            }

            // The first socket keeps its queue: frames raised while it connects
            // go after the hello, and the first hello sends no extra boards (the
            // fixture holds this byte for byte; this is the reconnect's view).
            {
                var sock = new FakeLiveLinkSocket();
                var link = new StoryletLiveLink("B1", "Test", StoryletLiveLink.DefaultUrl, sock, 1000, 10000, _ => { });
                var engine = new Engine(BundleLoader.Parse(bundleJson), new EngineOptions { Seed = 7 });
                engine.OpenFlow("main");
                link.Attach(engine);
                Check(failures, "driven: the first socket queues while it connects", link.QueuedCount == 1, $"{link.QueuedCount} queued");
                sock.Open();
                Check(failures, "driven: and sends hello then the queued board", Kinds(sock.Sent) == "hello,board", Kinds(sock.Sent));
                link.Close();
            }

            // Switched off while retrying: Close() stops it.
            {
                var log = new List<string>();
                var sock = new FakeLiveLinkSocket();
                var link = new StoryletLiveLink("B1", "Test", StoryletLiveLink.DefaultUrl, sock, 1000, 10000, log.Add);
                sock.Fail();
                link.Close();
                Check(failures, "driven: Close() closes the socket and its wait", sock.Closed);
                Check(failures, "driven: and reads as closed", link.State == LiveLinkState.Closed, link.State.ToString());
                int wait = sock.Fail();                                   // an attempt racing the close
                Check(failures, "driven: and schedules no retry after", wait < 0, wait.ToString());
                Check(failures, "driven: and logs nothing", log.Count == 0, string.Join(" | ", log));
            }
        }

        // -- real socket -------------------------------------------------------------

        private static void RealSocket(string bundleJson, List<string> failures)
        {
            var probe = new TcpListener(IPAddress.Loopback, 0);
            probe.Start();
            int port = ((IPEndPoint)probe.LocalEndpoint).Port;
            probe.Stop();
            string url = $"ws://127.0.0.1:{port}";

            // Nothing listening at first: connecting, not closed.
            var log = new ConcurrentQueue<string>();
            var link = new StoryletLiveLink("h1", "proj", url, null, 100, 400, log.Enqueue);
            TcpListener listener = null;
            try
            {
                // Wait for the refused attempt to register rather than for a fixed time: a refused
                // connect took over 150 ms on the play-unity release runner (2026-11-12, twice), and
                // until it fails the hello queues by design. _dropped is the runtime's own record of it.
                var dropped = typeof(StoryletLiveLink).GetField("_dropped", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                Check(failures, "socket: the refused first connect registers", dropped != null && WaitFor(() => (bool)dropped.GetValue(link)), "never dropped");
                Check(failures, "socket: a refused first connect reads as connecting", link.State == LiveLinkState.Connecting, link.State.ToString());

                var engine = new Engine(BundleLoader.Parse(bundleJson), new EngineOptions { Seed = 7 });
                var main = engine.OpenFlow("main");
                link.Attach(engine);
                Check(failures, "socket: and queues nothing while a retry connects", link.QueuedCount == 0, $"{link.QueuedCount} queued");

                // The editor starts: the hello, then the boards (a reconnect, since attempts failed).
                listener = Listen(port);
                var ws = AcceptLink(listener);
                if (ws == null) { failures.Add("socket: the link never connected"); return; }
                var first = ReceiveAll(ws, 2);
                Check(failures, "socket: once the editor is up, hello then the board", Kinds(first) == "hello,board", Kinds(first));
                Check(failures, "socket: and reads as connected", WaitFor(() => link.State == LiveLinkState.Connected), link.State.ToString());
                Check(failures, "socket: a link that never opened logged nothing", log.IsEmpty, string.Join(" | ", log));
                main.DealMany();
                var dealt = ReceiveAll(ws, 1);
                Check(failures, "socket: frames flow", dealt.Count == 1 && Kind(dealt[0]) == "trace", Kinds(dealt));

                // The editor quits and comes back: the same hello with the build now, then the boards.
                listener.Stop();
                CloseFromServer(ws, WebSocketCloseStatus.NormalClosure, "bye");
                Check(failures, "socket: a closed link logs that it was lost", WaitFor(() => log.Any(l => l.Contains("lost"))), string.Join(" | ", log));
                Check(failures, "socket: and reads as connecting", link.State == LiveLinkState.Connecting, link.State.ToString());
                engine.OpenFlow("side");
                main.AdvanceTurns("village", 1);
                link.SetBuild("h2");
                Check(failures, "socket: and queues nothing while away", link.QueuedCount == 0, $"{link.QueuedCount} queued");
                Thread.Sleep(300); // a refused attempt or two
                listener = Listen(port);
                ws = AcceptLink(listener);
                if (ws == null) { failures.Add("socket: the link never reconnected"); return; }
                var again = ReceiveAll(ws, 3);
                Check(failures, "socket: a reconnect sends hello then each flow's board", Kinds(again) == "hello,board,board", Kinds(again));
                if (again.Count == 3)
                {
                    var hello = JObject.Parse(again[0]);
                    var flows = string.Join(",", hello["flows"].Select(f => (string)f));
                    Check(failures, "socket: the re-hello carries the new build and open flows", hello.Value<string>("build") == "h2" && flows == "main,side", again[0]);
                    Check(failures, "socket: the board is as the game thread last raised it", again[1] == StoryletLiveLink.BoardJson(main), again[1]);
                }
                Check(failures, "socket: and logs that it is back", WaitFor(() => log.Any(l => l.Contains("is back"))), string.Join(" | ", log));
                Check(failures, "socket: and reads as connected", WaitFor(() => link.State == LiveLinkState.Connected), link.State.ToString());

                // Replaced by another game: closed for good, no dial.
                CloseFromServer(ws, (WebSocketCloseStatus)StoryletLiveLink.CloseReplaced, "replaced");
                Check(failures, "socket: a replaced link (4000) reads as closed", WaitFor(() => link.State == LiveLinkState.Closed), link.State.ToString());
                Check(failures, "socket: and says another game took the link", log.Any(l => l.Contains("another game took the editor's link")), string.Join(" | ", log));
                Thread.Sleep(500);
                Check(failures, "socket: and does not dial again", !listener.Pending(), "a connection is pending");
            }
            finally
            {
                link.Close();
                listener?.Stop();
            }

            // Switched off while retrying: Close() ends the wait and the run.
            var offLog = new ConcurrentQueue<string>();
            var off = new StoryletLiveLink("h1", "proj", url, null, 100, 400, offLog.Enqueue);
            Thread.Sleep(150);
            Check(failures, "socket: a link with nothing to reach reads as connecting", off.State == LiveLinkState.Connecting, off.State.ToString());
            off.Close();
            var late = Listen(port);
            try
            {
                Thread.Sleep(600);
                Check(failures, "socket: Close() stops the retries", off.State == LiveLinkState.Closed && !late.Pending(), $"{off.State}, pending {late.Pending()}");
            }
            finally { late.Stop(); }
        }

        private static TcpListener Listen(int port)
        {
            var l = new TcpListener(IPAddress.Loopback, port);
            l.Server.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            l.Start();
            return l;
        }

        /// <summary>Accept the link's next connection and finish the WebSocket
        /// handshake (3 s at most).</summary>
        private static WebSocket AcceptLink(TcpListener listener)
        {
            var accept = listener.AcceptTcpClientAsync();
            if (!accept.Wait(TimeSpan.FromSeconds(3))) return null;
            var stream = accept.Result.GetStream();
            string key = ReadHandshakeKey(stream);
            if (key == null) return null;
            string acceptKey;
            using (var sha = SHA1.Create())
            {
                acceptKey = Convert.ToBase64String(sha.ComputeHash(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
            }
            byte[] reply = Encoding.ASCII.GetBytes(
                "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                "Sec-WebSocket-Accept: " + acceptKey + "\r\n\r\n");
            stream.Write(reply, 0, reply.Length);
            return WebSocket.CreateFromStream(stream, isServer: true, subProtocol: null, keepAliveInterval: TimeSpan.FromSeconds(30));
        }

        /// <summary>Read the HTTP upgrade request byte by byte (so nothing past
        /// it is consumed) and return its Sec-WebSocket-Key.</summary>
        private static string ReadHandshakeKey(Stream stream)
        {
            var head = new StringBuilder();
            var one = new byte[1];
            while (!head.ToString().EndsWith("\r\n\r\n"))
            {
                if (stream.Read(one, 0, 1) != 1) return null;
                head.Append((char)one[0]);
                if (head.Length > 8192) return null;
            }
            foreach (var line in head.ToString().Split(new[] { "\r\n" }, StringSplitOptions.None))
            {
                int colon = line.IndexOf(':');
                if (colon > 0 && line.Substring(0, colon).Trim().Equals("Sec-WebSocket-Key", StringComparison.OrdinalIgnoreCase))
                {
                    return line.Substring(colon + 1).Trim();
                }
            }
            return null;
        }

        /// <summary>The next <paramref name="n"/> text messages, or fewer if they
        /// stop coming (2 s for each; a timeout aborts the server's socket, as a
        /// cancelled WebSocket read does, so only ask for frames that are due).</summary>
        private static List<string> ReceiveAll(WebSocket ws, int n)
        {
            var got = new List<string>();
            for (int i = 0; i < n; i++)
            {
                var m = Receive(ws, TimeSpan.FromSeconds(2));
                if (m == null) break;
                got.Add(m);
            }
            return got;
        }

        private static string Receive(WebSocket ws, TimeSpan timeout)
        {
            var buffer = new byte[64 * 1024];
            var frame = new MemoryStream();
            using (var cts = new CancellationTokenSource(timeout))
            {
                try
                {
                    while (true)
                    {
                        var result = ws.ReceiveAsync(new ArraySegment<byte>(buffer), cts.Token).GetAwaiter().GetResult();
                        if (result.MessageType != WebSocketMessageType.Text) return null;
                        frame.Write(buffer, 0, result.Count);
                        if (result.EndOfMessage) return Encoding.UTF8.GetString(frame.ToArray());
                    }
                }
                catch { return null; }
            }
        }

        private static void CloseFromServer(WebSocket ws, WebSocketCloseStatus status, string reason)
        {
            using (var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2)))
            {
                try { ws.CloseOutputAsync(status, reason, cts.Token).GetAwaiter().GetResult(); } catch { /* the link may have gone first */ }
            }
            Thread.Sleep(50); // let the close frame reach the link before the stream goes
            ws.Dispose();
        }

        private static bool WaitFor(Func<bool> cond)
        {
            for (int i = 0; i < 300; i++)
            {
                if (cond()) return true;
                Thread.Sleep(10);
            }
            return cond();
        }
    }
}
