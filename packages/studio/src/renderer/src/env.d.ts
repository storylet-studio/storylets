// Vite's `?raw` modifier hands back a file's text as the default export: the renderer builds the app's
// CHANGELOG.md in that way, for What's New. Ambient, so it covers every directory in this program.
declare module "*?raw" {
  const content: string;
  export default content;
}
