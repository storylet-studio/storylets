// The neutral JSON value tree the pure core consumes (bundle loading, AST
// deserialisation). The core depends on no JSON library: hosts build this
// tree from whatever parser they ride (the UE wrapper from FJsonObject, the
// TestHost from its own tiny parser) and hand it in. Object key order is
// preserved (insertion order), because the reference runtime leans on JSON
// document order (bound tag composition, change-write order).
#pragma once

#include <string>
#include <utility>
#include <vector>

#include "Storylets/StoryletValue.h"

namespace storylets
{
    struct JsonValue
    {
        enum Type { Null, Bool, Number, String, Array, Object };

        Type type = Null;
        bool b = false;
        double num = 0;
        std::string str;
        std::vector<JsonValue> arr;
        std::vector<std::pair<std::string, JsonValue>> obj;   // document order preserved

        bool isObject() const { return type == Object; }
        bool isArray() const { return type == Array; }
        bool isString() const { return type == String; }
        bool isNumber() const { return type == Number; }
        bool isBool() const { return type == Bool; }
        bool isNull() const { return type == Null; }

        const JsonValue* find(const std::string& key) const
        {
            for (const auto& kv : obj)
            {
                if (kv.first == key) return &kv.second;
            }
            return nullptr;
        }

        bool has(const std::string& key) const { return find(key) != nullptr; }

        const JsonValue& at(const std::string& key) const
        {
            const JsonValue* v = find(key);
            if (!v) throw StoryletError("missing key: " + key);
            return *v;
        }

        // --- convenience readers (absent / null tolerant) -----------------------

        /** The string at `key`, or `fallback` when absent or not a string. */
        std::string strOr(const std::string& key, const std::string& fallback = "") const
        {
            const JsonValue* v = find(key);
            return v && v->isString() ? v->str : fallback;
        }

        /** The number at `key`, or `fallback` when absent or not a number. */
        double numOr(const std::string& key, double fallback = 0) const
        {
            const JsonValue* v = find(key);
            return v && v->isNumber() ? v->num : fallback;
        }

        /** The bool at `key`, or `fallback` when absent or not a bool. */
        bool boolOr(const std::string& key, bool fallback = false) const
        {
            const JsonValue* v = find(key);
            return v && v->isBool() ? v->b : fallback;
        }

        // --- builders (for hosts assembling a tree) ------------------------------

        static JsonValue MakeStr(std::string s)
        {
            JsonValue v; v.type = String; v.str = std::move(s); return v;
        }
        static JsonValue MakeNum(double n)
        {
            JsonValue v; v.type = Number; v.num = n; return v;
        }
        static JsonValue MakeBool(bool x)
        {
            JsonValue v; v.type = Bool; v.b = x; return v;
        }
        static JsonValue MakeArr()
        {
            JsonValue v; v.type = Array; return v;
        }
        static JsonValue MakeObj()
        {
            JsonValue v; v.type = Object; return v;
        }
        void set(const std::string& key, JsonValue val) { obj.emplace_back(key, std::move(val)); }
        void push(JsonValue val) { arr.push_back(std::move(val)); }
    };
}
