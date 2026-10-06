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
// (deals, plays, turns, save/load), load (a bundle the engine must refuse at
// construction). Plus the Live Link fixture
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
#include "OneRegistry.h"   // the JS one-registry.test.ts, ported
#include "Storylets/Bundle.h"
#include "Storylets/DescribeBundle.h"   // the bundle inspector compiles under -Wall -Wextra
#include "Storylets/Dialect.h"
#include "Storylets/Expression.h"
#include "Storylets/Mulberry32.h"
#include "Storylets/Expr/ScopeRegistry.h"   // the kernel header compiles under -Wall -Wextra
#include "RegistryCorpus.h"   // the shared registry corpus runner, vendored from ../expr
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
 *  box/deck/hand/value are keyed by the owner's GAMEID (design change 4.4).
 *  The immutable id is still accepted on input for this release and raises a
 *  `diagnostic`; it is refused after the next lockstep release, in every scope
 *  including "value". A "value" key is the tag's gameId where one tag in the
 *  bundle carries it and the box-qualified "<boxGameId>/<tagGameId>"
 *  otherwise: two boxes may each name a tag "docks", so the short form is
 *  refused there and the qualified one is accepted always. */
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

/** A peek op's cap. Absent is no cap; a JSON null is a DIFFERENT cap, the
 *  one JS's Math.max(null, 0) reads as zero, so it returns nothing (corpus
 *  version 12). */
static std::optional<int> peekCap(const JsonValue& op)
{
    const JsonValue* n = op.find("n");
    if (!n) return std::nullopt;
    if (n->type == JsonValue::Null) return 0;
    if (!n->isNumber()) return std::nullopt;
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

// -- load ---------------------------------------------------------------------------

/** Construct the engine from the case's bundle: the construction must be
 *  refused (a throw, this runtime's construction-refusal channel), and the
 *  refusal must contain every expectRefused string
 *  (design/project-map-contract.md 3.8; runner.ts runLoadCase). */
static int runLoad(const JsonValue& cases)
{
    int pass = 0;
    for (const auto& c : cases.arr)
    {
        std::string name = c.strOr("name");
        std::optional<std::string> error;
        try
        {
            BundlePtr bundle = ParseBundle(c.at("bundle"));
            EngineOptions opts;
            opts.seed = 0;
            Engine engine(bundle, opts);
        }
        catch (const std::exception& ex)
        {
            error = ex.what();
        }
        if (!error.has_value())
        {
            fail("load", name, "expected the engine to refuse the bundle at construction, it was accepted");
            continue;
        }
        bool ok = true;
        for (const std::string& want : stringList(c.at("expectRefused")))
        {
            if (error->find(want) != std::string::npos) continue;
            fail("load", name, "expected the refusal to name \"" + want + "\", got \"" + *error + "\"");
            ok = false;
        }
        if (ok) ++pass;
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

// -- the load report (design/engine-server.md 4.9) ----------------------------------
//
// A report's lists are compared as SORTED lists of canonical strings, not as
// structs: field order is not a contract, and four runtimes have four idioms for
// one of these entries. An absent flow (the shared half) canonicalises to the
// empty string, which is why the separator is a character no id, gameId or
// property name can hold.

static const char* const kFieldSep = "\x1f";

static std::string joinFields(const std::vector<std::string>& parts)
{
    std::string out;
    for (size_t i = 0; i < parts.size(); ++i)
    {
        if (i) out += kFieldSep;
        out += parts[i];
    }
    return out;
}

static std::string showList(std::vector<std::string> list)
{
    std::string out = "[";
    for (size_t i = 0; i < list.size(); ++i)
    {
        if (i) out += ",";
        out += "\"" + list[i] + "\"";
    }
    return out + "]";
}

static std::string showSorted(std::vector<std::string> list)
{
    std::sort(list.begin(), list.end());
    return showList(std::move(list));
}

/** A field map as a JSON object with its keys sorted, so two maps compare by
 *  what they hold and not by the order they were written in. */
static std::string showFields(const OrderedMap<std::string, StoryletValue>& fields)
{
    std::vector<std::string> keys;
    for (const auto& pair : fields) keys.push_back(pair.first);
    std::sort(keys.begin(), keys.end());
    std::string out = "{";
    for (size_t i = 0; i < keys.size(); ++i)
    {
        if (i) out += ",";
        out += "\"" + keys[i] + "\":" + fields.at(keys[i]).toJsonString();
    }
    return out + "}";
}

/** The keys named by an expectReport array of objects, sorted. */
static std::string wantKeys(const JsonValue& array, const std::vector<std::string>& fields)
{
    std::vector<std::string> keys;
    for (const auto& entry : array.arr)
    {
        std::vector<std::string> parts;
        for (const auto& f : fields) parts.push_back(entry.strOr(f));
        keys.push_back(joinFields(parts));
    }
    return showSorted(std::move(keys));
}

static std::string evictionKeys(const std::vector<LoadEviction>& list)
{
    std::vector<std::string> keys;
    for (const auto& e : list) keys.push_back(joinFields({e.flow, e.hand, e.card, e.reason}));
    return showSorted(std::move(keys));
}

static std::string cooldownKeys(const std::vector<LoadCooldown>& list)
{
    std::vector<std::string> keys;
    for (const auto& x : list) keys.push_back(joinFields({x.flow, x.card}));
    return showSorted(std::move(keys));
}

static std::string propertyKeys(const std::vector<LoadProperty>& list)
{
    std::vector<std::string> keys;
    for (const auto& p : list) keys.push_back(joinFields({p.flow, p.path}));
    return showSorted(std::move(keys));
}

/** The whole report as one comparable string, for "did the preview predict the
 *  restore". */
static std::string reportShape(const LoadReport& r)
{
    return std::string(r.exact ? "exact" : "inexact") + " " + r.project + " "
        + r.version.saved + " " + r.version.bundle + " " + r.hash.saved + " " + r.hash.bundle + " "
        + showList(r.flows) + " " + evictionKeys(r.evicted) + " " + cooldownKeys(r.droppedCooldowns)
        + " " + showList(r.droppedSpent) + " " + propertyKeys(r.droppedProperties)
        + " " + propertyKeys(r.defaultedProperties) + " " + propertyKeys(r.retypedProperties);
}

/** Check the fields expectReport names, and only those. */
static void checkReport(const std::string& at, const JsonValue* expected, const LoadReport& actual,
    std::vector<std::string>& failures)
{
    if (!expected || !expected->isObject()) return;
    auto cmp = [&](const std::string& field, const std::string& want, const std::string& got)
    {
        if (want != got) failures.push_back(at + ": report." + field + " expected " + want + ", got " + got);
    };
    if (const JsonValue* v = expected->find("exact"))
    {
        cmp("exact", v->b ? "true" : "false", actual.exact ? "true" : "false");
    }
    if (const JsonValue* v = expected->find("project")) cmp("project", v->str, actual.project);
    if (const JsonValue* v = expected->find("version"))
    {
        cmp("version.saved", v->strOr("saved"), actual.version.saved);
        cmp("version.bundle", v->strOr("bundle"), actual.version.bundle);
    }
    if (const JsonValue* v = expected->find("hash"))
    {
        cmp("hash.saved", v->strOr("saved"), actual.hash.saved);
        cmp("hash.bundle", v->strOr("bundle"), actual.hash.bundle);
    }
    if (const JsonValue* v = expected->find("flows"))
    {
        std::vector<std::string> want;
        for (const auto& x : v->arr) want.push_back(x.str);
        cmp("flows", showList(want), showList(actual.flows));
    }
    if (const JsonValue* v = expected->find("evicted"))
    {
        cmp("evicted", wantKeys(*v, {"flow", "hand", "card", "reason"}), evictionKeys(actual.evicted));
    }
    if (const JsonValue* v = expected->find("droppedCooldowns"))
    {
        cmp("droppedCooldowns", wantKeys(*v, {"flow", "card"}), cooldownKeys(actual.droppedCooldowns));
    }
    if (const JsonValue* v = expected->find("droppedSpent"))
    {
        std::vector<std::string> want;
        for (const auto& x : v->arr) want.push_back(x.str);
        cmp("droppedSpent", showSorted(std::move(want)), showSorted(actual.droppedSpent));
    }
    const std::pair<const char*, const std::vector<LoadProperty>*> propFields[] = {
        {"droppedProperties", &actual.droppedProperties},
        {"defaultedProperties", &actual.defaultedProperties},
        {"retypedProperties", &actual.retypedProperties},
    };
    for (const auto& field : propFields)
    {
        if (const JsonValue* v = expected->find(field.first))
        {
            cmp(field.first, wantKeys(*v, {"flow", "path"}), propertyKeys(*field.second));
        }
    }
}

/** Check a durable half the runner has just kept (corpus version 13): the
 *  schema tag and content block every half carries, then what `expect` names.
 *  `values` whole and in any order, `spent` exactly. */
static void checkDurable(const std::string& at, const JsonValue* expected, const DurableSave& actual,
    const Bundle& bundle, std::vector<std::string>& failures)
{
    if (actual.schema != "storylets/durable@1")
    {
        failures.push_back(at + ": schema expected \"storylets/durable@1\", got \"" + actual.schema + "\"");
    }
    const auto content = [](const BundleContent& c)
    {
        return "{\"project\":\"" + c.project + "\",\"version\":\"" + c.version + "\",\"hash\":\"" + c.hash + "\"}";
    };
    if (content(actual.content) != content(bundle.content))
    {
        failures.push_back(at + ": content expected " + content(bundle.content) + ", got " + content(actual.content));
    }
    if (!expected || !expected->isObject()) return;
    if (const JsonValue* values = expected->find("values"))
    {
        const std::string want = showFields(savedetail::ParseBag(values));
        const std::string got = showFields(actual.values);
        if (want != got) failures.push_back(at + ": values expected " + want + ", got " + got);
    }
    if (const JsonValue* spent = expected->find("spent"))
    {
        const std::string want = show(stringList(*spent));
        const std::string got = show(actual.spent);
        if (want != got) failures.push_back(at + ": spent expected " + want + ", got " + got);
    }
}

/** Ops that run ON a flow, and so open one lazily. The rest - engine reads, flow
 *  management, save/load - must NOT, or a harness quietly opens "main" where the
 *  JS reference does not and assertFlows answers differently for no engine
 *  reason. */
static bool needsFlow(const std::string& kind)
{
    return kind == "setState" || kind == "peek" || kind == "deal" || kind == "assertBoard"
        || kind == "play" || kind == "advanceTurns" || kind == "assertOutcomes"
        || kind == "assertOutcomeOrder" || kind == "assertOutcomeFields" || kind == "assertState";
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
    // The bundle the engine runs now: a kept durable half must carry its content.
    BundlePtr running = bundle;
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
    // What the ask SAID, as opposed to what it dealt. A hole filled from a
    // property that names no tag deals a wildcard hand (4.6), which is
    // indistinguishable on a board read from a hole that was never movable:
    // the diagnostic is the only place the difference lives.
    std::vector<std::string> diagnostics;
    // The two events nothing else can reach, rendered by the shared rule
    // (the corpus's ScriptOp, expectTrace): an evict's hand and card and a
    // play's card are gameIds from 4.4 on, and this is what says so.
    std::vector<std::string> traces;
    // Parked flow blobs, by the name they were parked under. Held OUTSIDE the
    // engine on purpose: a park survives a content swap, which is the case that
    // makes a resume interesting.
    std::unordered_map<std::string, FlowSave> parked;
    // Durable halves (corpus version 13), held outside the engine for the
    // reason a parked blob is: a pocket and an installation's memory outlive
    // the run.
    std::unordered_map<std::string, DurableSave> pockets;
    std::optional<DurableSave> memory;
    auto watch =[&verdicts, &diagnostics, &traces](const FlowPtr& f) -> FlowPtr
    {
        f->subscribeTrace([&verdicts, &diagnostics, &traces](const TraceEvent& e)
        {
            if (e.kind == TraceEvent::Kind::Diagnostic) { diagnostics.push_back(e.message); return; }
            if (e.kind == TraceEvent::Kind::Evict)
            {
                traces.push_back("evict " + e.hand + " " + e.card + " " + e.reason);
                return;
            }
            if (e.kind == TraceEvent::Kind::Play)
            {
                // A play with no outcome reads "play <card>", no trailing space.
                traces.push_back(e.outcome.empty() ? "play " + e.card : "play " + e.card + " " + e.outcome);
                return;
            }
            if (e.kind == TraceEvent::Kind::Write)
            {
                traces.push_back("write " + e.target + " " + e.path);
                return;
            }
            if (e.kind != TraceEvent::Kind::Deal && e.kind != TraceEvent::Kind::Peek) return;
            for (const auto& card : e.cards) verdicts[card.id] = VerdictWire(card.verdict);
        });
        return f;
    };
    auto flowOf = [&](const JsonValue& op) -> Flow&
    {
        std::string flowName = op.strOr("flow");
        if (flowName.empty()) flowName = "main";
        auto it = handles.find(flowName);
        if (it == handles.end())
        {
            it = handles.emplace(flowName, watch(engine->openFlow(flowName))).first;
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
    auto checkTrace = [&](const std::string& at, const JsonValue& op)
    {
        const JsonValue* expected = op.find("expectTrace");
        if (!expected || !expected->isArray()) return;
        for (const std::string& want : stringList(*expected))
        {
            if (std::find(traces.begin(), traces.end(), want) != traces.end()) continue;
            failures.push_back(at + ": expected the trace to carry \"" + want
                + "\", got " + (traces.empty() ? "no deal-time events" : show(traces)));
        }
    };
    auto checkDiagnostic = [&](const std::string& at, const JsonValue& op)
    {
        const JsonValue* expected = op.find("expectDiagnostic");
        if (!expected || !expected->isString()) return;
        const std::string want = expected->str;
        for (const std::string& said : diagnostics)
        {
            if (said.find(want) != std::string::npos) return;
        }
        std::string got;
        for (const std::string& said : diagnostics) got += (got.empty() ? "" : ", ") + said;
        failures.push_back(at + ": expected a diagnostic containing \"" + want
            + "\", got " + (got.empty() ? "none" : got));
    };
    // A write the corpus expects to be REFUSED, through the channel an unknown
    // owner segment already uses: every string listed must appear in what the
    // refusal said. An ambiguous short-form value address is the case that
    // needs it - two boxes naming one tag - and what is listed is the qualified
    // addresses it offers instead.
    auto checkRefused = [&](const std::string& at, const JsonValue& op,
        const std::optional<std::string>& error)
    {
        const JsonValue* expected = op.find("expectRefused");
        if (!expected || !expected->isArray())
        {
            if (error) failures.push_back(at + ": unexpected error: " + *error);
            return;
        }
        if (!error)
        {
            failures.push_back(at + ": expected the write to be refused, it was accepted");
            return;
        }
        for (const std::string& want : stringList(*expected))
        {
            if (error->find(want) != std::string::npos) continue;
            failures.push_back(at + ": expected the refusal to name \"" + want
                + "\", got \"" + *error + "\"");
        }
    };
    std::unordered_map<std::string, std::string> names = handGameIds(*bundle);

    const JsonValue& script = c.at("script");
    for (size_t index = 0; index < script.arr.size(); ++index)
    {
        const JsonValue& op = script.arr[index];
        std::string kind = op.strOr("op");
        std::string at = "op " + std::to_string(index) + " (" + kind + ")";
        Flow* session = needsFlow(kind) ? &flowOf(op) : nullptr;
        if (kind == "setState")
        {
            verdicts.clear();
            diagnostics.clear();
            traces.clear();
            std::optional<std::string> writeError;
            try
            {
                applyState(*session, op);
            }
            catch (const std::exception& ex)
            {
                writeError = std::string(ex.what());
            }
            checkDiagnostic(at, op);
            checkRefused(at, op, writeError);
        }
        else if (kind == "peek")
        {
            std::vector<std::string> actual;
            std::optional<std::string> peekError;
            verdicts.clear();
            diagnostics.clear();
            traces.clear();
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
            diagnostics.clear();
            traces.clear();
            OrderedMap<std::string, std::vector<DealtCard>> dealt = session->dealMany(handRefs);
            checkVerdicts(at, op);
            checkDiagnostic(at, op);
            checkTrace(at, op);
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
            verdicts.clear();
            diagnostics.clear();
            traces.clear();
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
            checkTrace(at, op);
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
        else if (kind == "assertOutcomeFields")
        {
            // What the box's outcome template filled in, carried to the game
            // with the outcome and never read on the way: the bundle's own
            // values, and an empty map for an outcome that declares none.
            const JsonValue& expect = op.at("expect");
            std::vector<OutcomeView> views = session->outcomes(op.strOr("card"), op.strOr("from"));
            for (const auto& pair : expect.obj)
            {
                OrderedMap<std::string, StoryletValue> actual;
                for (const auto& v : views)
                {
                    if (v.gameId == pair.first)
                    {
                        actual = v.fields;
                        break;
                    }
                }
                OrderedMap<std::string, StoryletValue> wanted;
                for (const auto& field : pair.second.obj)
                {
                    wanted.set(field.first, bundleloader::ToValue(field.second));
                }
                if (showFields(actual) != showFields(wanted))
                {
                    failures.push_back(at + ": " + pair.first + " expected " + showFields(wanted)
                        + ", got " + showFields(actual));
                }
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
            // one (semantic parity, not byte parity, unless the op asks for
            // expectSameBytes). into: "B" restores into
            // the case's EDITED bundle: the drifted-content contract.
            // loadGame rebuilds every flow, so the script's handles are
            // re-taken.
            SaveEnvelope envelope = engine->saveGame();
            // expectSameBytes: this port's own serialised save text, taken
            // before the load, must equal what the loaded engine writes
            // straight after. A save that differs by the road taken to it
            // fails here even when every value is right.
            const JsonValue* sameBytes = op.find("expectSameBytes");
            const bool expectSameBytes = sameBytes && sameBytes->b;
            const std::string bytesBefore = expectSameBytes ? serializeState(*engine) : std::string();
            BundlePtr into = op.strOr("into") == "B" ? bundleB : bundle;
            auto target = std::make_unique<Engine>(into, opts);
            const JsonValue* previewOnly = op.find("previewOnly");
            if (previewOnly && previewOnly->b)
            {
                // The purity claim, checked rather than asserted: the engine
                // that was asked what a load would cost writes the same envelope
                // after the question as before it. The LIVE engine is not
                // replaced, so the ops after this one prove the load did not
                // happen.
                const std::string before = serializeState(*target);
                const LoadReport previewReport = target->previewLoad(envelope);
                if (serializeState(*target) != before)
                {
                    failures.push_back(at + ": previewLoad changed the engine it was asked about");
                }
                checkReport(at, op.find("expectReport"), previewReport, failures);
            }
            else
            {
                engine = std::move(target);
                running = into;
                checkReport(at, op.find("expectReport"), engine->loadGame(envelope), failures);
                // Re-taken AND watched, as a lazily opened flow is (corpus
                // version 12): a deal straight after a load into an edited
                // build is where an eviction's reason shows.
                handles.clear();
                for (const FlowPtr& f : engine->flows()) handles[f->id()] = watch(f);
                if (expectSameBytes)
                {
                    const std::string bytesAfter = serializeState(*engine);
                    if (bytesAfter != bytesBefore)
                    {
                        failures.push_back(at + ": the loaded engine saves different bytes: before "
                            + bytesBefore + ", after " + bytesAfter);
                    }
                }
            }
        }
        else if (kind == "parkFlow")
        {
            // Park: take the blob, then close. Closing is what releases the
            // shared claims, which is the whole reason a visit parks rather than
            // idling.
            const std::string name = op.strOr("flow");
            // Through the STRING boundary, because that is the only door
            // Blueprint has (UStoryletEngine::SaveFlowToJson /
            // OpenFlowFromJson) and nothing else would ever exercise it: a
            // writer nothing runs is a writer that breaks. The blob that lands
            // in `parked` is the one that survived the round trip, so a
            // divergence shows up as a failing case rather than a UE-only bug.
            parked[name] = deserializeFlow(serializeFlow(engine->saveFlow(name)));
            // keepOpen takes the blob WITHOUT closing, so the resumeFlow after
            // it replaces a live flow in place (rolling back to a checkpoint).
            const JsonValue* keepOpen = op.find("keepOpen");
            if (!(keepOpen && keepOpen->b)) engine->closeFlow(name);
        }
        else if (kind == "resumeFlow")
        {
            const std::string name = op.strOr("flow");
            auto found = parked.find(name);
            if (found == parked.end())
            {
                failures.push_back(at + ": nothing is parked under \"" + name + "\"");
            }
            else
            {
                // Ask before doing, then require the two answers to agree: a
                // preview that does not predict the restore is worse than no
                // preview.
                const LoadReport preview = engine->previewFlowRestore(name, found->second);
                bool reported = false;
                LoadReport applied;
                OpenFlowOptions resumeOpts;
                resumeOpts.restore = found->second;
                resumeOpts.onRestoreReport = [&applied, &reported](const LoadReport& r)
                {
                    applied = r;
                    reported = true;
                };
                if (const JsonValue* seedJson = op.find("seed")) resumeOpts.seed = seedJson->num;
                handles[name] = watch(engine->openFlow(name, resumeOpts));
                if (!reported)
                {
                    failures.push_back(at + ": the restore produced no report");
                }
                else if (reportShape(preview) != reportShape(applied))
                {
                    failures.push_back(at + ": previewFlowRestore said " + reportShape(preview)
                        + ", the restore did " + reportShape(applied));
                }
                checkReport(at, op.find("expectReport"), reported ? applied : preview, failures);
                // The report's string face (the Unreal wrapper's boundary) is
                // only reachable from Blueprint, so it is exercised here rather
                // than nowhere: a writer nothing runs is a writer that breaks.
                if (storylets::reportToJson(preview).empty())
                {
                    failures.push_back(at + ": reportToJson wrote nothing");
                }
            }
        }
        else if (kind == "keepPocket" || kind == "keepMemory")
        {
            // Through the STRING boundary, as parkFlow keeps its blob: it is
            // the only door Blueprint has (SaveDurableToJson /
            // LoadDurableFromJson / OpenFlowWithDurableJson), and the half that
            // lands here is the one that survived the round trip.
            std::optional<DurableSave> kept;
            try
            {
                const DurableSave half = kind == "keepPocket" ? flowOf(op).saveDurable() : engine->saveDurable();
                kept = deserializeDurable(serializeDurable(half));
            }
            catch (const std::exception& ex)
            {
                failures.push_back(at + ": unexpected error: " + std::string(ex.what()));
            }
            if (kept.has_value())
            {
                checkDurable(at, op.find("expect"), *kept, *running, failures);
                if (kind == "keepMemory")
                {
                    memory = std::move(*kept);
                }
                else
                {
                    std::string name = op.strOr("flow");
                    if (name.empty()) name = "main";
                    pockets[name] = std::move(*kept);
                }
            }
        }
        else if (kind == "newRun")
        {
            // The world restarts: a fresh engine, no flow, no handle. What
            // crosses is what the script kept, and only through the durable
            // verbs.
            running = op.strOr("into") == "B" ? bundleB : bundle;
            engine = std::make_unique<Engine>(running, opts);
            handles.clear();
            if (memory.has_value())
            {
                try
                {
                    checkReport(at, op.find("expectReport"), engine->loadDurable(*memory), failures);
                }
                catch (const std::exception& ex)
                {
                    failures.push_back(at + ": unexpected error: " + std::string(ex.what()));
                }
            }
        }
        else if (kind == "openFlowDurable")
        {
            const std::string name = op.strOr("flow");
            auto pocket = pockets.find(name);
            auto blob = parked.find(name);
            const bool withRestore = op.boolOr("withRestore");
            if (pocket == pockets.end())
            {
                failures.push_back(at + ": no pocket is kept under \"" + name + "\"");
            }
            else if (withRestore && blob == parked.end())
            {
                failures.push_back(at + ": nothing is parked under \"" + name + "\"");
            }
            else
            {
                bool reported = false;
                LoadReport applied;
                OpenFlowOptions durableOpts;
                durableOpts.durable = pocket->second;
                if (withRestore) durableOpts.restore = blob->second;
                durableOpts.onRestoreReport = [&applied, &reported](const LoadReport& r)
                {
                    applied = r;
                    reported = true;
                };
                if (const JsonValue* seedJson = op.find("seed")) durableOpts.seed = seedJson->num;
                FlowPtr opened;
                std::optional<std::string> error;
                try
                {
                    opened = engine->openFlow(name, durableOpts);
                }
                catch (const std::exception& ex)
                {
                    error = std::string(ex.what());
                }
                if (op.boolOr("expectError"))
                {
                    // Refused before anything changed: the handle the script
                    // holds under that name (if any) is left exactly as it was.
                    if (!error.has_value()) failures.push_back(at + ": expected an error, the flow opened");
                }
                else if (error.has_value())
                {
                    failures.push_back(at + ": unexpected error: " + *error);
                }
                else
                {
                    handles[name] = watch(opened);
                    if (!reported) failures.push_back(at + ": the durable open produced no report");
                    else checkReport(at, op.find("expectReport"), applied, failures);
                }
            }
        }
        else if (kind == "reset")
        {
            engine = std::make_unique<Engine>(bundle, opts);
            running = bundle;
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
// this name pins the self-backed path, where @world is the engine's stand-in bag:
// it keeps the declaration, and the host's own surface writes past it with the
// kernel's host flag. A game that binds its own resolver takes the engine's writes
// straight, and only the engine's own check stands between a story and the host:
// this is the one place that check is exercised. Same probe in the JS, C# and
// Godot harnesses.
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

// The SELF-BACKED @world, examined: no corpus op reads an examiner row, so the half
// the Patter brief called the point of the flag - the declaration still showing as
// read-only after the game has written it - is asserted here, and in the other three
// runtimes' harnesses.
static std::vector<std::string> runSelfWorldExaminer(const JsonValue& c)
{
    std::vector<std::string> failures;
    EngineOptions opts;
    Engine engine(ParseBundle(c.at("bundle")), opts);
    auto rowFor = [&engine](const std::string& path) -> std::optional<PropertyRow> {
        for (const auto& r : engine.listProperties()) if (r.path == path) return r;
        return std::nullopt; };
    std::optional<PropertyRow> clock = rowFor("world.clock");
    std::optional<PropertyRow> mood = rowFor("world.mood");
    if (!clock || !mood) { failures.push_back("self-backed examiner: no row for world.clock/world.mood"); return failures; }
    if (clock->writable) failures.push_back("self-backed examiner: world.clock did not report writable: false");
    if (!mood->writable) failures.push_back("self-backed examiner: world.mood reported read-only");
    try { engine.setProperty("world.clock", StoryletValue::Num(5)); }
    catch (const StoryletError& ex) { failures.push_back(std::string("self-backed examiner: the game's own setProperty was refused: ") + ex.what()); }
    std::optional<PropertyRow> after = rowFor("world.clock");
    if (!after || !after->value.valueEquals(StoryletValue::Num(5))) failures.push_back("self-backed examiner: the host's write did not land");
    if (after && after->writable) failures.push_back("self-backed examiner: a host write made the declaration writable");
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
                std::vector<std::string> rows = runSelfWorldExaminer(c);
                failures.insert(failures.end(), rows.begin(), rows.end());
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
 *  two refusals (foreign schema, malformed text). A standalone engine's
 *  envelope carries its self-backed @world in its registry section, and the
 *  file carries the @world values beside it for a host that binds its own. */
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

        if (d.identity.schema != bundle->schema || !IsSupportedBundleSchema(d.identity.schema))
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

// -- a bundle with the project map ---------------------------------------------------
//
// describeBundle is session-less, so each runtime pins its project map summary
// in its own describe tests (design/project-map-contract.md 3.7); this is the
// C++ twin of packages/runtime/test/describe-bundle.test.ts. The geometry is
// inert payload the corpus cannot observe, which would otherwise leave its
// parse path compiled and never executed, so it arrives here too.

static int runDescribeMaps()
{
    // The conformance PROJECT SCAFFOLD: group "district", zones "quay" and
    // "hill", each declaring `danger` (per flow) and `alarm` (shared). Box
    // "box" is on the map (its own group "zone" beside it, and a hand whose
    // hole names the district); box "other" is not.
    static const char* json = R"({
        "schema": "storylets/bundle@1",
        "content": { "project": "p", "version": "1", "hash": "" },
        "metadata": "full",
        "settings": { "playAdvancesTurns": 1 },
        "world": { "properties": [] },
        "story": { "properties": [] },
        "boxes": [
            { "id": "b_x", "gameId": "box", "usesMap": true, "ranking": { "specificity": true },
              "fields": [], "properties": [],
              "tagGroups": [{ "id": "d_zone", "gameId": "zone", "tags": [{ "id": "v_docks", "gameId": "docks" }] }],
              "decks": [{ "id": "k_x", "gameId": "main", "properties": [], "cards": [
                  { "id": "c_q", "gameId": "q", "priority": 0, "redraw": "always", "tags": { "d_district": ["v_quay"] }, "outcomes": [] }] }],
              "handTemplates": [{ "id": "t_npc", "gameId": "npc", "chooses": ["d_district"], "slots": 1,
                  "properties": [{ "name": "zone", "type": "string", "default": "quay" }] }],
              "hands": [{ "id": "h_elder", "gameId": "elder", "template": "t_npc", "chosen": { "d_district": "@hand.zone" } }] },
            { "id": "b_y", "gameId": "other", "ranking": { "specificity": true },
              "fields": [], "properties": [],
              "tagGroups": [{ "id": "d_weather", "gameId": "weather", "tags": [{ "id": "v_rain", "gameId": "rain" }] }],
              "decks": [{ "id": "k_y", "gameId": "main_y", "properties": [], "cards": [
                  { "id": "c_y", "gameId": "y", "priority": 0, "redraw": "always", "outcomes": [] }] }],
              "handTemplates": [], "hands": [] }
        ],
        "map": {
            "group": { "id": "d_district", "gameId": "district", "tags": [
                { "id": "v_quay", "gameId": "quay", "properties": [
                    { "name": "danger", "type": "number", "default": 0 },
                    { "name": "alarm", "type": "number", "default": 0, "shared": true }] },
                { "id": "v_hill", "gameId": "hill", "properties": [
                    { "name": "danger", "type": "number", "default": 0 },
                    { "name": "alarm", "type": "number", "default": 0, "shared": true }] }] },
            "geometry": {
                "zones": [{ "tag": "quay", "polygon": [
                    { "x": 0, "y": 0 }, { "x": 4, "y": 0 }, { "x": 4, "y": 3 }] }],
                "backgrounds": [{ "file": "assets/plan.png",
                    "x": 1, "y": 2, "width": 8, "height": 6, "opacity": 0.6 }],
                "sites": { "box": [{ "hand": "elder", "x": 5, "y": 6 }] }
            }
        }
    })";
    auto bad = [](const std::string& detail) { fail("describe", "project map", detail); return 0; };
    try
    {
        JsonParser parser{ std::string(json) };
        JsonValue root = parser.parse();
        BundlePtr bundle = ParseBundle(root);

        if (!bundle->map.has_value()) return bad("the map did not parse");
        const ProjectMap& map = *bundle->map;
        if (map.group.id != "d_district" || map.group.tags.size() != 2) return bad("the zone group lost its tags");
        if (!bundle->boxes[0].usesMap || bundle->boxes[1].usesMap) return bad("usesMap lost");
        if (!map.geometry.has_value()) return bad("the geometry did not parse");
        const MapGeometry& g = *map.geometry;
        if (g.zones.size() != 1 || g.zones[0].polygon.size() != 3) return bad("the polygon lost points");
        if (g.zones[0].polygon[2].x != 4 || g.zones[0].polygon[2].y != 3) return bad("a point moved");
        if (g.backgrounds.size() != 1 || g.backgrounds[0].file != "assets/plan.png") return bad("the picture lost its path");
        if (g.backgrounds[0].opacity != 0.6) return bad("opacity lost");
        // The placed hands (design/engine-server.md 4.3), keyed by box: sites
        // stay per box, because a hand belongs to one box.
        const std::vector<MapSite>* sites = g.sites.get("box");
        if (g.sites.size() != 1 || !sites || sites->size() != 1) return bad("the sites did not parse");
        if ((*sites)[0].hand != "elder" || (*sites)[0].x != 5 || (*sites)[0].y != 6) return bad("a site moved");

        BundleDescription d = describeBundle(*bundle);
        if (!d.boxes[0].usesMap || d.boxes[1].usesMap) return bad("the description does not mark the opted-in box");
        // A box's tagGroups are its OWN: the map's group is reported once, below.
        if (d.boxes[0].tagGroups.size() != 1 || d.boxes[0].tagGroups[0].gameId != "zone")
        {
            return bad("the box's own groups took in the map's");
        }
        // zone, weather, and the project group counted ONCE.
        if (d.totals.tagGroups != 3) return bad("totals.tagGroups is " + std::to_string(d.totals.tagGroups) + ", expected 3");
        if (!d.map.has_value()) return bad("the description does not report the map");
        const MapSummary& m = *d.map;
        if (m.group != "district" || show(m.tags) != show({ "quay", "hill" }) || show(m.boxes) != show({ "box" }))
        {
            return bad("the map summary names the wrong group, zones or boxes");
        }
        const int* boxSites = m.sites.get("box");
        if (m.zones != 1 || m.backgrounds != 1 || m.sites.size() != 1 || !boxSites || *boxSites != 1)
        {
            return bad("the map summary miscounts the geometry");
        }
        // Each zone's properties once, as a tag scope with a group and NO box.
        std::vector<std::string> zoneScopes;
        for (const PropertyScopeSummary& scope : d.properties)
        {
            if (scope.group != "district") continue;
            zoneScopes.push_back(scope.scope + ":" + scope.owner + ":" + scope.box);
            if (scope.properties.size() != 2 || scope.properties[0].name != "danger" || scope.properties[1].name != "alarm")
            {
                return bad("a zone's declarations are wrong");
            }
        }
        if (show(zoneScopes) != show({ "tag:quay:", "tag:hill:" })) return bad("zone scopes are " + show(zoneScopes));
        // A movable hole that names the map's group is reported, not skipped.
        const HandSummary* elder = nullptr;
        for (const HandSummary& h : d.hands) if (h.gameId == "elder") elder = &h;
        if (!elder || elder->movable.size() != 1 || elder->movable[0].group != "district"
            || elder->movable[0].from != "@hand.zone")
        {
            return bad("the elder's movable hole on the map's group was lost");
        }

        // And a session over it runs, its declared surface is the live one (as
        // a set of names: listProperties puts an owner's shared declarations
        // before its per-flow ones, and the scaffold zone has one of each), and
        // the opted-in box's peek takes the map's name.
        Engine engine(bundle, EngineOptions{});
        Flow& session = *engine.openFlow("main");
        std::vector<std::string> declared;
        for (const PropertyScopeSummary& scope : d.properties)
        {
            for (const PropertySummary& p : scope.properties) declared.push_back(p.name);
        }
        std::vector<std::string> live;
        for (const PropertyRow& row : session.listProperties()) live.push_back(row.name);
        if (showSorted(declared) != showSorted(live))
        {
            return bad("declared properties " + show(declared) + " disagree with listProperties " + show(live));
        }
        OrderedMap<std::string, std::string> criteria;
        criteria.set("district", "quay");
        if (ids(session.peek("box", criteria, std::nullopt).cards) != std::vector<std::string>{ "c_q" })
        {
            return bad("the opted-in box's peek on the map's group lost its card");
        }

        // No map: none reported, no box marked.
        static const char* plain = R"({ "schema": "storylets/bundle@0", "boxes": [
            { "id": "b_x", "gameId": "box", "tagGroups": [], "decks": [], "handTemplates": [], "hands": [] }] })";
        JsonParser plainParser{ std::string(plain) };
        JsonValue plainRoot = plainParser.parse();
        BundleDescription none = describeBundle(*ParseBundle(plainRoot));
        if (none.map.has_value() || none.boxes[0].usesMap) return bad("a bundle without a map reports one");
        return 1;
    }
    catch (const std::exception& ex)
    {
        return bad(ex.what());
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

/** The port's own fixes from the October 2026 engine review: behaviour the JS
 *  reference already had and this runtime did not, too host-shaped for the
 *  shared corpus. Each returns its failures; empty is a pass. */
static std::vector<std::pair<std::string, std::function<std::vector<std::string>()>>> portFixChecks()
{
    using namespace oneregistry;
    std::vector<std::pair<std::string, std::function<std::vector<std::string>()>>> checks;

    checks.emplace_back("a negative log cap empties the engine's log, as it does a flow's", []
    {
        std::vector<std::string> out;
        EngineOptions opts;
        opts.log = true;
        opts.logCap = -1;
        Engine engine(MakeBundle(), opts);
        FlowPtr flow = engine.openFlow("f");
        Heist(*flow);
        if (!flow->log().empty()) out.push_back("the flow log kept " + std::to_string(flow->log().size()) + " entries");
        if (!engine.log().empty()) out.push_back("the engine log kept " + std::to_string(engine.log().size()) + " entries");
        return out;
    });

    // A host resolver that throws is the game's error. JS swallows it into the
    // "not declared" diagnostic and deals on; it must not escape the deal.
    auto throwingWorld = []
    {
        WorldResolver world;
        world.get = [](const std::string&) -> std::optional<StoryletValue> { throw std::runtime_error("host down"); };
        return world;
    };
    auto dealsWithDiagnostic = [](const std::string& json, const WorldResolver& world, const std::string& want)
    {
        std::vector<std::string> out;
        EngineOptions opts;
        opts.world = world;
        Engine engine(ParseBundle(JsonParser(json).parse()), opts);
        FlowPtr flow = engine.openFlow("f");
        std::vector<std::string> messages;
        flow->subscribeTrace([&messages](const TraceEvent& e)
        {
            if (e.kind == TraceEvent::Kind::Diagnostic) messages.push_back(e.message);
        });
        try
        {
            if (flow->deal("q").empty()) out.push_back("nothing was dealt");
        }
        catch (const std::exception& e)
        {
            out.push_back(std::string("the deal threw: ") + e.what());
            return out;
        }
        if (std::find(messages.begin(), messages.end(), want) == messages.end())
        {
            out.push_back("no diagnostic \"" + want + "\" (got " + show(messages) + ")");
        }
        return out;
    };
    checks.emplace_back("a throwing @world resolver binding a boundBy group is the not-declared diagnostic", [=]
    {
        std::string json = BundleJson();
        const std::string from = R"("id":"d_zone","gameId":"zone",)";
        json.replace(json.find(from), from.size(), from + R"("boundBy":"@world.alarm",)");
        return dealsWithDiagnostic(json, throwingWorld(), "boundBy \"@world.alarm\" names a property that is not declared");
    });
    checks.emplace_back("a throwing @world resolver filling a hole is the not-declared diagnostic", [=]
    {
        std::string json = BundleJson();
        const std::string from = R"("rule":{"slots":"unbounded"})";
        json.replace(json.find(from), from.size(), R"("rule":{"slots":"unbounded","bindings":{"d_zone":"@world.alarm"}})");
        return dealsWithDiagnostic(json, throwingWorld(), "\"@world.alarm\" names a property that is not declared");
    });

    checks.emplace_back("a saved PRNG state reads back through ToUint32", []
    {
        std::vector<std::string> out;
        Engine engine(MakeBundle());
        engine.openFlow("f");
        std::string json = serializeFlow(engine.saveFlow("f"));
        const std::string key = "\"prng\": ";
        const size_t at = json.find(key);
        const size_t end = json.find(',', at);
        json.replace(at + key.size(), end - at - key.size(), "-1");
        const FlowSave parsed = deserializeFlow(json);
        if (parsed.prng != 4294967295u) out.push_back("-1 read back as " + std::to_string(parsed.prng));
        return out;
    });
    checks.emplace_back("a write only the landing can refuse puts back what had landed (ruling B)", []
    {
        std::vector<std::string> out;
        // The game's @world says alarm is read-only, which the bundle does not:
        // only the landing meets it, after @deck.drawn and @story.gold landed.
        auto registry = std::make_shared<ScopeRegistry>();
        ScopeDeclaration alarm;
        alarm.name = "alarm"; alarm.type = PropertyTypes::Number; alarm.defaultValue = StoryletValue::Num(0); alarm.writable = false;
        OwnedScopeOptions options; options.owner = std::string("Game");
        registry->defineOwned("world", std::vector<ScopeDeclaration>{alarm}, options);
        EngineOptions opts; opts.registry = registry; opts.seed = 1;
        Engine engine(MakeBundle(), opts);
        FlowPtr flow = engine.openFlow("f");
        std::vector<std::string> writes;
        flow->subscribeTrace([&writes](const TraceEvent& e) { if (e.kind == TraceEvent::Kind::Write) writes.push_back(e.path); });
        const std::vector<DealtCard> dealt = flow->deal("q");
        try { flow->play(dealt.at(0).gameId, "go", "q"); out.push_back("the play was not refused"); }
        catch (const StoryletError&) {}
        if (Show(engine.getProperty("story.gold")) != "0") out.push_back("story.gold is " + Show(engine.getProperty("story.gold")));
        if (Show(flow->getProperty("deck.main.drawn")) != "0") out.push_back("deck.main.drawn is " + Show(flow->getProperty("deck.main.drawn")));
        if (!writes.empty()) out.push_back("write events fired for a refused play: " + show(writes));
        if (flow->board().get("q")->size() != 1) out.push_back("the card left its hand");
        return out;
    });

    checks.emplace_back("the same handler identity subscribed twice hears each event once (ruling F)", []
    {
        static int heard = 0;
        heard = 0;
        void (*handler)(const TraceEvent&) = [](const TraceEvent&) { ++heard; };
        Engine engine(MakeBundle());
        FlowPtr flow = engine.openFlow("f");
        const void* identity = reinterpret_cast<const void*>(handler);
        auto first = flow->subscribeTrace(handler, identity);
        auto second = flow->subscribeTrace(handler, identity);
        flow->advanceTurns("box");
        std::vector<std::string> out;
        if (heard != 1) out.push_back("one event was heard " + std::to_string(heard) + " times");
        second();
        flow->advanceTurns("box");
        if (heard != 1) out.push_back("an unsubscribe from either call did not remove it");
        first();
        return out;
    });
    checks.emplace_back("deserializeState hands its LoadReport to onReport", []
    {
        std::vector<std::string> out;
        Engine engine(MakeBundle());
        engine.openFlow("f");
        const std::string text = serializeState(engine);
        Engine fresh(MakeBundle());
        std::optional<LoadReport> got;
        deserializeState(fresh, text, [&got](const LoadReport& r) { got = r; });
        if (!got.has_value()) out.push_back("onReport was not called");
        else if (!got->exact || got->flows != std::vector<std::string>{"f"}) out.push_back("the report is not the load's");
        deserializeState(fresh, text);   // and without one, as before
        return out;
    });
    return checks;
}

/** Durable halves (ruling H, 2026-10-06): the JS durable.test.ts, ported. The
 *  corpus pins what the durable verbs carry and what a load reports; these are
 *  the host API's edges a script cannot reach: the shape of a half as a game
 *  stores it, the refusals made before anything moves, a memory loaded into an
 *  engine that is not fresh, and a closed flow. */
static std::vector<std::pair<std::string, std::function<std::vector<std::string>()>>> durableChecks()
{
    using oneregistry::Show;
    std::vector<std::pair<std::string, std::function<std::vector<std::string>()>>> checks;

    // The JS test's bundle: a shared durable `souls`, a per-flow durable enum
    // `oath` and a per-flow durable `seal` the story may not write, a shared
    // run-scoped `gold`; a per-flow durable one-shot c_once and, in a shared
    // durable deck, the one-shot c_relic.
    static const char* const json = R"JSON({"schema":"storylets/bundle@0","content":{"project":"conf","version":"0.0.0","hash":""},"metadata":"full","settings":{"playAdvancesTurns":1},"world":{"properties":[]},"story":{"properties":[{"name":"souls","type":"number","default":0,"durable":true},{"name":"oath","type":"enum","default":"iron","values":["iron","oak"],"shared":false,"durable":true},{"name":"seal","type":"number","default":0,"shared":false,"durable":true,"writable":false},{"name":"gold","type":"number","default":0}]},"boxes":[{"id":"b_x","gameId":"box","ranking":{"specificity":true},"fields":[],"properties":[],"tagGroups":[],"decks":[{"id":"k_main","gameId":"main","properties":[],"cards":[{"id":"c_once","gameId":"once","priority":2,"redraw":"never","durable":true,"outcomes":[]}]},{"id":"k_relics","gameId":"relics","shared":true,"durable":true,"properties":[],"cards":[{"id":"c_relic","gameId":"relic","priority":1,"redraw":"never","outcomes":[]}]}],"handTemplates":[],"hands":[{"id":"h_q","gameId":"q","rule":{"slots":"unbounded"}}]}]})JSON";
    static const BundlePtr bundle = ParseBundle(JsonParser(json).parse());

    // A run that has spent both one-shots and moved every durable value.
    auto played = []
    {
        auto engine = std::make_unique<Engine>(bundle);
        FlowPtr flow = engine->openFlow("alice");
        flow->setProperty("story.souls", StoryletValue::Num(4));
        flow->setProperty("story.oath", StoryletValue::Str("oak"));
        flow->setProperty("story.seal", StoryletValue::Num(9));
        for (const DealtCard& card : flow->deal("q")) flow->play(card.gameId, "", "q");
        return engine;
    };
    // What a call threw, or "" when it did not.
    auto thrown = [](const std::function<void()>& body) -> std::string
    {
        try { body(); }
        catch (const StoryletError& e) { return e.what(); }
        catch (const std::exception& e) { return std::string("not a StoryletError: ") + e.what(); }
        return std::string();
    };

    checks.emplace_back("are plain data: the schema tag, the build, values by address and spends by gameId", [=]
    {
        std::vector<std::string> out;
        auto engine = played();
        const DurableSave memory = engine->saveDurable();
        if (memory.schema != DURABLE_SCHEMA) out.push_back("the memory's schema is " + memory.schema);
        if (memory.content.project != "conf" || memory.content.version != "0.0.0") out.push_back("the memory carries another build");
        if (showFields(memory.values) != R"({"story.souls":4})") out.push_back("the memory's values are " + showFields(memory.values));
        if (memory.spent != std::vector<std::string>{"relic"}) out.push_back("the memory spent " + show(memory.spent));
        DurableSave pocket = engine->getFlow("alice")->saveDurable();
        if (showFields(pocket.values) != R"({"story.oath":"oak","story.seal":9})") out.push_back("the pocket's values are " + showFields(pocket.values));
        if (pocket.spent != std::vector<std::string>{"once"}) out.push_back("the pocket spent " + show(pocket.spent));
        // Keys in byte order, so the same state writes the same text.
        if (pocket.values.keys() != std::vector<std::string>{"story.oath", "story.seal"}) out.push_back("the pocket's keys are " + show(pocket.values.keys()));
        // A copy: changing it changes nothing in the engine.
        pocket.values.set("story.oath", StoryletValue::Str("iron"));
        if (Show(engine->getFlow("alice")->getProperty("story.oath")) != "\"oak\"") out.push_back("the pocket was not a copy");
        return out;
    });
    checks.emplace_back("survive JSON, which is how a game keeps them", [=]
    {
        std::vector<std::string> out;
        auto engine = played();
        const std::string memory = serializeDurable(engine->saveDurable());
        const std::string pocket = serializeDurable(engine->getFlow("alice")->saveDurable());
        Engine next(bundle);
        if (!next.loadDurable(deserializeDurable(memory)).exact) out.push_back("the memory's load was not exact");
        std::optional<bool> exact;
        OpenFlowOptions opts;
        opts.durable = deserializeDurable(pocket);
        opts.onRestoreReport = [&exact](const LoadReport& r) { exact = r.exact; };
        FlowPtr flow = next.openFlow("alice", opts);
        if (exact != std::optional<bool>(true)) out.push_back("the pocket's open was not reported exact");
        // A `writable: false` value goes back: that flag is the story's
        // promise, and putting a player's own state back is the game speaking.
        if (Show(flow->getProperty("story.seal")) != "9") out.push_back("story.seal is " + Show(flow->getProperty("story.seal")));
        if (serializeDurable(next.saveDurable()) != memory) out.push_back("the memory did not come back as it went");
        if (serializeDurable(flow->saveDurable()) != pocket) out.push_back("the pocket did not come back as it went");
        return out;
    });
    checks.emplace_back("refuse an unknown schema and another project's state before anything moves", [=]
    {
        std::vector<std::string> out;
        auto engine = played();
        const DurableSave memory = engine->saveDurable();
        Engine next(bundle);
        const std::string before = serializeState(next);
        DurableSave schema = memory;
        schema.schema = "storylets/durable@9";
        const std::string a = thrown([&] { next.loadDurable(schema); });
        if (a != "unsupported durable schema: storylets/durable@9") out.push_back("an unknown schema said \"" + a + "\"");
        DurableSave other = memory;
        other.content.project = "other";
        const std::string b = thrown([&] { next.loadDurable(other); });
        if (b != "durable state is for project \"other\", bundle is \"conf\"") out.push_back("another project's said \"" + b + "\"");
        const std::string c = thrown([&] { next.loadDurable(deserializeDurable("[]")); });
        if (c.empty() || c.rfind("not a StoryletError", 0) == 0) out.push_back("a half that is no object said \"" + c + "\"");
        const std::string d = thrown([&] { deserializeDurable("{ not json"); });
        if (d.empty() || d.rfind("not a StoryletError", 0) == 0) out.push_back("malformed text said \"" + d + "\"");
        if (serializeState(next) != before) out.push_back("a refused load changed the engine");
        return out;
    });
    checks.emplace_back("refuse a pocket for another project as the flow opens, leaving the open flow as it was", [=]
    {
        std::vector<std::string> out;
        auto engine = played();
        const DurableSave pocket = engine->getFlow("alice")->saveDurable();
        FlowPtr held = engine->getFlow("alice");
        OpenFlowOptions foreign;
        foreign.durable = pocket;
        foreign.durable->content.project = "other";
        if (thrown([&] { engine->openFlow("alice", foreign); }).empty()) out.push_back("another project's pocket opened");
        if (held->isClosed()) out.push_back("the refusal closed the flow");
        OpenFlowOptions both;
        both.durable = pocket;
        both.restore = engine->saveFlow("alice");
        const std::string said = thrown([&] { engine->openFlow("alice", both); });
        if (said.rfind("openFlow \"alice\": restore and durable cannot be given together", 0) != 0)
        {
            out.push_back("restore with durable said \"" + said + "\"");
        }
        if (held->isClosed()) out.push_back("the second refusal closed the flow");
        if (Show(held->getProperty("story.oath")) != "\"oak\"") out.push_back("story.oath is " + Show(held->getProperty("story.oath")));
        return out;
    });
    checks.emplace_back("make the memory exactly the engine's durable half, and touch nothing else", [=]
    {
        std::vector<std::string> out;
        auto engine = played();
        DurableSave memory = engine->saveDurable();
        // An engine that is NOT fresh: a durable value moved, a run-scoped one too.
        Engine next(bundle);
        FlowPtr bob = next.openFlow("bob");
        bob->setProperty("story.gold", StoryletValue::Num(3));
        next.setProperty("story.souls", StoryletValue::Num(8));
        memory.values = OrderedMap<std::string, StoryletValue>();
        const LoadReport report = next.loadDurable(memory);
        // The memory carries no `souls`, so it takes its default, as the report says.
        if (report.defaultedProperties.size() != 1 || report.defaultedProperties[0].path != "story.souls"
            || !report.defaultedProperties[0].flow.empty())
        {
            out.push_back("defaulted " + propertyKeys(report.defaultedProperties));
        }
        if (Show(next.getProperty("story.souls")) != "0") out.push_back("story.souls is " + Show(next.getProperty("story.souls")));
        if (Show(next.getProperty("story.gold")) != "3") out.push_back("story.gold is " + Show(next.getProperty("story.gold")));
        if (bob->isClosed()) out.push_back("the load closed a flow");
        return out;
    });
    checks.emplace_back("name spends by gameId: an internal id is a card this build does not have", [=]
    {
        std::vector<std::string> out;
        Engine next(bundle);
        DurableSave memory;
        memory.content = bundle->content;
        memory.values.set("story.souls", StoryletValue::Num(1));
        memory.spent = {"c_relic"};
        const std::vector<std::string> byId = next.loadDurable(memory).droppedSpent;
        if (byId != std::vector<std::string>{"c_relic"}) out.push_back("an internal id dropped " + show(byId));
        // And a pocket's spend on the memory's side is not the memory's to carry.
        memory.spent = {"once"};
        const std::vector<std::string> pocketSide = next.loadDurable(memory).droppedSpent;
        if (pocketSide != std::vector<std::string>{"once"}) out.push_back("a pocket's spend dropped " + show(pocketSide));
        return out;
    });
    checks.emplace_back("quote a missing or non-string schema and project as JS prints them", [=]
    {
        std::vector<std::string> out;
        Engine next(bundle);
        const std::pair<const char*, const char*> cases[] = {
            {R"({})", "unsupported durable schema: undefined"},
            {R"({"schema":null})", "unsupported durable schema: null"},
            {R"({"schema":42})", "unsupported durable schema: 42"},
            {R"({"schema":"storylets/durable@1"})", "durable state is for project \"undefined\", bundle is \"conf\""},
            {R"({"schema":"storylets/durable@1","content":{}})", "durable state is for project \"undefined\", bundle is \"conf\""},
            {R"({"schema":"storylets/durable@1","content":{"project":5}})", "durable state is for project \"5\", bundle is \"conf\""},
        };
        for (const auto& c : cases)
        {
            const std::string said = thrown([&] { next.loadDurable(deserializeDurable(c.first)); });
            if (said != c.second) out.push_back(std::string(c.first) + " said \"" + said + "\"");
        }
        return out;
    });
    checks.emplace_back("report a value no property can hold, as JS does, and write nothing for it", [=]
    {
        // The same input the JS reference reports as below: a null or an
        // object fits no declaration (retyped where the address is durable on
        // that side, dropped where it is not), and so does [1] for a number.
        std::vector<std::string> out;
        Engine next(bundle);
        next.setProperty("story.souls", StoryletValue::Num(8));
        const std::string memoryText = R"({"schema":"storylets/durable@1","content":{"project":"conf","version":"0.0.0","hash":""},)"
            R"("values":{"story.souls":null,"story.gone":{},"story.oath":"oak"},"spent":[]})";
        const DurableSave memory = deserializeDurable(memoryText);
        const LoadReport report = next.loadDurable(memory);
        if (propertyKeys(report.droppedProperties) != propertyKeys({{"", "story.gone"}, {"", "story.oath"}}))
        {
            out.push_back("the memory dropped " + propertyKeys(report.droppedProperties));
        }
        if (propertyKeys(report.retypedProperties) != propertyKeys({{"", "story.souls"}}))
        {
            out.push_back("the memory retyped " + propertyKeys(report.retypedProperties));
        }
        if (!report.defaultedProperties.empty()) out.push_back("the memory defaulted " + propertyKeys(report.defaultedProperties));
        if (Show(next.getProperty("story.souls")) != "0") out.push_back("story.souls is " + Show(next.getProperty("story.souls")));
        // Written back out, it still carries the address, so it reports the same.
        if (propertyKeys(Engine(bundle).loadDurable(deserializeDurable(serializeDurable(memory))).retypedProperties)
            != propertyKeys({{"", "story.souls"}}))
        {
            out.push_back("a re-written half lost what it could not read");
        }
        std::optional<LoadReport> opened;
        OpenFlowOptions opts;
        opts.durable = deserializeDurable(R"({"schema":"storylets/durable@1","content":{"project":"conf","version":"0.0.0","hash":""},)"
            R"("values":{"story.oath":null,"story.seal":[1],"story.souls":[]},"spent":[]})");
        opts.onRestoreReport = [&opened](const LoadReport& r) { opened = r; };
        FlowPtr flow = next.openFlow("alice", opts);
        if (!opened.has_value())
        {
            out.push_back("the pocket produced no report");
            return out;
        }
        if (propertyKeys(opened->droppedProperties) != propertyKeys({{"alice", "story.souls"}}))
        {
            out.push_back("the pocket dropped " + propertyKeys(opened->droppedProperties));
        }
        if (propertyKeys(opened->retypedProperties) != propertyKeys({{"alice", "story.oath"}, {"alice", "story.seal"}}))
        {
            out.push_back("the pocket retyped " + propertyKeys(opened->retypedProperties));
        }
        if (!opened->defaultedProperties.empty()) out.push_back("the pocket defaulted " + propertyKeys(opened->defaultedProperties));
        if (Show(flow->getProperty("story.oath")) != "\"iron\"") out.push_back("story.oath is " + Show(flow->getProperty("story.oath")));
        if (Show(flow->getProperty("story.seal")) != "0") out.push_back("story.seal is " + Show(flow->getProperty("story.seal")));
        return out;
    });
    checks.emplace_back("are refused on a closed flow, as every verb is", [=]
    {
        std::vector<std::string> out;
        auto engine = played();
        FlowPtr flow = engine->getFlow("alice");
        engine->closeFlow("alice");
        const std::string said = thrown([&] { flow->saveDurable(); });
        if (said != "flow \"alice\" is closed") out.push_back("a closed flow said \"" + said + "\"");
        return out;
    });
    return checks;
}

/** One list of named checks: each returns its failures, empty is a pass. */
static int runChecks(const char* group,
    const std::vector<std::pair<std::string, std::function<std::vector<std::string>()>>>& checks)
{
    int passed = 0;
    for (const auto& check : checks)
    {
        std::vector<std::string> failures;
        try { failures = check.second(); }
        catch (const std::exception& e) { failures.push_back(std::string("threw: ") + e.what()); }
        if (failures.empty()) ++passed;
        for (const auto& f : failures) fail(group, check.first, f);
    }
    return passed;
}

static int runPortFixes(size_t& total)
{
    const auto checks = portFixChecks();
    total = checks.size();
    return runChecks("port-fixes", checks);
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
        // Corpus version 10 adds the `load` kind; absent on an older corpus.
        static const JsonValue noCases = [] { JsonValue v; v.type = JsonValue::Array; return v; }();
        const JsonValue* loadCases = root.find("load");
        const JsonValue& load = loadCases && loadCases->isArray() ? *loadCases : noCases;

        int e = runExpressions(expressions);
        int sp = runSpecificity(specificity);
        int p = runPeek(peek);
        int s = runScripted(scripted);
        int l = runLoad(load);
        int d = runDescribe(peek);
        int m = runDescribeMaps();
        int sv = runSave(peek);
        size_t liveTotal = 0;
        size_t live = runLiveLink(path, liveLinkDump, liveTotal);
        const oneregistry::Result oneRegistry = oneregistry::Run();
        for (const std::string& f : oneRegistry.failures) fail("one-registry", "engine", f);
        const oneregistry::Result kernelErrors = oneregistry::RunKernelErrors();
        for (const std::string& f : kernelErrors.failures) fail("kernel-errors", "engine", f);
        size_t portFixTotal = 0;
        const int portFixes = runPortFixes(portFixTotal);
        const auto durable = durableChecks();
        const int durablePassed = runChecks("durable", durable);

        std::cout << "corpus version " << version << "\n";
        std::cout << "describeBundle checks: " << d << "/1  project map: " << m << "/1  save round trip: " << sv << "/1\n";
        std::cout << "expressions: " << e << "/" << expressions.arr.size()
            << "  specificity: " << sp << "/" << specificity.arr.size()
            << "  peek: " << p << "/" << peek.arr.size()
            << "  scripted: " << s << "/" << scripted.arr.size()
            << "  load: " << l << "/" << load.arr.size() << "\n";
        std::cout << "live-link fixture: " << live << "/" << liveTotal << " frames\n";
        std::cout << "one registry per game: " << oneRegistry.passed << "/" << oneRegistry.total << "\n";
        std::cout << "kernel errors reach the game as the engine's own: " << kernelErrors.passed << "/" << kernelErrors.total << "\n";
        std::cout << "port fixes (engine review 2026-10): " << portFixes << "/" << portFixTotal << "\n";
        std::cout << "durable halves (ruling H): " << durablePassed << "/" << durable.size() << "\n";

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

        // The registry corpus, vendored from ../expr beside the other two, run through
        // the shared runner against the vendored ScopeRegistry. It is the registry's
        // contract, the `writable` rule included. Absent is a failure here too: the
        // runner reports a missing file as one.
        const std::string registryPath =
            (slash == std::string::npos ? std::string() : path.substr(0, slash + 1)) + "registry-corpus.json";
        const wildwinter::expr::testing::RegistryCorpusResult reg = wildwinter::expr::testing::RunRegistryCorpus(registryPath);
        for (const std::string& f : reg.failures) fail("registry", "corpus", f);
        std::cout << "registry corpus: " << reg.passed << "/" << reg.total << "\n";
        std::cout << (g_fails == 0 ? "ALL PASS" : std::to_string(g_fails) + " FAILED") << "\n";
        return g_fails == 0 ? 0 : 1;
    }
    catch (const std::exception& ex)
    {
        std::cerr << "fatal: " << ex.what() << "\n";
        return 2;
    }
}
