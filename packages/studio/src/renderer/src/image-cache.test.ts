// @vitest-environment jsdom
// The picture cache belongs to one project (the October 2026 review, finding 23):
// two projects can name the same box and file, so another project's picture
// showed through, and a picture that failed once stayed failed until a restart.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** A stand-in for the browser's Image: records what was fetched, and lets the
 *  test say how each load ends. */
class FakeImage {
  static made: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";
  constructor() { FakeImage.made.push(this); }
}

const real = globalThis.Image;
beforeEach(() => { FakeImage.made = []; (globalThis as unknown as { Image: unknown }).Image = FakeImage; });
afterEach(() => { (globalThis as unknown as { Image: unknown }).Image = real; });

const cache = await import("./image-cache.js");
const URL_A = "storylet-asset://project-map/site.png";

describe("the image cache", () => {
  it("stamps the fetch with the project, so the browser's own cache cannot answer for another", () => {
    expect(cache.fetchUrl(URL_A, "/work/village")).toBe(`${URL_A}?project=%2Fwork%2Fvillage`);
    expect(cache.fetchUrl(`${URL_A}?v=12`, "/p")).toBe(`${URL_A}?v=12&project=%2Fp`);
    expect(cache.fetchUrl(URL_A, "")).toBe(URL_A);
  });

  it("forgets everything when the project changes, and nothing when it is said again", () => {
    cache.setImageProject("/work/village");
    expect(cache.imageFor(URL_A)).toBeUndefined();
    FakeImage.made[0]!.onload!();
    expect(cache.imageFor(URL_A)).toBe(FakeImage.made[0]);
    cache.setImageProject("/work/village");
    expect(cache.imageFor(URL_A)).toBe(FakeImage.made[0]);
    cache.setImageProject("/work/hamlet");
    expect(cache.imageFor(URL_A)).toBeUndefined();          // fetched afresh
    expect(FakeImage.made[1]!.src).toContain("hamlet");
  });

  it("does not file a load that finishes after the project changed under the new one", () => {
    cache.setImageProject("/one");
    cache.imageFor(URL_A);
    const late = FakeImage.made[FakeImage.made.length - 1]!;
    cache.setImageProject("/two");
    late.onload!();
    expect(cache.imageFor(URL_A)).toBeUndefined();
  });

  it("looks again for a picture that failed, when a view opens", () => {
    cache.setImageProject("/retry");
    cache.imageFor(URL_A);
    FakeImage.made[FakeImage.made.length - 1]!.onerror!();
    const tried = FakeImage.made.length;
    expect(cache.imageFor(URL_A)).toBeUndefined();
    expect(FakeImage.made.length).toBe(tried);               // remembered as failed
    cache.retryFailedImages();
    cache.imageFor(URL_A);
    expect(FakeImage.made.length).toBe(tried + 1);           // and asked for again
  });
});
