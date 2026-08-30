// Path shapes the renderer needs and `node:path` cannot give it.
//
// Main has `node:path`; a renderer does not, so these are the few pieces it
// has to know itself. Their own file because they are DECISIONS about a
// cross-platform format rather than drawing, and because that makes them
// testable: the bug below shipped precisely because six copies of one
// expression sat in a 2,600-line file nothing could import.

/**
 * The file name at the end of a path, on EITHER platform.
 *
 * Written out as `path.split("/").pop()` in six places until 2026-08-29, which
 * is POSIX-only. The app ships an NSIS Windows target with eight file
 * associations, so on Windows every one of those showed the whole
 * `C:\Users\...\thing.storylets` where a file name was meant: in the welcome
 * screen's recents, in a deck's shard name, and in the four export toasts.
 */
export const baseName = (path: string): string => path.split(/[/\\]/).pop() || path;
