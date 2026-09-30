# The Hamlet (Patter Version)

The Hamlet with its dialogue: the same cards as `../the-hamlet.storylets`, paired
with a Patter project, `../the-hamlet.patter`, that holds a scene for each one.
The Storylet Engine decides which beat happens, and Patter performs it.

The plain Hamlet is the place to start with Storyletter, and it has no Patter in
it. This copy is for seeing the two apps work together:

- Open it in Storyletter and its one box is performed by Patter, so the Board
  plays each card's scene, and **Edit > Edit Scene in Patterpad** opens it.
- Open `../the-hamlet.patter` in Patterpad, and **Edit > Show Card in
  Storyletter** finds its way back here.
- Keep the two folders side by side: the pairing is a relative path
  (Project Settings > General > Patter project).

It publishes to `../storylet-dist/the-hamlet-patter.storyletsc`, which is what
the Hamlet game (`packages/hamlet-client`, and the Godot, Unity and Unreal
Hamlet demos) plays beside Patter's `../patter-dist/the_hamlet.patterc`.

Its cards are kept identical to the plain Hamlet's by a test
(`packages/ops/test/hamlet-twins.test.ts`): change one, change both.
