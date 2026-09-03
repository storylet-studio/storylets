// The corpus TestHost: load corpus.json and replay every family through the
// C++ Storylet Engine core, asserting the results the JS reference produces -
// the port's half of the parity contract. Standalone (clang), no Unreal
// needed. The four runner obligations are documented in
// packages/conformance/src/runner.ts and re-implemented here exactly.
//
//   build.sh   (compiles + runs against packages/conformance/corpus.json;
//               the built binary takes an overriding corpus path as argv[1]
//               and, as argv[2], a path to dump the Live Link frames to)
//
// Families: expressions (evaluator + dialect), specificity
// (matched-constraint scorer), peek (bundle + one ask, asked twice), scripted
// (deals, plays, turns, save/load). Plus the Live Link fixture
// (packages/conformance/live-link/, beside the corpus): the frames the client
// must send for a scripted session, replayed through Storylets/LiveLink.h
// against a recording sink (LiveLinkFixture.h).

#include <fstream>
#include <limits>
#include <cmath>
#include <iostream>
#include <memory>
#include <optional>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#include "Storylets/JsonParse.h"
#include "Storylets/Save.h"
// Compiled by nothing else: the state logger is a full parity member in four
// runtimes, and until 2026-08-29 the only build that touched this header was a
// full UE compile - which is how a save-shape change reached it uncaught. The
// cheap gate compiles it now, and runSave gives it one real call.
#include <map>
#include <optional>
#include "Storylets/StateLogger.h"
#include "LiveLinkFixture.h"
#include "Storylets/Bundle.h"
#include "Storylets/DescribeBundle.h"   // the bundle inspector compiles under -Wall -Wextra
#include "Storylets/Dialect.h"
#include "Storylets/Expression.h"
#include "Storylets/Mulberry32.h"
#include "Storylets/ScopeRegistry.h"   // the kernel header compiles under -Wall -Wextra
#include "Storylets/Engine.h"
#include "Storylets/Specificity.h"
#include "Storylets/StoryletValue.h"

using namespace storylets;

static int g_fails = 0;

static void fail(const std::string& family, const std::string& name, const std::string& detail)
{
    ++g_fails;
    std::cerr << "  FAIL [" << family << "] " << name << ": " << detail << "\n";
}

static bool conditionPasses(const StoryletValue& v)
{
    if (v.isBool()) return v.asBool();
    if (v.isNumber()) return v.asNumber() != 0;
    return false;
}

// -- shared plumbing ----------------------------------------------------------

/** The scope bags a bare-AST case evaluates against (owned here so the
 *  EvalContext's non-owning BagScopes stay valid for the case). */
struct ScopesHolder
{
    std::vector<std::unique_ptr<OrderedMap<std::string, StoryletValue>>> bags;
    EvalContext ctx;
};

static ScopesHolder scopesContext(const JsonValue& scopes)
{
    ScopesHolder holder;
    for (const auto& scope : scopes.obj)
    {
        auto bag = std::make_unique<OrderedMap<std::string, StoryletValue>>();
        for (const auto& prop : scope.second.obj)
        {
            bag->set(prop.first, bundleloader::ToValue(prop.second));
        }
        holder.ctx.scopes[scope.first] = std::make_shared<BagScope>(*bag);
        holder.bags.push_back(std::move(bag));
    }
    return holder;
}

static std::vector<std::string> ids(const std::vector<DealtCard>& cards)
{
    std::vector<std::string> out;
    for (const auto& card : cards) out.push_back(card.id);
    return out;
}

static std::vector<std::string> stringList(const JsonValue& token)
{
    std::vector<std::string> out;
    for (const auto& item : token.arr) out.push_back(item.str);
    return out;
}

static std::string show(const std::vector<std::string>& list)
{
    std::string out = "[";
    for (size_t i = 0; i < list.size(); ++i)
    {
        if (i > 0) out += ",";
        out += "\"" + list[i] + "\"";
    }
    return out + "]";
}

/** Direct store writes for setup and setState: story/world are single bags;
 *  box/deck/hand/value are keyed by immutable id. */
static void applyState(Flow& session, const JsonValue& selector)
{
    for (const char* scope : {"story", "world"})
    {
        const JsonValue* bag = selector.find(scope);
        if (!bag || !bag->isObject()) continue;
        for (const auto& prop : bag->obj)
        {
            session.setProperty(std::string(scope) + "." + prop.first, bundleloader::ToValue(prop.second));
        }
    }
    for (const char* kind : {"box", "deck", "hand", "value"})
    {
        const JsonValue* byId = selector.find(kind);
        if (!byId || !byId->isObject()) continue;
        for (const auto& entry : byId->obj)
        {
            for (const auto& prop : entry.second.obj)
            {
                session.setProperty(std::string(kind) + "." + entry.first + "." + prop.first,
                    bundleloader::ToValue(prop.second));
            }
        }
    }
}

/** "turn.<boxId>" reads that box's clock (schema 3.4); everything else is a
 *  property path. */
static StoryletValue readState(Flow& session, const std::string& path)
{
    const std::string prefix = "turn.";
    return path.rfind(prefix, 0) == 0
        ? StoryletValue::Num(session.turn(path.substr(prefix.size())))
        : session.getProperty(path);
}

static OrderedMap<std::string, std::string> criteriaOf(const JsonValue& op)
{
    return bundleloader::ToStringMap(op.find("criteria"));
}

static std::optional<int> peekCap(const JsonValue& op)
{
    const JsonValue* n = op.find("n");
    if (!n || !n->isNumber()) return std::nullopt;
    return static_cast<int>(n->num);
}

// -- expressions ----------------------------------------------------------------

static int runExpressions(const JsonValue& cases)
{
    int pass = 0;
    for (const auto& c : cases.arr)
    {
        std::string name = c.strOr("name");
        bool expectError = c.boolOr("expectError");
        try
        {
            AstPtr node = DeserialiseAst(c.at("ast"));
            ScopesHolder holder = scopesContext(c.at("scopes"));
            // The reference runner always supplies a PRNG (seed ?? 0).
            Mulberry32 prng(c.numOr("seed", 0));
            StoryletsHost host;
            host.nextRandom = [&prng]() { return prng.next(); };
            holder.ctx.host = &host;

            std::optional<StoryletValue> actual;
            std::optional<std::string> error;
            try
            {
                actual = Evaluate(node, holder.ctx, StoryletsDialect());
            }
            catch (const std::exception& ex)
            {
                error = ex.what();
            }

            if (expectError)
            {
                if (error.has_value()) ++pass;
                else fail("expressions", name, "expected an eval error, got " + actual->toJsonString());
            }
            else if (error.has_value())
            {
                fail("expressions", name, "unexpected error: " + *error);
            }
            else
            {
                StoryletValue expected = bundleloader::ToValue(c.at("expected"));
                if (actual->valueEquals(expected)) ++pass;
                else fail("expressions", name, "expected " + expected.toJsonString() + ", got " + actual->toJsonString());
            }
        }
        catch (const std::exception& ex)
        {
            fail("expressions", name, ex.what());
        }
    }
    return pass;
}

// -- specificity ------------------------------------------------------------------

static int runSpecificity(const JsonValue& cases)
{
    int pass = 0;
    for (const auto& c : cases.arr)
    {
        std::string name = c.strOr("name");
        try
        {
            AstPtr node = DeserialiseAst(c.at("ast"));
            ScopesHolder holder = scopesContext(c.at("scopes"));
            int actual = MatchedSpecificity(node, [&holder](const AstPtr& n)
            {
                try
                {
                    return conditionPasses(Evaluate(n, holder.ctx, StoryletsDialect()));
                }
                catch (const std::exception&)
                {
                    return false;
                }
            });
            int expected = static_cast<int>(c.numOr("expected", 0));
            if (actual == expected) ++pass;
            else fail("specificity", name, "expected " + std::to_string(expected) + ", got " + std::to_string(actual));
        }
        catch (const std::exception& ex)
        {
            fail("specificity", name, ex.what());
        }
    }
    return pass;
}

// -- peek --------------------------------------------------------------------------

/** Build a session, apply setup, peek, check the ordered list - then peek
 *  AGAIN and require the identical list: a peek registers nothing and asking
 *  twice is free (schema 3.5). */
static int runPeek(const JsonValue& cases)
{
    int pass = 0;
    for (const auto& c : cases.arr)
    {
        std::string name = c.strOr("name");
        try
        {
            BundlePtr bundle = ParseBundle(c.at("bundle"));
            EngineOptions opts;
            opts.seed = c.numOr("seed", 0);
            Engine engine(bundle, opts);
            Flow& session = *engine.openFlow("main");
            const JsonValue* setup = c.find("setup");
            if (setup && setup->isObject()) applyState(session, *setup);
            std::string box = c.strOr("box");
            OrderedMap<std::string, std::string> criteria = criteriaOf(c);
            std::optional<int> n = peekCap(c);
            std::vector<std::string> expect = stringList(c.at("expect"));

            std::vector<std::string> failures;
            std::vector<std::string> first = ids(session.peek(box, criteria, n).cards);
            if (first != expect)
            {
                failures.push_back("peek: expected " + show(expect) + ", got " + show(first));
            }
            std::vector<std::string> second = ids(session.peek(box, criteria, n).cards);
            if (second != first)
            {
                failures.push_back("second peek diverged (a peek must register nothing): "
                    + show(first) + " then " + show(second));
            }

            if (failures.empty()) ++pass;
            else for (const auto& f : failures) fail("peek", name, f);
        }
        catch (const std::exception& ex)
        {
            fail("peek", name, ex.what());
        }
    }
    return pass;
}

// -- scripted -----------------------------------------------------------------------

/** Hand id -> gameId (the board keys by gameId; scripts speak ids). */
static std::unordered_map<std::string, std::string> handGameIds(const Bundle& bundle)
{
    std::unordered_map<std::string, std::string> names;
    for (const auto& box : bundle.boxes)
    {
        for (const auto& hand : box.hands) names[hand.id] = EffectiveGameId(hand);
    }
    return names;
}

static std::string mapped(const std::unordered_map<std::string, std::string>& names, const std::string& id)
{
    auto it = names.find(id);
    return it != names.end() ? it->second : id;
}

/** Execute the ops in order; every expect must match exactly, expectError ops
 *  must fail without side effects. */
static std::vector<std::string> runScriptedCase(const JsonValue& c)
{
    std::vector<std::string> failures;
    BundlePtr bundle = ParseBundle(c.at("bundle"));
    const JsonValue* bundleBJson = c.find("bundleB");
    BundlePtr bundleB = bundleBJson && bundleBJson->isObject() ? ParseBundle(*bundleBJson) : nullptr;
    double seed = c.numOr("seed", 0);
    EngineOptions opts;
    opts.seed = seed;
    auto engine = std::make_unique<Engine>(bundle, opts);
    // Flow handles as the SCRIPT knows them: kept across closeFlow so a
    // later op on a closed name exercises the inert handle, never a quiet
    // re-open.
    std::unordered_map<std::string, FlowPtr> handles;
    // Verdicts from the deal or peek an op just ran, card id -> verdict, taken
    // from the trace because that is the only place the REASON lives: a board
    // read says a card is absent, never why, and "claimed" against
    // "claimed-elsewhere" is exactly the distinction it cannot make. A deal
    // fires one event per hand, so the sink accumulates across them;
    // subscribing is also what switches tracing on.
    std::unordered_map<std::string, std::string> verdicts;
    auto flowOf = [&](const JsonValue& op) -> Flow&
    {
        std::string flowName = op.strOr("flow");
        if (flowName.empty()) flowName = "main";
        auto it = handles.find(flowName);
        if (it == handles.end())
        {
            it = handles.emplace(flowName, engine->openFlow(flowName)).first;
            it->second->subscribeTrace([&verdicts](const TraceEvent& e)
            {
                if (e.kind != TraceEvent::Kind::Deal && e.kind != TraceEvent::Kind::Peek) return;
                for (const auto& card : e.cards) verdicts[card.id] = VerdictWire(card.verdict);
            });
        }
        return *it->second;
    };
    auto checkVerdicts = [&](const std::string& at, const JsonValue& op)
    {
        const JsonValue* expected = op.find("expectVerdicts");
        if (!expected || !expected->isObject()) return;
        for (const auto& pair : expected->obj)
        {
            const std::string want = pair.second.str;
            auto it = verdicts.find(pair.first);
            const std::string got = it == verdicts.end() ? std::string() : it->second;
            if (got != want)
            {
                failures.push_back(at + ": verdict for " + pair.first + " expected \"" + want
                    + "\", got " + (got.empty() ? "no verdict" : "\"" + got + "\""));
            }
        }
    };
    std::unordered_map<std::string, std::string> names = handGameIds(*bundle);

    const JsonValue& script = c.at("script");
    for (size_t index = 0; index < script.arr.size(); ++index)
    {
        const JsonValue& op = script.arr[index];
        std::string kind = op.strOr("op");
        std::string at = "op " + std::to_string(index) + " (" + kind + ")";
        Flow& sessionRef = flowOf(op);
        Flow* session = &sessionRef;
        if (kind == "setState")
        {
            applyState(*session, op);
        }
        else if (kind == "peek")
        {
            std::vector<std::string> actual;
            std::optional<std::string> peekError;
            verdicts.clear();
            try
            {
                RankedList list = session->peek(op.strOr("box", "box"), criteriaOf(op), peekCap(op));
                actual = ids(list.cards);
            }
            catch (const std::exception& ex)
            {
                peekError = ex.what();
            }
            checkVerdicts(at, op);
            bool expectPeekError = op.boolOr("expectError");
            if (expectPeekError && !peekError.has_value())
            {
                failures.push_back(at + ": expected an error, peek returned " + show(actual));
            }
            if (!expectPeekError && peekError.has_value())
            {
                failures.push_back(at + ": unexpected error: " + *peekError);
            }
            const JsonValue* expect = op.find("expect");
            if (expect && expect->isArray() && !peekError.has_value())
            {
                std::vector<std::string> expected = stringList(*expect);
                if (actual != expected)
                {
                    failures.push_back(at + ": expected " + show(expected) + ", got " + show(actual));
                }
            }
        }
        else if (kind == "deal")
        {
            const JsonValue* hands = op.find("hands");
            std::optional<std::vector<std::string>> handRefs;
            if (hands && hands->isArray()) handRefs = stringList(*hands);
            verdicts.clear();
            OrderedMap<std::string, std::vector<DealtCard>> dealt = session->dealMany(handRefs);
            checkVerdicts(at, op);
            const JsonValue* expectBoard = op.find("expectBoard");
            if (expectBoard && expectBoard->isObject())
            {
                for (const auto& pair : expectBoard->obj)
                {
                    OrderedMap<std::string, std::vector<DealtCard>> board = session->board();
                    std::string key = mapped(names, pair.first);
                    std::vector<std::string> actual = ids(board.getOr(key, {}));
                    std::vector<std::string> expected = stringList(pair.second);
                    if (actual != expected)
                    {
                        failures.push_back(at + ": board[" + pair.first + "] expected "
                            + show(expected) + ", got " + show(actual));
                    }
                }
            }
            const JsonValue* expectDealt = op.find("expectDealt");
            if (expectDealt && expectDealt->isObject())
            {
                // The dealt slice holds exactly the hands this call dealt: the
                // key set must match, not merely include.
                std::vector<std::string> expectedKeys;
                for (const auto& pair : expectDealt->obj) expectedKeys.push_back(mapped(names, pair.first));
                std::sort(expectedKeys.begin(), expectedKeys.end());
                std::vector<std::string> actualKeys = dealt.keys();
                std::sort(actualKeys.begin(), actualKeys.end());
                if (actualKeys != expectedKeys)
                {
                    failures.push_back(at + ": dealt hands expected " + show(expectedKeys)
                        + ", got " + show(actualKeys));
                }
                for (const auto& pair : expectDealt->obj)
                {
                    std::string key = mapped(names, pair.first);
                    std::vector<std::string> actual = ids(dealt.getOr(key, {}));
                    std::vector<std::string> expected = stringList(pair.second);
                    if (actual != expected)
                    {
                        failures.push_back(at + ": dealt[" + pair.first + "] expected "
                            + show(expected) + ", got " + show(actual));
                    }
                }
            }
        }
        else if (kind == "assertBoard")
        {
            std::string boxRef = op.strOr("box");
            OrderedMap<std::string, std::vector<DealtCard>> board;
            std::optional<std::string> boardError;
            try
            {
                board = boxRef.empty() ? session->board() : session->board(boxRef);
            }
            catch (const std::exception& ex)
            {
                boardError = ex.what();
            }
            bool expectBoardError = op.boolOr("expectError");
            if (expectBoardError && !boardError.has_value())
            {
                failures.push_back(at + ": expected an error, board returned " + show(board.keys()));
            }
            if (!expectBoardError && boardError.has_value())
            {
                failures.push_back(at + ": unexpected error: " + *boardError);
            }
            const JsonValue* expectHands = op.find("expect");
            if (expectHands && expectHands->isObject() && !boardError.has_value())
            {
                // The filtered board holds exactly the hands of that box: the
                // key set must match, not merely include.
                std::vector<std::string> expectedKeys;
                for (const auto& pair : expectHands->obj) expectedKeys.push_back(mapped(names, pair.first));
                std::sort(expectedKeys.begin(), expectedKeys.end());
                std::vector<std::string> actualKeys = board.keys();
                std::sort(actualKeys.begin(), actualKeys.end());
                if (actualKeys != expectedKeys)
                {
                    failures.push_back(at + ": board hands expected " + show(expectedKeys)
                        + ", got " + show(actualKeys));
                }
                for (const auto& pair : expectHands->obj)
                {
                    std::string key = mapped(names, pair.first);
                    std::vector<std::string> actual = ids(board.getOr(key, {}));
                    std::vector<std::string> expected = stringList(pair.second);
                    if (actual != expected)
                    {
                        failures.push_back(at + ": board[" + pair.first + "] expected "
                            + show(expected) + ", got " + show(actual));
                    }
                }
            }
        }
        else if (kind == "play")
        {
            bool expectError = op.boolOr("expectError");
            std::optional<std::string> error;
            try
            {
                PlayOptions playOpts;
                const JsonValue* advance = op.find("advanceTurns");
                if (advance && advance->isNumber()) playOpts.advanceTurns = advance->num;
                session->play(op.strOr("card"), op.strOr("outcome"), op.strOr("from"), playOpts);
            }
            catch (const std::exception& ex)
            {
                error = ex.what();
            }
            if (expectError && !error.has_value())
            {
                failures.push_back(at + ": expected an error, play succeeded");
            }
            if (!expectError && error.has_value())
            {
                failures.push_back(at + ": unexpected error: " + *error);
            }
        }
        else if (kind == "advanceTurns")
        {
            session->advanceTurns(op.strOr("box"), op.numOr("n", 1));
        }
        else if (kind == "assertOutcomes")
        {
            const JsonValue& expect = op.at("expect");
            std::vector<OutcomeView> views = session->outcomes(op.strOr("card"), op.strOr("from"));
            for (const auto& pair : expect.obj)
            {
                bool actual = false;
                for (const auto& v : views)
                {
                    if (v.gameId == pair.first)
                    {
                        actual = v.available;
                        break;
                    }
                }
                bool expected = pair.second.b;
                if (actual != expected)
                {
                    failures.push_back(at + ": " + pair.first + " expected "
                        + (expected ? "true" : "false") + ", got " + (actual ? "true" : "false"));
                }
            }
        }
        else if (kind == "assertOutcomeOrder")
        {
            // The order outcomes come back in: the bundle carries the author's
            // order, not id order, and that order is the player's menu.
            const std::vector<std::string> want = stringList(op.at("expect"));
            std::vector<std::string> got;
            for (const auto& v : session->outcomes(op.strOr("card"), op.strOr("from"))) got.push_back(v.gameId);
            if (want != got)
            {
                std::string w, g;
                for (size_t i = 0; i < want.size(); i++) w += (i ? ", " : "") + want[i];
                for (size_t i = 0; i < got.size(); i++) g += (i ? ", " : "") + got[i];
                failures.push_back(at + ": expected [" + w + "], got [" + g + "]");
            }
        }
        else if (kind == "assertState")
        {
            for (const auto& pair : op.at("expect").obj)
            {
                std::optional<StoryletValue> actual;
                std::optional<std::string> error;
                try
                {
                    actual = readState(*session, pair.first);
                }
                catch (const std::exception& ex)
                {
                    error = ex.what();
                }
                StoryletValue expected = bundleloader::ToValue(pair.second);
                if (error.has_value() || !actual->valueEquals(expected))
                {
                    failures.push_back(at + ": " + pair.first + " expected " + expected.toJsonString()
                        + ", got " + (error.has_value() ? *error : actual->toJsonString()));
                }
            }
        }
        else if (kind == "openFlow")
        {
            OpenFlowOptions flowOpts;
            const JsonValue* flowSeed = op.find("seed");
            if (flowSeed && flowSeed->isNumber()) flowOpts.seed = flowSeed->num;
            handles[op.strOr("flow")] = engine->openFlow(op.strOr("flow"), flowOpts);
        }
        else if (kind == "closeFlow")
        {
            engine->closeFlow(op.strOr("flow"));
        }
        else if (kind == "assertFlows")
        {
            // Order is a contract: saveGame keys its flows in it, so two
            // runtimes that disagree write different .storyletsave bytes.
            std::vector<std::string> liveIds;
            for (const auto& f : engine->flows()) liveIds.push_back(f->id());
            const JsonValue* want = op.find("expect");
            std::vector<std::string> wantIds = want ? stringList(*want) : std::vector<std::string>();
            if (show(liveIds) != show(wantIds))
            {
                failures.push_back(at + ": flows are " + show(liveIds) + ", expected " + show(wantIds));
            }
        }
        else if (kind == "assertEngineRead")
        {
            // Engine-level read: world.* and shared refs answer; a per-flow
            // ref must THROW (the teaching rule).
            std::string path = op.strOr("path");
            std::optional<StoryletValue> engineValue;
            std::optional<std::string> readError;
            try { engineValue = engine->getProperty(path); }
            catch (const StoryletError& e) { readError = e.what(); }
            bool expectReadError = op.boolOr("expectError", false);
            if (expectReadError && !readError.has_value())
            {
                failures.push_back(at + ": expected an error, engine read of " + path
                    + " returned " + engineValue->toJsonString());
            }
            if (!expectReadError && readError.has_value())
            {
                failures.push_back(at + ": unexpected error: " + *readError);
            }
            const JsonValue* expect = op.find("expect");
            if (expect && !readError.has_value())
            {
                StoryletValue expected = bundleloader::ToValue(*expect);
                if (!engineValue.has_value() || !engineValue->valueEquals(expected))
                {
                    failures.push_back(at + ": " + path + " expected " + expected.toJsonString()
                        + ", got " + (engineValue.has_value() ? engineValue->toJsonString() : "<none>"));
                }
            }
        }
        else if (kind == "saveLoad")
        {
            // Serialise the WHOLE engine, discard it, restore into a fresh
            // one (semantic parity, not byte parity). into: "B" restores into
            // the case's EDITED bundle: the drifted-content contract.
            // loadGame rebuilds every flow, so the script's handles are
            // re-taken.
            SaveEnvelope envelope = engine->saveGame();
            BundlePtr into = op.strOr("into") == "B" ? bundleB : bundle;
            engine = std::make_unique<Engine>(into, opts);
            engine->loadGame(envelope);
            handles.clear();
            for (const FlowPtr& f : engine->flows()) handles[f->id()] = f;
        }
        else if (kind == "reset")
        {
            engine = std::make_unique<Engine>(bundle, opts);
            handles.clear();
        }
        else
        {
            failures.push_back(at + ": unknown op");
        }
    }
    return failures;
}

// Read-only @world with a HOST resolver bound (Reboot.md 10). The corpus case of
// this name pins the self-backed path, where @world is the engine's stand-in bag,
// the shared kernel, which keeps `writable` for every caller. A game that binds
// its own resolver takes the engine's writes straight, and only the engine's own
// check stands between a story and the host: this is the one place that check is
// exercised. Same probe in the JS, C# and Godot harnesses.
static std::vector<std::string> runReadOnlyWorldProbe(const JsonValue& c)
{
    std::vector<std::string> failures;
    std::map<std::string, StoryletValue> vals{{"clock", StoryletValue::Num(0)}, {"mood", StoryletValue::Num(0)}};
    std::vector<std::string> sets;
    WorldResolver world;
    world.get = [&](const std::string& n) -> std::optional<StoryletValue> {
        auto it = vals.find(n); if (it == vals.end()) return std::nullopt; return it->second; };
    world.set = [&](const std::string& n, const StoryletValue& v) { sets.push_back(n); vals[n] = v; };
    EngineOptions opts; opts.world = world;
    BundlePtr bundle = ParseBundle(c.at("bundle"));
    Engine engine(bundle, opts);
    Flow& flow = *engine.openFlow("main");
    flow.deal("h_q");
    try { flow.play("c_tick", "tick", "h_q"); failures.push_back("bound-world probe: the story wrote a read-only @world value and was not refused"); }
    catch (const StoryletError& ex) { if (std::string(ex.what()).find("is read-only") == std::string::npos) failures.push_back(std::string("bound-world probe: refused, but not as read-only: ") + ex.what()); }
    if (!sets.empty()) failures.push_back("bound-world probe: the host's set was called for a read-only write");
    try { flow.play("c_cheer", "cheer", "h_q"); }
    catch (const StoryletError& ex) { failures.push_back(std::string("bound-world probe: a writable property was refused: ") + ex.what()); }
    if (sets.size() != 1 || sets[0] != "mood") failures.push_back("bound-world probe: expected the host's set once, for mood; got " + std::to_string(sets.size()));
    return failures;
}

static int runScripted(const JsonValue& cases)
{
    int pass = 0;
    for (const auto& c : cases.arr)
    {
        std::string name = c.strOr("name");
        try
        {
            std::vector<std::string> failures = runScriptedCase(c);
            if (name.rfind("an outcome may not write a read-only", 0) == 0)
            {
                std::vector<std::string> extra = runReadOnlyWorldProbe(c);
                failures.insert(failures.end(), extra.begin(), extra.end());
            }
            if (failures.empty()) ++pass;
            else for (const auto& f : failures) fail("scripted", name, f);
        }
        catch (const std::exception& ex)
        {
            fail("scripted", name, ex.what());
        }
    }
    return pass;
}

// -- the bundle inspector (design/engine-runtimes.md 2, piece 6) ---------------------
//
// describeBundle is a bundle-level API with no corpus family of its own (it
// reports the bundle's declared shape, not dealing behaviour). This check holds
// it to the one contract that could silently drift: the criteria surface it
// advertises must be the criteria peek() accepts, and its property scopes must
// be the static twin of the session's listProperties() - same names, same
// order. Run over the first peek case's bundle.

/** The .storyletsave string boundary, over the FIRST peek case's bundle: the
 *  core writes a file, a fresh engine reads it back, and the second write must
 *  be byte-identical. This can only be checked here now that serializeState /
 *  deserializeState live in the pure core (Storylets/Save.h); while they were
 *  UE-only, nothing outside an Unreal build ever exercised them. Also pins the
 *  two refusals (foreign schema, malformed text) and that @world rides the
 *  FILE, never the envelope. */
static int runSave(const JsonValue& cases)
{
    if (cases.arr.empty()) return 0;
    const std::string name = cases.arr.front().strOr("name");
    try
    {
        BundlePtr bundle = ParseBundle(cases.arr.front().at("bundle"));

        // onReplacedFlow (parity with the JS runtime's): openFlow on an id that
        // exists REPLACES it, and the hook says so when the old flow still held a
        // dealt hand - the trap a host falls into calling openFlow instead of
        // getFlow after loadGame. The corpus never exercises the hook, so it runs
        // here, on this bundle, beside the save path it exists to protect.
        {
            std::vector<std::pair<std::string, int>> hits;
            EngineOptions hooked;
            hooked.onReplacedFlow = [&](const std::string& id, int n) { hits.emplace_back(id, n); };
            Engine probe(bundle, hooked);
            Flow& first = *probe.openFlow("main");
            int held = 0;
            for (const auto& hand : first.dealMany()) held += static_cast<int>(hand.second.size());
            probe.openFlow("main");
            if (held > 0 && (hits.size() != 1 || hits[0].first != "main" || hits[0].second != held))
                fail("save", "onReplacedFlow", "expected one call (main, " + std::to_string(held) + "), got " + std::to_string(hits.size()));
            if (held == 0 && !hits.empty())
                fail("save", "onReplacedFlow", "fired for a flow holding nothing");
            probe.openFlow("main");   // replacing an EMPTY flow is routine: no call
            if (hits.size() > 1) fail("save", "onReplacedFlow", "fired again for an empty flow");
        }

        Engine engine(bundle, EngineOptions{});
        Flow& flow = *engine.openFlow("main");
        flow.dealMany();

        OrderedMap<std::string, StoryletValue> world;
        for (const PropertyRow& row : engine.listProperties())
        {
            if (row.path.rfind("world.", 0) == 0) world.set(row.name, row.value);
        }
        const std::string text = serializeState(engine, world);

        Engine restored(bundle, EngineOptions{});
        OrderedMap<std::string, StoryletValue> back = deserializeState(restored, text);
        for (const auto& pair : back)
        {
            try { restored.setProperty("world." + pair.first, pair.second); }
            catch (const std::exception&) { /* orphaned key */ }
        }
        OrderedMap<std::string, StoryletValue> reworld;
        for (const PropertyRow& row : restored.listProperties())
        {
            if (row.path.rfind("world.", 0) == 0) reworld.set(row.name, row.value);
        }
        if (serializeState(restored, reworld) != text)
        {
            fail("save", name, "round trip is not identical");
        }
        if (!restored.getFlow("main"))
        {
            fail("save", name, "the load did not rebuild the \"main\" flow");
        }

        // The state logger reads the save's shape, so it belongs on this path:
        // a snapshot must name the shared story properties by their flat paths.
        {
            Flow& reflow = *restored.getFlow("main");
            StateSnapshot snap = snapshotState(restored, reflow);
            bool sawStory = false;
            for (const auto& pair : snap)
            {
                if (pair.first.rfind("story.", 0) == 0) { sawStory = true; break; }
            }
            if (!sawStory) fail("save", name, "the state logger's snapshot carried no story paths");
        }

        // The ENVELOPE never carries @world: strip the file's world half and
        // the restored engine falls back to the declared defaults.
        bool refusedForeign = false;
        Engine other(bundle, EngineOptions{});
        try { deserializeState(other, std::string("{\"schema\":\"patter/save@0\"}")); }
        catch (const StoryletError&) { refusedForeign = true; }
        if (!refusedForeign) fail("save", name, "a foreign file was accepted");

        bool refusedGarbage = false;
        try { deserializeState(other, std::string("{ nope")); }
        catch (const StoryletError&) { refusedGarbage = true; }
        if (!refusedGarbage) fail("save", name, "malformed text was accepted");
        return 1;
    }
    catch (const std::exception& ex)
    {
        fail("save", name, ex.what());
        return 0;
    }
}

static int runDescribe(const JsonValue& cases)
{
    if (cases.arr.empty()) return 0;
    const JsonValue& c = cases.arr.front();
    std::string name = "describeBundle over " + c.strOr("name");
    try
    {
        BundlePtr bundle = ParseBundle(c.at("bundle"));
        BundleDescription d = describeBundle(*bundle);
        Engine engine(bundle, EngineOptions{});
        Flow& session = *engine.openFlow("main");

        if (d.identity.schema != BUNDLE_SCHEMA)
        {
            fail("describe", name, "identity.schema is " + d.identity.schema);
        }
        if (static_cast<size_t>(d.totals.boxes) != bundle->boxes.size())
        {
            fail("describe", name, "totals.boxes disagrees with the bundle");
        }
        // Every advertised criteria pair is a peek the session accepts.
        for (const BoxSummary& box : d.boxes)
        {
            for (const TagGroupSummary& group : box.tagGroups)
            {
                for (const std::string& tag : group.tags)
                {
                    OrderedMap<std::string, std::string> criteria;
                    criteria.set(group.gameId, tag);
                    try
                    {
                        session.peek(box.gameId, criteria, std::nullopt);
                    }
                    catch (const std::exception& ex)
                    {
                        fail("describe", name, "advertised criteria " + group.gameId + "=" + tag
                            + " rejected by peek: " + ex.what());
                    }
                }
            }
        }
        // The declared surface, flattened, equals the live examiner rows.
        std::vector<std::string> declared;
        for (const PropertyScopeSummary& scope : d.properties)
        {
            for (const PropertySummary& p : scope.properties) declared.push_back(p.name);
        }
        std::vector<std::string> live;
        for (const PropertyRow& row : session.listProperties()) live.push_back(row.name);
        if (declared != live)
        {
            fail("describe", name, "declared properties " + show(declared)
                + " disagree with listProperties " + show(live));
        }
        return 1;
    }
    catch (const std::exception& ex)
    {
        fail("describe", name, ex.what());
        return 0;
    }
}

// -- a bundle that carries a map ------------------------------------------------------
//
// Parsed, reported, and above all IGNORED. The corpus has no map in it (geometry
// is inert payload, so it has no dealing behaviour to conform to), which would
// otherwise leave the whole path compiled and never executed - so the map
// arrives here instead.

static int runDescribeMaps()
{
    static const char* json = R"({
        "schema": "storylets/bundle@0",
        "content": { "project": "p", "version": "1", "hash": "" },
        "metadata": "full",
        "settings": { "playAdvancesTurns": 1 },
        "world": { "properties": [] },
        "story": { "properties": [] },
        "boxes": [],
        "maps": [{
            "box": "village", "group": "zone",
            "zones": [{ "tag": "tavern", "polygon": [
                { "x": 0, "y": 0 }, { "x": 4, "y": 0 }, { "x": 4, "y": 3 }] }],
            "backgrounds": [{ "file": "assets/village/plan.png",
                "x": 1, "y": 2, "width": 8, "height": 6, "opacity": 0.6 }]
        }]
    })";
    try
    {
        JsonParser parser{ std::string(json) };
        JsonValue root = parser.parse();
        BundlePtr bundle = ParseBundle(root);

        if (bundle->maps.size() != 1) { fail("describe", "maps", "the map did not parse"); return 0; }
        const BundleMap& map = bundle->maps.front();
        if (map.box != "village" || map.group != "zone") { fail("describe", "maps", "box/group lost"); return 0; }
        if (map.zones.size() != 1 || map.zones[0].polygon.size() != 3) { fail("describe", "maps", "the polygon lost points"); return 0; }
        if (map.zones[0].polygon[2].x != 4 || map.zones[0].polygon[2].y != 3) { fail("describe", "maps", "a point moved"); return 0; }
        if (map.backgrounds.size() != 1 || map.backgrounds[0].file != "assets/village/plan.png") { fail("describe", "maps", "the picture lost its path"); return 0; }
        if (map.backgrounds[0].opacity != 0.6) { fail("describe", "maps", "opacity lost"); return 0; }

        BundleDescription d = describeBundle(*bundle);
        if (d.maps.size() != 1 || d.maps[0].zones != 1 || d.maps[0].backgrounds != 1)
        {
            fail("describe", "maps", "the description does not report the map");
            return 0;
        }
        // And a session over it still runs: inert means inert.
        Engine engine(bundle, EngineOptions{});
        Flow& session = *engine.openFlow("main");
        (void)session;
        return 1;
    }
    catch (const std::exception& ex)
    {
        fail("describe", "maps", ex.what());
        return 0;
    }
}

// -- the Live Link fixture ---------------------------------------------------------------

/** The fixture lives beside corpus.json (packages/conformance/live-link/),
 *  and its bundle path is repo-relative, so both are derived from the corpus
 *  path. Returns the number of frames matched; 0 with a failure when the
 *  fixture cannot be read at all. */
static size_t runLiveLink(const std::string& corpusPath, const std::string& dumpPath, size_t& total)
{
    std::string dir = ".";
    size_t slash = corpusPath.find_last_of('/');
    if (slash != std::string::npos) dir = corpusPath.substr(0, slash);
    const std::string fixtureDir = dir + "/live-link";
    const std::string root = dir + "/../..";
    std::vector<std::string> failures;
    size_t matched = 0;
    try
    {
        JsonValue frames = JsonParser(livelinkfixture::readFile(fixtureDir + "/frames.json")).parse();
        total = frames.arr.size();
        matched = livelinkfixture::replay(fixtureDir, root, failures, dumpPath);
    }
    catch (const std::exception& ex)
    {
        failures.push_back(ex.what());
    }
    for (const std::string& f : failures) fail("live-link", "fixture", f);
    return matched;
}

// -- main ----------------------------------------------------------------------------


// --- the @wildwinter/expr parity corpus ------------------------------------
//
// A SECOND corpus, authored in ../expr and vendored here, holding the
// primitives both product families share and neither family's own corpus
// tests: seed coercion, the PRNG draw and state sequence, operator typing,
// short-circuiting, value equality and the comparison rules. The evaluator is
// exercised only incidentally by the storylet corpus (through dealing), so a
// divergence in expr itself failed nothing anywhere until this existed.
//
// Its `expressions` section has the same shape as ours and goes through the
// same runExpressions above. Only the PRNG section is new.

static double exprSeed(const JsonValue& v)
{
    // JSON has no literal for the non-finite doubles, and they are exactly the
    // interesting coercion cases, so the corpus carries them as strings.
    if (v.type == JsonValue::String)
    {
        if (v.str == "NaN") return std::numeric_limits<double>::quiet_NaN();
        if (v.str == "Infinity") return std::numeric_limits<double>::infinity();
        if (v.str == "-Infinity") return -std::numeric_limits<double>::infinity();
        throw std::runtime_error("unknown seed literal: " + v.str);
    }
    return v.num;
}

static int runExprPrng(const JsonValue& cases)
{
    int pass = 0;
    for (const auto& c : cases.arr)
    {
        std::string name = c.strOr("name");
        Mulberry32 prng(exprSeed(c.at("seed")));

        const uint32_t wantSeed = static_cast<uint32_t>(c.numOr("expectSeedState", 0));
        if (prng.state() != wantSeed)
        {
            fail("expr/prng", name, "seed state " + std::to_string(prng.state())
                + ", expected " + std::to_string(wantSeed));
            continue;
        }

        const auto& states = c.at("expectStates").arr;
        const auto& draws = c.at("expectDraws").arr;
        bool ok = true;
        for (size_t i = 0; i < states.size() && ok; ++i)
        {
            const double d = prng.next();
            // The corpus pins the draw's NUMERATOR, an exact uint32, so no port
            // is held to another language's float printing.
            const uint32_t gotDraw = static_cast<uint32_t>(llround(d * 4294967296.0));
            const uint32_t wantDraw = static_cast<uint32_t>(draws[i].num);
            const uint32_t wantState = static_cast<uint32_t>(states[i].num);
            if (gotDraw != wantDraw)
            {
                fail("expr/prng", name, "draw " + std::to_string(i + 1) + " is "
                    + std::to_string(gotDraw) + ", expected " + std::to_string(wantDraw));
                ok = false;
            }
            else if (prng.state() != wantState)
            {
                fail("expr/prng", name, "state after draw " + std::to_string(i + 1) + " is "
                    + std::to_string(prng.state()) + ", expected " + std::to_string(wantState));
                ok = false;
            }
            else if (!(d >= 0.0 && d < 1.0))
            {
                fail("expr/prng", name, "draw " + std::to_string(i + 1) + " outside [0, 1)");
                ok = false;
            }
        }
        if (ok) ++pass;
    }
    return pass;
}

int main(int argc, char** argv)
{
    std::string path = argc > 1 ? argv[1] : "packages/conformance/corpus.json";
    std::string liveLinkDump = argc > 2 ? argv[2] : "";   // the Live Link frames, one per line
    std::ifstream file(path);
    if (!file)
    {
        std::cerr << "corpus not found: " << path << "\n";
        return 2;
    }
    std::stringstream buffer;
    buffer << file.rdbuf();

    try
    {
        JsonParser parser(buffer.str());
        JsonValue root = parser.parse();
        int version = static_cast<int>(root.numOr("version", 0));

        const JsonValue& expressions = root.at("expressions");
        const JsonValue& specificity = root.at("specificity");
        const JsonValue& peek = root.at("peek");
        const JsonValue& scripted = root.at("scripted");

        int e = runExpressions(expressions);
        int sp = runSpecificity(specificity);
        int p = runPeek(peek);
        int s = runScripted(scripted);
        int d = runDescribe(peek);
        int m = runDescribeMaps();
        int sv = runSave(peek);
        size_t liveTotal = 0;
        size_t live = runLiveLink(path, liveLinkDump, liveTotal);

        std::cout << "corpus version " << version << "\n";
        std::cout << "describeBundle checks: " << d << "/1  maps: " << m << "/1  save round trip: " << sv << "/1\n";
        std::cout << "expressions: " << e << "/" << expressions.arr.size()
            << "  specificity: " << sp << "/" << specificity.arr.size()
            << "  peek: " << p << "/" << peek.arr.size()
            << "  scripted: " << s << "/" << scripted.arr.size() << "\n";
        std::cout << "live-link fixture: " << live << "/" << liveTotal << " frames\n";

        // The expr parity corpus sits beside ours, vendored from ../expr.
        // Absent is a FAILURE, not a skip: a parity gate that quietly does
        // nothing when its fixture is missing is the shape of check this
        // codebase has shipped before and been bitten by.
        const size_t slash = path.find_last_of("/\\");
        const std::string exprPath =
            (slash == std::string::npos ? std::string() : path.substr(0, slash + 1)) + "expr-corpus.json";
        std::ifstream exprFile(exprPath);
        if (!exprFile)
        {
            std::cerr << "expr parity corpus not found: " << exprPath << "\n";
            return 2;
        }
        std::stringstream exprBuffer;
        exprBuffer << exprFile.rdbuf();
        JsonParser exprParser(exprBuffer.str());
        JsonValue exprRoot = exprParser.parse();
        const JsonValue& exprPrng = exprRoot.at("prng");
        const JsonValue& exprExprs = exprRoot.at("expressions");
        int xp = runExprPrng(exprPrng);
        int xe = runExpressions(exprExprs);
        std::cout << "expr corpus v" << static_cast<int>(exprRoot.numOr("version", 0))
            << " - prng: " << xp << "/" << exprPrng.arr.size()
            << "  expressions: " << xe << "/" << exprExprs.arr.size() << "\n";
        std::cout << (g_fails == 0 ? "ALL PASS" : std::to_string(g_fails) + " FAILED") << "\n";
        return g_fails == 0 ? 0 : 1;
    }
    catch (const std::exception& ex)
    {
        std::cerr << "fatal: " << ex.what() << "\n";
        return 2;
    }
}
