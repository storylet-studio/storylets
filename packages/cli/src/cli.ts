#!/usr/bin/env node
import { run } from "./main.js";

process.exit(await run(process.argv.slice(2)));
