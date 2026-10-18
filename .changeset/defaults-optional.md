---
"@storylet-studio/model": minor
---

A declaration's `default` is optional, on `PropertyDecl` and `FieldDecl` alike (the family's rule, ruled 2026-10-18): left out, the type's default holds (false, 0, "", the first enum value, no flags, the first stage), and the compiler writes it onto every declaration in the bundle, so a bundle's declaration always has one.
