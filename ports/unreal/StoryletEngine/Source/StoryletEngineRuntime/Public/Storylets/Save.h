// The save-file string boundary for the C++ core: the .storyletsave FILE
// (storylets/savefile@1 - the HOST's wrapper: the engine's envelope plus, when
// the host keeps one, its @world container; design/flows.md).
//
// Pure std, self-sufficient, and PUBLIC - the parity member every runtime
// carries under the same two names (serializeState / deserializeState; JS
// play-helpers, Unity StoryletSave, Godot StoryletSave, and Patter's own
// Patter/Save.h). It used to live UE-side under different names, which meant
// the clang TestHost never exercised it and two faults in it reached an
// Unreal build before anything noticed.
//
// A host with its own JSON parser (the UE plugin has FJsonObject) may parse
// to a JsonValue itself and call the tree overloads; nothing here is
// mandatory.
#pragma once

#include <stdexcept>
#include <string>
#include <vector>

#include "Storylets/Bundle.h"
#include "Storylets/Engine.h"
#include "Storylets/JsonParse.h"
#include "Storylets/JsonValue.h"
#include "Storylets/StoryletValue.h"

namespace storylets
{
    namespace savedetail
    {
            // --- writing (the TS SaveEnvelope wire shape, 2-space pretty print) -----

            inline void Indent(std::string& Out, int Depth)
            {
                Out.append(static_cast<size_t>(Depth) * 2, ' ');
            }

            /** JSON.stringify-parity number token (integral doubles without a decimal
             *  point; the shortest round-tripping form otherwise). */
            inline std::string NumToken(double N) { return StoryletValue::JsNumber(N); }

            inline std::string ValueToken(const StoryletValue& V) { return V.toJsonString(); }

            inline void WriteBag(std::string& Out, const OrderedMap<std::string, StoryletValue>& Bag, int Depth)
            {
                if (Bag.size() == 0) { Out += "{}"; return; }
                Out += "{\n";
                bool bFirst = true;
                for (const auto& Pair : Bag)
                {
                    if (!bFirst) Out += ",\n";
                    bFirst = false;
                    Indent(Out, Depth + 1);
                    Out += StoryletValue::JsonQuote(Pair.first) + ": " + ValueToken(Pair.second);
                }
                Out += "\n";
                Indent(Out, Depth);
                Out += "}";
            }

            inline void WriteKind(std::string& Out,
                const OrderedMap<std::string, OrderedMap<std::string, StoryletValue>>& Kind, int Depth)
            {
                if (Kind.size() == 0) { Out += "{}"; return; }
                Out += "{\n";
                bool bFirst = true;
                for (const auto& Pair : Kind)
                {
                    if (!bFirst) Out += ",\n";
                    bFirst = false;
                    Indent(Out, Depth + 1);
                    Out += StoryletValue::JsonQuote(Pair.first) + ": ";
                    WriteBag(Out, Pair.second, Depth + 1);
                }
                Out += "\n";
                Indent(Out, Depth);
                Out += "}";
            }

            inline void WriteNumberMap(std::string& Out, const OrderedMap<std::string, double>& Map, int Depth)
            {
                if (Map.size() == 0) { Out += "{}"; return; }
                Out += "{\n";
                bool bFirst = true;
                for (const auto& Pair : Map)
                {
                    if (!bFirst) Out += ",\n";
                    bFirst = false;
                    Indent(Out, Depth + 1);
                    Out += StoryletValue::JsonQuote(Pair.first) + ": " + NumToken(Pair.second);
                }
                Out += "\n";
                Indent(Out, Depth);
                Out += "}";
            }

            inline void WritePartition(std::string& Out, const PropsPartition& P, int Depth)
            {
                Out += "{\n";
                Indent(Out, Depth + 1); Out += "\"story\": "; WriteBag(Out, P.story, Depth + 1); Out += ",\n";
                Indent(Out, Depth + 1); Out += "\"box\": "; WriteKind(Out, P.box, Depth + 1); Out += ",\n";
                Indent(Out, Depth + 1); Out += "\"deck\": "; WriteKind(Out, P.deck, Depth + 1); Out += ",\n";
                Indent(Out, Depth + 1); Out += "\"hand\": "; WriteKind(Out, P.hand, Depth + 1); Out += ",\n";
                Indent(Out, Depth + 1); Out += "\"value\": "; WriteKind(Out, P.value, Depth + 1); Out += "\n";
                Indent(Out, Depth);
                Out += "}";
            }

            inline void WriteFlow(std::string& Out, const FlowSave& F, int Depth)
            {
                Out += "{\n";
                Indent(Out, Depth + 1); Out += "\"props\": "; WritePartition(Out, F.props, Depth + 1); Out += ",\n";
                Indent(Out, Depth + 1); Out += "\"turns\": "; WriteNumberMap(Out, F.turns, Depth + 1); Out += ",\n";
                Indent(Out, Depth + 1); Out += "\"prng\": " + NumToken(static_cast<double>(F.prng)) + ",\n";
                Indent(Out, Depth + 1); Out += "\"cooldowns\": "; WriteNumberMap(Out, F.cooldowns, Depth + 1); Out += ",\n";
                Indent(Out, Depth + 1); Out += "\"board\": ";
                if (F.board.size() == 0)
                {
                    Out += "{}";
                }
                else
                {
                    Out += "{\n";
                    bool bFirst = true;
                    for (const auto& Pair : F.board)
                    {
                        if (!bFirst) Out += ",\n";
                        bFirst = false;
                        Indent(Out, Depth + 2);
                        Out += StoryletValue::JsonQuote(Pair.first) + ": [";
                        for (size_t i = 0; i < Pair.second.size(); ++i)
                        {
                            if (i > 0) Out += ", ";
                            Out += StoryletValue::JsonQuote(Pair.second[i]);
                        }
                        Out += "]";
                    }
                    Out += "\n";
                    Indent(Out, Depth + 1);
                    Out += "}";
                }
                Out += ",\n";
                Indent(Out, Depth + 1);
                Out += "\"playLog\": [";
                if (!F.playLog.empty())
                {
                    Out += "\n";
                    for (size_t i = 0; i < F.playLog.size(); ++i)
                    {
                        const PlayRecord& R = F.playLog[i];
                        Indent(Out, Depth + 2);
                        Out += "{ \"card\": " + StoryletValue::JsonQuote(R.card)
                            + ", \"outcome\": " + StoryletValue::JsonQuote(R.outcome)
                            + ", \"turn\": " + NumToken(R.turn) + " }";
                        Out += (i + 1 < F.playLog.size()) ? ",\n" : "\n";
                    }
                    Indent(Out, Depth + 1);
                }
                Out += "]\n";
                Indent(Out, Depth);
                Out += "}";
            }

            inline std::string EnvelopeToJson(const SaveEnvelope& Env, const OrderedMap<std::string, StoryletValue>& World)
            {
                // The .storyletsave FILE is the HOST's wrapper (storylets/savefile@1,
                // design/flows.md): the engine's envelope plus the host's @world
                // container - which for this wrapper is the engine's self-backed
                // values, so a file round trip preserves them.
                std::string Out = "{\n";
                Indent(Out, 1);
                Out += "\"schema\": " + StoryletValue::JsonQuote(SAVEFILE_SCHEMA) + ",\n";
                Indent(Out, 1);
                Out += "\"engine\": {\n";
                Indent(Out, 2);
                Out += "\"schema\": " + StoryletValue::JsonQuote(Env.schema) + ",\n";
                Indent(Out, 2);
                Out += "\"content\": {\n";
                Indent(Out, 3);
                Out += "\"project\": " + StoryletValue::JsonQuote(Env.content.project) + ",\n";
                Indent(Out, 3);
                Out += "\"version\": " + StoryletValue::JsonQuote(Env.content.version) + ",\n";
                Indent(Out, 3);
                Out += "\"hash\": " + StoryletValue::JsonQuote(Env.content.hash) + "\n";
                Indent(Out, 2);
                Out += "},\n";
                Indent(Out, 2);
                Out += "\"shared\": {\n";
                Indent(Out, 3);
                Out += "\"props\": ";
                WritePartition(Out, Env.shared.props, 3);
                Out += ",\n";
                Indent(Out, 3);
                Out += "\"spent\": [";
                for (size_t i = 0; i < Env.shared.spent.size(); ++i)
                {
                    if (i) Out += ", ";
                    Out += StoryletValue::JsonQuote(Env.shared.spent[i]);
                }
                Out += "]\n";
                Indent(Out, 2);
                Out += "},\n";
                Indent(Out, 2);
                Out += "\"flows\": ";
                if (Env.flows.size() == 0)
                {
                    Out += "{}";
                }
                else
                {
                    Out += "{\n";
                    bool bFirst = true;
                    for (const auto& Pair : Env.flows)
                    {
                        if (!bFirst) Out += ",\n";
                        bFirst = false;
                        Indent(Out, 3);
                        Out += StoryletValue::JsonQuote(Pair.first) + ": ";
                        WriteFlow(Out, Pair.second, 3);
                    }
                    Out += "\n";
                    Indent(Out, 2);
                    Out += "}";
                }
                Out += "\n";
                Indent(Out, 1);
                Out += "},\n";
                Indent(Out, 1);
                Out += "\"world\": ";
                WriteBag(Out, World, 1);
                Out += "\n}";
                return Out;
            }

            // --- reading (neutral JsonValue tree -> envelope) ------------------------

            inline OrderedMap<std::string, StoryletValue> ParseBag(const JsonValue* Token)
            {
                OrderedMap<std::string, StoryletValue> Bag;
                if (!Token || !Token->isObject()) return Bag;
                for (const auto& Pair : Token->obj)
                {
                    Bag.set(Pair.first, bundleloader::ToValue(Pair.second));
                }
                return Bag;
            }

            inline OrderedMap<std::string, OrderedMap<std::string, StoryletValue>> ParseKind(const JsonValue* Token)
            {
                OrderedMap<std::string, OrderedMap<std::string, StoryletValue>> Kind;
                if (!Token || !Token->isObject()) return Kind;
                for (const auto& Pair : Token->obj)
                {
                    Kind.set(Pair.first, ParseBag(&Pair.second));
                }
                return Kind;
            }

            inline PropsPartition PartitionFromTree(const JsonValue* Token)
            {
                PropsPartition P;
                if (!Token || !Token->isObject()) return P;
                P.story = ParseBag(Token->find("story"));
                P.box = ParseKind(Token->find("box"));
                P.deck = ParseKind(Token->find("deck"));
                P.hand = ParseKind(Token->find("hand"));
                P.value = ParseKind(Token->find("value"));
                return P;
            }

            inline FlowSave FlowFromTree(const JsonValue& Tree)
            {
                FlowSave F;
                F.props = PartitionFromTree(Tree.find("props"));
                const JsonValue* Turns = Tree.find("turns");
                if (Turns && Turns->isObject())
                {
                    for (const auto& Pair : Turns->obj) F.turns.set(Pair.first, Pair.second.num);
                }
                F.prng = static_cast<uint32_t>(Tree.numOr("prng", 0));
                const JsonValue* Cooldowns = Tree.find("cooldowns");
                if (Cooldowns && Cooldowns->isObject())
                {
                    for (const auto& Pair : Cooldowns->obj) F.cooldowns.set(Pair.first, Pair.second.num);
                }
                const JsonValue* Board = Tree.find("board");
                if (Board && Board->isObject())
                {
                    for (const auto& Pair : Board->obj)
                    {
                        std::vector<std::string> Ids;
                        for (const auto& Id : Pair.second.arr) Ids.push_back(Id.str);
                        F.board.set(Pair.first, std::move(Ids));
                    }
                }
                const JsonValue* PlayLog = Tree.find("playLog");
                if (PlayLog && PlayLog->isArray())
                {
                    for (const auto& Item : PlayLog->arr)
                    {
                        PlayRecord Record;
                        Record.card = Item.strOr("card");
                        Record.outcome = Item.strOr("outcome");
                        Record.turn = Item.numOr("turn", 0);
                        F.playLog.push_back(std::move(Record));
                    }
                }
                return F;
            }

            inline SaveEnvelope EnvelopeFromTree(const JsonValue& Tree)
            {
                SaveEnvelope Env;
                const JsonValue* Content = Tree.find("content");
                if (Content && Content->isObject())
                {
                    Env.content.project = Content->strOr("project");
                    Env.content.version = Content->strOr("version");
                    Env.content.hash = Content->strOr("hash");
                }
                const JsonValue* Shared = Tree.find("shared");
                if (Shared && Shared->isObject())
                {
                    Env.shared.props = PartitionFromTree(Shared->find("props"));
                    const JsonValue* Spent = Shared->find("spent");
                    if (Spent && Spent->isArray())
                    {
                        for (const auto& Id : Spent->arr) Env.shared.spent.push_back(Id.str);
                    }
                }
                const JsonValue* Flows = Tree.find("flows");
                if (Flows && Flows->isObject())
                {
                    for (const auto& Pair : Flows->obj)
                    {
                        Env.flows.set(Pair.first, FlowFromTree(Pair.second));
                    }
                }
                return Env;
            }
    }

    /** The engine's whole state (and the host's @world values, if it keeps
     *  any) as pretty-printed .storyletsave text. */
    inline std::string serializeState(
        const Engine& engine,
        const OrderedMap<std::string, StoryletValue>& world = {})
    {
        return savedetail::EnvelopeToJson(engine.saveGame(), world);
    }

    /** Restore an engine from a PARSED .storyletsave tree - the twin of
     *  deserializeState below, which does the same from text.
     *
     *  Patterplay's pairing, confirmed against `patter/Save.h` and its three
     *  siblings on 2026-08-29: saveState / loadState work on the parsed
     *  object, serializeState / deserializeState work on TEXT. This port
     *  already had the family shape; the JS reference did not, and was brought
     *  into line rather than the other way round.
     *
     *  Throws StoryletError on a foreign or malformed file, or a save for
     *  another project - before any mutation, so a refused load leaves the
     *  engine exactly as it was. Returns the file's @world values for the HOST
     *  to apply: the engine never carries them (design/flows.md). */
    inline OrderedMap<std::string, StoryletValue> loadState(Engine& engine, const JsonValue& tree)
    {
        const JsonValue* engineTree = tree.find("engine");
        if (tree.strOr("schema") != SAVEFILE_SCHEMA
            || !engineTree || !engineTree->isObject()
            || engineTree->strOr("schema") != SAVE_SCHEMA)
        {
            throw StoryletError(std::string("not a storylets save (expected schema \"") + SAVEFILE_SCHEMA + "\")");
        }
        engine.loadGame(savedetail::EnvelopeFromTree(*engineTree));
        const JsonValue* world = tree.find("world");
        return world && world->isObject() ? savedetail::ParseBag(world)
            : OrderedMap<std::string, StoryletValue>{};
    }

    /** Parse + restore .storyletsave TEXT: the text twin of loadState. Throws
     *  StoryletError on malformed text, exactly as loadState does on a
     *  malformed file. */
    inline OrderedMap<std::string, StoryletValue> deserializeState(Engine& engine, const std::string& json)
    {
        JsonValue tree;
        try
        {
            tree = JsonParser(json).parse();
        }
        catch (const std::exception&)
        {
            throw StoryletError("not valid JSON");
        }
        return loadState(engine, tree);
    }
}
