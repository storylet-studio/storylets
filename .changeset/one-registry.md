---
"@storylet-studio/model": minor
---

One registry per game. `SAVE_SCHEMA` is `storylets/save@2`: `SaveEnvelope` holds what is not a property, plus the engine's own registry's values under an optional `registry`, and `SharedSave.props` and `FlowSave.props` are optional (a flow parked by `saveFlow` still carries its own). The version 1 shape is kept as `SaveEnvelopeV1` with `SAVE_SCHEMA_V1` for readers, and `SaveFile.engine` takes either. Registry keys for the engine's bags are documented beside the types.
