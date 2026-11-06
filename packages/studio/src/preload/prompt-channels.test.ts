// Main's questions reach the editor window over app-shell's prompt channels. The sandboxed preload can't load
// app-shell, so it names the two channels itself: this pins those names to the shell's, so a rename there
// fails here rather than leaving every main-side question unanswered (each would wait out its five minutes).
// Patterpad's test/prompt-channels.test.ts, the same check.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PROMPT_CHANNELS } from "@wildwinter/app-shell/prompt-channels";

const preload = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const main = readFileSync(fileURLToPath(new URL("../main/index.ts", import.meta.url)), "utf8");
const renderer = readFileSync(fileURLToPath(new URL("../renderer/src/renderer.ts", import.meta.url)), "utf8");

describe("the preload's prompt channels", () => {
  it("listens on the shell's ask channel and replies on its reply channel", () => {
    const line = preload.split("\n").find((l) => l.includes("onPrompt:")) ?? "";
    expect(line).toContain(`ipcRenderer.on("${PROMPT_CHANNELS.ask}"`);
    expect(line).toContain(`ipcRenderer.invoke("${PROMPT_CHANNELS.reply}"`);
  });

  it("has both halves wired: main makes the prompt on the editor, the window draws it", () => {
    expect(main).toContain("createWindowPrompt({ window: () => window })");
    expect(renderer).toContain("studio.onPrompt(promptDialog)");
  });
});
