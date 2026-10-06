#!/usr/bin/env node
import { run } from "./main.js";

// The exit CODE, never `process.exit`: exiting at once drops whatever stdout
// has not drained, and on macOS a pipe drains asynchronously, so a piped
// `export -o -` or `--json` stopped at 64 KB (test/pipe.test.ts). Node exits
// with this code once the output is written.
process.exitCode = await run(process.argv.slice(2));
