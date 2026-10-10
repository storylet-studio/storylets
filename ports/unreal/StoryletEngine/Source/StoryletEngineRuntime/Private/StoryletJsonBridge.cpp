#include "StoryletJsonBridge.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

#include "Storylets/JsonValue.h"

namespace
{
	std::string Std(const FString& S) { return std::string(TCHAR_TO_UTF8(*S)); }

	// A JSON object's key, as an FString on either engine: 5.7 keys
	// FJsonObject::Values by FString, and 5.8 by a shared string type with a
	// ToView(). The FString overload wins wherever it applies, so the template
	// is only ever chosen on 5.8 (Patter's fix, word for word).
	FString KeyString(const FString& Key) { return Key; }
	template <typename K> FString KeyString(const K& Key) { return FString(Key.ToView()); }

	storylets::JsonValue Convert(const TSharedPtr<FJsonValue>& V)
	{
		storylets::JsonValue Out;
		if (!V.IsValid()) return Out;   // Null
		switch (V->Type)
		{
			case EJson::Boolean:
				Out = storylets::JsonValue::MakeBool(V->AsBool());
				break;
			case EJson::Number:
				Out = storylets::JsonValue::MakeNum(V->AsNumber());
				break;
			case EJson::String:
				Out = storylets::JsonValue::MakeStr(Std(V->AsString()));
				break;
			case EJson::Array:
			{
				Out = storylets::JsonValue::MakeArr();
				for (const TSharedPtr<FJsonValue>& Item : V->AsArray())
				{
					Out.push(Convert(Item));
				}
				break;
			}
			case EJson::Object:
			{
				Out = storylets::JsonValue::MakeObj();
				const TSharedPtr<FJsonObject> Obj = V->AsObject();
				if (Obj.IsValid())
				{
					// TMap iteration order == insertion order here (the parser
					// only ever adds), so document order carries through.
					for (const auto& KV : Obj->Values)
					{
						Out.set(Std(KeyString(KV.Key)), Convert(KV.Value));
					}
				}
				break;
			}
			default:
				break;   // Null / None -> the default Null tree node
		}
		return Out;
	}
}

bool StoryletJsonToTree(const FString& Json, storylets::JsonValue& OutTree, FString& OutError)
{
	TSharedPtr<FJsonObject> Root;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Json);
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
	{
		OutError = TEXT("not valid JSON");
		return false;
	}
	OutTree = Convert(MakeShared<FJsonValueObject>(Root));
	return true;
}
