// A tiny, dependency-free JSON parser over the core's neutral JsonValue tree
// (Storylets/JsonValue.h), which the pure loader, the AST deserialiser and
// the save reader consume directly - the same seam every host feeds.
//
// It lives in the RUNTIME, not the TestHost, so the C++ core can round-trip
// a .storyletsave with no host help at all - the way Patter's Patter/Save.h
// is self-sufficient (design/flows.md, the family-grammar pass). A host with
// its own parser (the UE plugin has FJsonObject) is free to keep using it and
// feed the same JsonValue tree; nothing here is mandatory.
#pragma once

#include <cstdlib>
#include <string>
#include <utility>

#include "Storylets/JsonValue.h"
#include "Storylets/StoryletValue.h"

namespace storylets
{
class JsonParser
{
public:
    // BY VALUE, not by reference. A reference member here is undefined
    // behaviour for the ordinary call `JsonParser p(buffer.str())`: the
    // temporary dies at the end of the constructor's full-expression and every
    // parse afterwards reads freed memory. It happened to work with the corpus
    // and produced an empty string the first time anybody passed a literal.
    explicit JsonParser(std::string text) : s_(std::move(text)), i_(0) {}

    JsonValue parse()
    {
        skipWs();
        JsonValue v = parseValue();
        skipWs();
        if (i_ != s_.size()) err("trailing content");
        return v;
    }

private:
    const std::string s_;
    size_t i_;

    void skipWs()
    {
        while (i_ < s_.size() && (s_[i_] == ' ' || s_[i_] == '\t' || s_[i_] == '\n' || s_[i_] == '\r')) ++i_;
    }
    char peek() const { return i_ < s_.size() ? s_[i_] : '\0'; }
    char next()
    {
        if (i_ >= s_.size()) err("unexpected end of input");
        return s_[i_++];
    }
    [[noreturn]] void err(const std::string& m) const
    {
        throw StoryletError("JSON parse error at " + std::to_string(i_) + ": " + m);
    }

    JsonValue parseValue()
    {
        skipWs();
        char c = peek();
        if (c == '{') return parseObject();
        if (c == '[') return parseArray();
        if (c == '"') return JsonValue::MakeStr(parseString());
        if (c == 't' || c == 'f') return parseBool();
        if (c == 'n')
        {
            expect("null");
            return JsonValue();
        }
        return parseNumber();
    }

    void expect(const char* lit)
    {
        for (const char* p = lit; *p; ++p)
        {
            if (next() != *p) err("expected literal");
        }
    }

    JsonValue parseBool()
    {
        if (peek() == 't')
        {
            expect("true");
            return JsonValue::MakeBool(true);
        }
        expect("false");
        return JsonValue::MakeBool(false);
    }

    JsonValue parseNumber()
    {
        size_t start = i_;
        if (peek() == '-') ++i_;
        while (i_ < s_.size())
        {
            char c = s_[i_];
            if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') ++i_;
            else break;
        }
        if (i_ == start) err("expected a value");
        return JsonValue::MakeNum(std::strtod(s_.substr(start, i_ - start).c_str(), nullptr));
    }

    std::string parseString()
    {
        if (next() != '"') err("expected string");
        std::string out;
        while (i_ < s_.size())
        {
            char c = next();
            if (c == '"') return out;
            if (c == '\\')
            {
                char e = next();
                switch (e)
                {
                    case '"': out += '"'; break;
                    case '\\': out += '\\'; break;
                    case '/': out += '/'; break;
                    case 'n': out += '\n'; break;
                    case 't': out += '\t'; break;
                    case 'r': out += '\r'; break;
                    case 'b': out += '\b'; break;
                    case 'f': out += '\f'; break;
                    case 'u':
                    {
                        // Decode \uXXXX to UTF-8 (BMP only - enough for the corpus).
                        unsigned code = 0;
                        for (int k = 0; k < 4; ++k) code = code * 16 + hexVal(next());
                        appendUtf8(out, code);
                        break;
                    }
                    default: err("unknown escape");
                }
            }
            else
            {
                out += c;
            }
        }
        err("unterminated string");
    }

    int hexVal(char h) const
    {
        if (h >= '0' && h <= '9') return h - '0';
        if (h >= 'a' && h <= 'f') return h - 'a' + 10;
        if (h >= 'A' && h <= 'F') return h - 'A' + 10;
        err("bad hex digit");
    }

    static void appendUtf8(std::string& out, unsigned code)
    {
        if (code < 0x80)
        {
            out += static_cast<char>(code);
        }
        else if (code < 0x800)
        {
            out += static_cast<char>(0xC0 | (code >> 6));
            out += static_cast<char>(0x80 | (code & 0x3F));
        }
        else
        {
            out += static_cast<char>(0xE0 | (code >> 12));
            out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (code & 0x3F));
        }
    }

    JsonValue parseArray()
    {
        JsonValue v = JsonValue::MakeArr();
        next();   // [
        skipWs();
        if (peek() == ']')
        {
            next();
            return v;
        }
        for (;;)
        {
            v.arr.push_back(parseValue());
            skipWs();
            char c = next();
            if (c == ']') break;
            if (c != ',') err("expected , or ]");
            skipWs();
        }
        return v;
    }

    JsonValue parseObject()
    {
        JsonValue v = JsonValue::MakeObj();
        next();   // {
        skipWs();
        if (peek() == '}')
        {
            next();
            return v;
        }
        for (;;)
        {
            skipWs();
            std::string key = parseString();
            skipWs();
            if (next() != ':') err("expected :");
            v.obj.emplace_back(key, parseValue());
            skipWs();
            char c = next();
            if (c == '}') break;
            if (c != ',') err("expected , or }");
        }
        return v;
    }
};
}

