// The Live Link client (design/live-link.md), the socket-free half: the
// frames a game sends Storyletter and the order it sends them in, as the
// reference client does (packages/play-helpers/src/live-link.ts). Std-only,
// like everything under Storylets/: the host owns the WebSocket and feeds
// this class its open / close / message events; this class hands back every
// string to put on the wire through a sink. That split is what lets the
// clang TestHost replay the shared fixture (packages/conformance/live-link/)
// against a recording sink with no engine at all, and it is why the UE
// wrapper (FStoryletLiveLink) is a thin socket owner over this.
//
// Wire protocol `storyletengine/debug@1`, one JSON object per message:
//   hello : {"t":"hello","v":1,"build",project?,boxes?}   on open, and again on setBuild
//   trace : {"t":"trace","event":<TraceEvent, verbatim>}   every event the attached flow emits
//   board : {"t":"board","hands":{hand:[card...]},"turns":{box:n}}
//                                                          after hello, and after every deal /
//                                                          play / evict / turns event
// The frames are compact JSON in the reference's key order, byte for byte
// (the fixture is compared as text): identity by gameId throughout, for hands,
// boxes and cards, on the board frames and on the trace event alike (4.4).
//
// The flow is reached through a provider rather than held, and the host
// forwards trace events itself (onTrace): a wrapper whose flow object
// survives a live-bundle swap (the UE one) keeps one subscription at its own
// level and this class never holds a pointer into a core that may be gone.
#pragma once

#include <functional>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "Storylets/Engine.h"
#include "Storylets/StoryletValue.h"

namespace storylets
{
    /** The default editor address; Patterpad listens on 4471, Storyletter on 4472. */
    constexpr const char* LIVE_LINK_DEFAULT_URL = "ws://127.0.0.1:4472";

    /** The trace kinds that move the board, and so are followed by a snapshot. */
    inline bool LiveLinkMovesBoard(TraceEvent::Kind kind)
    {
        return kind == TraceEvent::Kind::Deal || kind == TraceEvent::Kind::Play
            || kind == TraceEvent::Kind::Discard || kind == TraceEvent::Kind::Evict
            || kind == TraceEvent::Kind::Turns;
    }

    inline const char* TraceKindWire(TraceEvent::Kind kind)
    {
        switch (kind)
        {
            case TraceEvent::Kind::Deal: return "deal";
            case TraceEvent::Kind::Peek: return "peek";
            case TraceEvent::Kind::Evict: return "evict";
            case TraceEvent::Kind::Play: return "play";
            case TraceEvent::Kind::Write: return "write";
            case TraceEvent::Kind::Turns: return "turns";
            case TraceEvent::Kind::Discard: return "discard";
            default: return "diagnostic";
        }
    }

    /** One TraceEvent as the reference serialises it: the same keys in the
     *  same order, optional fields absent (not null) when unset, numbers in
     *  JavaScript's String(n) form. */
    inline std::string TraceEventToJson(const TraceEvent& e)
    {
        const auto q = [](const std::string& s) { return StoryletValue::JsonQuote(s); };
        const auto cards = [&q](const std::vector<TraceCard>& list)
        {
            std::string out = "[";
            for (size_t i = 0; i < list.size(); ++i)
            {
                const TraceCard& c = list[i];
                if (i > 0) out += ",";
                out += "{\"id\":" + q(c.id) + ",\"verdict\":" + q(VerdictWire(c.verdict));
                if (c.priority.has_value()) out += ",\"priority\":" + StoryletValue::JsNumber(*c.priority);
                if (c.specificity.has_value()) out += ",\"specificity\":" + StoryletValue::JsNumber(*c.specificity);
                out += "}";
            }
            return out + "]";
        };
        std::string out = "{\"type\":" + q(TraceKindWire(e.kind));
        switch (e.kind)
        {
            case TraceEvent::Kind::Deal:
                out += ",\"hand\":" + q(e.hand) + ",\"cards\":" + cards(e.cards);
                break;
            case TraceEvent::Kind::Peek:
            {
                out += ",\"box\":" + q(e.box) + ",\"criteria\":{";
                bool first = true;
                for (const auto& pair : e.criteria)
                {
                    if (!first) out += ",";
                    first = false;
                    out += q(pair.first) + ":" + q(pair.second);
                }
                out += "},\"cards\":" + cards(e.cards);
                break;
            }
            case TraceEvent::Kind::Evict:
                out += ",\"hand\":" + q(e.hand) + ",\"card\":" + q(e.card) + ",\"reason\":" + q(e.reason);
                break;
            case TraceEvent::Kind::Play:
                out += ",\"card\":" + q(e.card) + ",\"outcome\":" + q(e.outcome)
                    + ",\"turn\":" + StoryletValue::JsNumber(e.turn);
                break;
            case TraceEvent::Kind::Write:
                out += ",\"target\":" + q(e.target) + ",\"path\":" + q(e.path)
                    + ",\"value\":" + (e.value.has_value() ? e.value->toJsonString() : std::string("null"));
                if (e.prev.has_value()) out += ",\"prev\":" + e.prev->toJsonString();
                break;
            case TraceEvent::Kind::Turns:
                out += ",\"box\":" + q(e.box) + ",\"turn\":" + StoryletValue::JsNumber(e.turn);
                break;
            case TraceEvent::Kind::Discard:
                out += ",\"hand\":" + q(e.hand) + ",\"card\":" + q(e.card)
                    + ",\"turn\":" + StoryletValue::JsNumber(e.turn);
                break;
            default:
                out += ",\"where\":" + q(e.where) + ",\"message\":" + q(e.message);
                break;
        }
        return out + "}";
    }

    /** The cheap snapshot: hands by gameId holding card gameIds in dealt
     *  order, and every box's clock by gameId. */
    inline std::string LiveLinkBoardFrame(const Flow& flow)
    {
        const auto q = [](const std::string& s) { return StoryletValue::JsonQuote(s); };
        std::string out = "{\"t\":\"board\",\"flow\":" + q(flow.id()) + ",\"hands\":{";
        bool first = true;
        for (const auto& pair : flow.board())
        {
            if (!first) out += ",";
            first = false;
            out += q(pair.first) + ":[";
            for (size_t i = 0; i < pair.second.size(); ++i)
            {
                if (i > 0) out += ",";
                out += q(pair.second[i].gameId);
            }
            out += "]";
        }
        out += "},\"turns\":{";
        first = true;
        for (const BoxView& box : flow.listBoxes())
        {
            if (!first) out += ",";
            first = false;
            out += q(box.gameId) + ":" + StoryletValue::JsNumber(box.turn);
        }
        return out + "}}";
    }

    inline std::string LiveLinkTraceFrame(const std::string& flowId, const TraceEvent& event)
    {
        return "{\"t\":\"trace\",\"flow\":" + StoryletValue::JsonQuote(flowId)
            + ",\"event\":" + TraceEventToJson(event) + "}";
    }

    inline std::string LiveLinkFlowFrame(const char* kind, const std::string& flowId)
    {
        return std::string("{\"t\":\"") + kind + "\",\"flow\":" + StoryletValue::JsonQuote(flowId) + "}";
    }

    /** The handshake. `flows` is every open flow, so the editor's list starts
     *  full; `boxes` comes from the first of them (the editor's tooltip);
     *  `project` only when the host named one. Field order follows the JS
     *  reference, because the shared fixture is byte for byte. */
    inline std::string LiveLinkHelloFrame(const std::string& build,
        const std::optional<std::string>& project, const std::vector<FlowPtr>& flows)
    {
        const auto q = [](const std::string& s) { return StoryletValue::JsonQuote(s); };
        std::string out = "{\"t\":\"hello\",\"v\":2,\"build\":" + q(build);
        out += ",\"flows\":[";
        for (size_t i = 0; i < flows.size(); ++i)
        {
            if (i > 0) out += ",";
            out += q(flows[i]->id());
        }
        out += "]";
        if (project.has_value()) out += ",\"project\":" + q(*project);
        const Flow* flow = flows.empty() ? nullptr : flows.front().get();
        if (flow)
        {
            out += ",\"boxes\":[";
            bool first = true;
            for (const BoxView& box : flow->listBoxes())
            {
                if (!first) out += ",";
                first = false;
                out += q(box.gameId);
            }
            out += "]";
        }
        return out + "}";
    }

    /**
     * The client's ordering rules, over a host-owned socket: the hello goes
     * straight to the wire the moment the socket opens (ahead of anything
     * queued while it was connecting), every other frame queues until the
     * socket is open, and nothing here ever throws (a failing sink or a
     * flow mid-swap is swallowed, as the reference swallows them).
     *
     * The host: calls onOpen / onClose from its socket events, attach with a
     * provider that returns the live core flow (or null once it is gone),
     * and onTrace with every event that flow emits. A missing editor is a
     * socket that never opens: frames queue, bounded by kQueueCap, and
     * nothing is sent.
     *
     * It reconnects, by the rule Patter's debug link shares, and the rule
     * lives here so the TestHost can hold it with no socket at all: until the
     * game closes the link, a socket that closes or never opens is tried
     * again. onClose hands back the wait before the next attempt (1 s,
     * doubling to 10 s, back to 1 s once a hello goes), or nothing when there
     * is no next attempt; the host keeps the clock, calls beginAttempt as it
     * dials, then feeds that socket's events in as before. Each new socket
     * says hello again with the build and the open flows, then every flow's
     * board. Frames queue only while the FIRST socket connects: once any
     * attempt has failed or closed, nothing queues until a socket is open, and
     * the queue is dropped on every close. One line goes to the log when an
     * open link is lost and one when it is back; a link that never opened logs
     * nothing. The editor closes a game it replaced (another game connected)
     * with code 4000, and that one stays closed, so two games do not take
     * turns.
     */
    class LiveLinkClient
    {
    public:
        /** How many frames may wait for a socket that is not open. Generous:
         *  the point of queueing is that a game's first moments are not lost
         *  while the editor's socket is still connecting. */
        static constexpr std::size_t kQueueCap = 512;
        /** The close code the editor uses for a game it replaced with another. */
        static constexpr int kCloseReplaced = 4000;
        /** The retry's first wait and its longest, in seconds. */
        static constexpr double kRetryFirst = 1.0;
        static constexpr double kRetryMax = 10.0;

        using Sink = std::function<void(const std::string&)>;
        /** Where the link's few lines go (lost, back, replaced). */
        using Log = std::function<void(const std::string&)>;
        /** The engine to forward, fetched on demand: the wrapper layer's
         *  object can be swapped under us by a live refresh, so the client
         *  holds a getter rather than a pointer. */
        using EngineProvider = std::function<Engine*()>;

        LiveLinkClient(std::string build, std::optional<std::string> project, Sink sink)
            : build_(std::move(build)), project_(std::move(project)), sink_(std::move(sink))
        {
        }

        /** Name the editor's address for the log lines, and where they go.
         *  Without one the link logs nothing. */
        void setLog(std::string url, Log log)
        {
            url_ = std::move(url);
            log_ = std::move(log);
        }

        /** The socket opened: hello first, then the queue, in order. On a
         *  reconnect nothing was queued while the editor was away, so every
         *  flow's board follows the hello (the first socket's boards are
         *  already queued behind it). */
        void onOpen()
        {
            if (closed_) return;
            open_ = true;
            retryPending_ = false;
            wasOpen_ = true;
            if (lost_)
            {
                lost_ = false;
                say("Live Link is back (" + url_ + ").");
            }
            sendHello();
            if (dropped_) for (const FlowPtr& f : liveFlows()) postBoard(*f);
            flush();
        }

        /** The host is dialling a new socket (the first, or a retry). */
        void beginAttempt() { retryPending_ = false; }

        /** The socket closed, or failed to open. `code` is the close code
         *  (kCloseReplaced: the editor replaced this game; anything else,
         *  including none, is retried). The queue is dropped and nothing queues
         *  until a socket is open again. Returns the seconds to wait before the
         *  next attempt, or nothing when there is none: the game closed the
         *  link, the editor replaced it, or this attempt was already counted (a
         *  socket that reports both an error and a close). */
        std::optional<double> onClose(int code = 0)
        {
            open_ = false;
            queue_.clear();
            dropped_ = true;
            if (closed_ || retryPending_) return std::nullopt;
            if (code == kCloseReplaced)
            {
                closed_ = true;
                engine_ = nullptr;
                announced_.clear();
                say("Live Link: another game took the editor's link (" + url_ + ").");
                return std::nullopt;
            }
            if (wasOpen_ && !lost_)
            {
                lost_ = true;
                say("Live Link lost (" + url_ + "); retrying.");
            }
            retryPending_ = true;
            const double wait = wait_;
            wait_ = wait_ * 2 < kRetryMax ? wait_ * 2 : kRetryMax;
            return wait;
        }

        /** Start forwarding an ENGINE: every flow's events, each frame naming
         *  the flow it came from, so the editor can follow one participant and
         *  switch. Posts a board snapshot per open flow straight away, queued
         *  behind the hello if the socket is not open yet.
         *
         *  Flows are discovered rather than declared: the client diffs
         *  engine->flows() whenever anything happens and emits flowOpen /
         *  flowClose itself, so the host has nothing to remember. */
        void attach(EngineProvider provider)
        {
            if (closed_) return;
            engine_ = std::move(provider);
            announced_.clear();
            for (const FlowPtr& f : liveFlows()) announced_.insert(f->id());
            for (const FlowPtr& f : liveFlows()) postBoard(*f);
        }

        /** Stop forwarding. A refresh replaces the engine; attach the new
         *  one afterwards. */
        void detach() { engine_ = nullptr; announced_.clear(); }

        bool attached() const { return static_cast<bool>(engine_); }

        /** A flow emitted an event: forward it verbatim with its flow id, and a
         *  board snapshot after it when it moved that flow's board. */
        void onTrace(const std::string& flowId, const TraceEvent& event)
        {
            if (closed_ || !engine_) return;
            try
            {
                syncFlows();
                post(LiveLinkTraceFrame(flowId, event));
                if (LiveLinkMovesBoard(event.kind))
                {
                    Engine* e = engineOrNull();
                    FlowPtr f = e ? e->getFlow(flowId) : nullptr;
                    if (f) postBoard(*f);
                }
            }
            catch (...) { /* never into the game */ }
        }

        /** After applying a pushed bundle: report the build now running
         *  (re-hello with the new build and a fresh snapshot, so the editor
         *  goes back to in sync and stops re-pushing the same bundle). */
        void setBuild(const std::string& build)
        {
            if (closed_ || build == build_) return;
            build_ = build;
            if (open_)
            {
                sendHello();
                for (const FlowPtr& f : liveFlows()) postBoard(*f);
            }
        }

        /** Close the link and stop retrying; every later call is a no-op. The
         *  host closes the socket itself and drops any retry it scheduled. */
        void close()
        {
            closed_ = true;
            open_ = false;
            engine_ = nullptr;
            announced_.clear();
            queue_.clear();
        }

        bool isOpen() const { return open_; }
        bool isClosed() const { return closed_; }
        const std::string& build() const { return build_; }

        /** "connecting" until a socket opens and while it retries (between
         *  attempts too), "connected" while one is open, "closed" once the
         *  game closed the link or the editor replaced it. */
        const char* state() const
        {
            if (closed_) return "closed";
            return open_ ? "connected" : "connecting";
        }

        /** The wait the next failed attempt will be given, in seconds. */
        double nextWait() const { return wait_; }
        /** How many frames are waiting for a socket. */
        std::size_t queued() const { return queue_.size(); }

    private:
        void send(const std::string& frame)
        {
            try { if (sink_) sink_(frame); } catch (...) { /* socket went away */ }
        }

        void post(std::string frame)
        {
            if (closed_) return;
            // After an attempt has failed, the editor is away: nothing queues
            // until a socket is open again, and the hello and boards stand in
            // for what was missed.
            if (dropped_ && !open_) return;
            queue_.push_back(std::move(frame));
            // BOUNDED, for the first connecting window, where queueing is the
            // point: the hello and the frames a game emits in its first moments
            // have to land. Beyond that many the editor is not coming: drop the
            // oldest, so what survives is the most recent story. Once a socket
            // has closed or failed the queue is dropped outright (onClose).
            if (queue_.size() > kQueueCap)
            {
                queue_.erase(queue_.begin(), queue_.begin() + (queue_.size() - kQueueCap));
            }
            flush();
        }

        void flush()
        {
            if (!open_) return;
            std::vector<std::string> pending;
            pending.swap(queue_);
            for (const std::string& frame : pending) send(frame);
        }

        /** Straight to the wire, never through the queue: it must be the
         *  first thing the editor reads, ahead of anything queued while the
         *  socket was still connecting. */
        Engine* engineOrNull()
        {
            try { return engine_ ? engine_() : nullptr; } catch (...) { return nullptr; }
        }

        std::vector<FlowPtr> liveFlows()
        {
            Engine* e = engineOrNull();
            if (!e) return {};
            try { return e->flows(); } catch (...) { return {}; }
        }

        /** Announce anything that opened or closed since the last look, so a
         *  frame never names a flow the editor has not been told about. */
        void syncFlows()
        {
            const std::vector<FlowPtr> now = liveFlows();
            std::set<std::string> ids;
            for (const FlowPtr& f : now) ids.insert(f->id());
            for (const FlowPtr& f : now)
            {
                if (announced_.count(f->id()) > 0) continue;
                announced_.insert(f->id());
                post(LiveLinkFlowFrame("flowOpen", f->id()));
                postBoard(*f);
            }
            std::vector<std::string> gone;
            for (const std::string& id : announced_) { if (ids.count(id) == 0) gone.push_back(id); }
            for (const std::string& id : gone)
            {
                announced_.erase(id);
                post(LiveLinkFlowFrame("flowClose", id));
            }
        }

        void sendHello()
        {
            const std::vector<FlowPtr> flows = liveFlows();
            std::string hello;
            try { hello = LiveLinkHelloFrame(build_, project_, flows); }
            catch (...) { hello = LiveLinkHelloFrame(build_, project_, {}); }   // mid-swap: no boxes
            // The editor's list starts from the hello, so the diff starts there.
            announced_.clear();
            for (const FlowPtr& f : flows) announced_.insert(f->id());
            send(hello);
            wait_ = kRetryFirst;   // a hello went: the next retry starts from 1 s again
        }

        void say(const std::string& line)
        {
            try { if (log_) log_(line); } catch (...) { /* never into the game */ }
        }

        void postBoard(const Flow& flow)
        {
            try { post(LiveLinkBoardFrame(flow)); } catch (...) { /* never into the game */ }
        }

        std::string build_;
        std::optional<std::string> project_;
        Sink sink_;
        EngineProvider engine_;
        std::set<std::string> announced_;
        std::vector<std::string> queue_;   // frames awaiting an open socket
        std::string url_;
        Log log_;
        double wait_ = kRetryFirst;   // the next retry's wait, in seconds
        bool open_ = false;
        bool closed_ = false;          // closed by the game, or replaced by another (4000)
        bool dropped_ = false;         // an attempt has failed or closed: queue nothing until a socket opens
        bool wasOpen_ = false;         // a socket has been open, so losing it is worth a line
        bool lost_ = false;            // logged as lost, waiting to log it back
        bool retryPending_ = false;    // this attempt has been counted; the next is the host's to dial
    };
}
