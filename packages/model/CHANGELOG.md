# @storylet-studio/model

## 0.2.0

### Minor Changes

- d7e55c9: `@world` declarations carry an optional `writable` flag (`writable: false` is the story's promise that only the game moves the value), name for name with Patter's `HostScopeDecl.writable`. The compiler refuses a card that writes such a property and every runtime refuses one at run time; Storyletter shows it as the Read-only switch.
