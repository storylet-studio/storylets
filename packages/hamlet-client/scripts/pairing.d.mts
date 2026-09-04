// Types for pairing.mjs, so the TypeScript test can import the JavaScript check.
// The client itself is plain JavaScript; only the test is typed.
export function checkPairing(bundle: unknown, patterBundle: unknown, patterBacked: string[]): string[];
export function checkWorld(bundle: unknown, patterBundle: unknown): string[];
