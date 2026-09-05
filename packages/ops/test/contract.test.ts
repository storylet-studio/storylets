// ---------------------------------------------------------------------------
// The installation contract's checks (design/engine-server.md 4.11, net 1).
// Expectations hand-written from what the design promises:
//
//   - a venue depends on NAMES, and a rename is an ERROR, not a warning
//   - every message names the dependency AND the installation, because a
//     refusal that does not say who cares is one that gets worked around
//   - the break is anchored where it can be fixed when the entity is still
//     there, and at the contract when the name has gone entirely
//   - a project with no contract is unchanged in every respect
//
// Authoring-side, so it is pinned here and not in the conformance corpus: the
// contract never compiles and no runtime has ever heard of it.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { CONTRACT_SCHEMA } from "@storylet-studio/model";
import type { ContractShard, FieldDecl, PropertyDecl } from "@storylet-studio/model";
import type { SourceProject } from "@storylet-studio/compiler";
import { contractNotes } from "../src/contract.js";
import { runValidate } from "../src/validate.js";
import type { LoadedProject } from "../src/load.js";

interface Fix {
  contracts?: ContractShard[];
  /** The one box's gameId, so a rename can be simulated by changing it. */
  box?: string;
  turn?: { seconds: number };
  hand?: string;
  story?: PropertyDecl[];
  fields?: FieldDecl[];
}

const contract = (over: Partial<ContractShard> = {}): ContractShard => ({
  schema: CONTRACT_SCHEMA,
  installation: "the-park",
  by: "Storylet Server 0.1.0",
  revision: 12,
  ...over,
});

const project = (f: Fix): SourceProject => ({
  path: "p.storyletproj",
  project: {
    schema: "storylets/project@0",
    project: { id: "p", name: "P", version: "0.0.1" },
    settings: { playAdvancesTurns: 1, play: "venue" },
    world: { properties: [] },
    story: { properties: f.story ?? [] },
    templates: {},
    export: { bundle: "d.storyletsc", metadata: "full" },
  },
  boxes: [{
    path: "street",
    box: {
      schema: "storylets/box@0",
      box: {
        id: "b_1", gameId: f.box ?? "street", ranking: { specificity: true },
        ...(f.turn !== undefined ? { turn: f.turn } : {}),
        fields: f.fields ?? [{ name: "prompt", type: "string", default: "" }],
        properties: [],
      },
    },
    tags: { schema: "storylets/tags@0", groups: [] },
    hands: {
      schema: "storylets/hands@0", templates: [],
      hands: [{ id: "h_1", gameId: f.hand ?? "the-forge", rule: { bindings: {}, slots: "unbounded" } }],
    },
    decks: [],
  }],
  contracts: (f.contracts ?? []).map((shard, i) => ({
    path: `contracts/c${i + 1}.storyletcontract`, shard,
  })),
});

const check = (f: Fix) => runValidate(
  { dir: "/p", files: [], sidecars: [], issues: [], source: project(f) } as unknown as LoadedProject,
  { checkBundle: false },
).issues.filter((i) => /at the-park|at the-pier|one installation, one contract/.test(i.message));

describe("a project with no contract", () => {
  it("says nothing at all: the checks exist only where a venue does", () => {
    expect(check({ turn: { seconds: 60 } })).toEqual([]);
  });
});

describe("a contracted hand", () => {
  const bound = [contract({ hands: ["the-forge"] })];

  it("is fine while it is still there", () => {
    expect(check({ contracts: bound })).toEqual([]);
  });

  it("is an ERROR when it is renamed, naming the station and the venue", () => {
    const issues = check({ contracts: bound, hand: "the-smithy" });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.message).toBe(
      'hand "the-forge" is bound by a station at the-park; it may not be renamed or removed');
    // The name has gone, so there is no hands shard that would fix it: the
    // contract is the other end of the break and is where this points.
    expect(issues[0]!.path).toBe("contracts/c1.storyletcontract");
  });
});

describe("a contracted timed box", () => {
  const ticked = [contract({ boxes: { street: { turn: 60 } } })];

  it("is fine while its unit is what the venue was provisioned against", () => {
    expect(check({ contracts: ticked, turn: { seconds: 60 } })).toEqual([]);
  });

  it("is an error when the unit changes, and says what that costs", () => {
    const issues = check({ contracts: ticked, turn: { seconds: 30 } });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("every 60s, not 30s");
    expect(issues[0]!.message).toContain("changes what every rest on its cards means");
    // The box is still there, so this is anchored where it can be fixed.
    expect(issues[0]!.path).toBe("street/box");
  });

  it("is an error when the box stops being timed at all", () => {
    const issues = check({ contracts: ticked });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("may not stop being a timed box");
    expect(issues[0]!.path).toBe("street/box");
  });

  it("is an error when the box is renamed", () => {
    const issues = check({ contracts: ticked, turn: { seconds: 60 }, box: "the-street" });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('box "street" is ticked by the scheduler at the-park');
    expect(issues[0]!.path).toBe("contracts/c1.storyletcontract");
  });
});

describe("a contracted property", () => {
  const visits: PropertyDecl[] = [{ name: "visits", type: "number", default: 0 }];

  it("is addressed the way listProperties prints it, with no @", () => {
    expect(check({ contracts: [contract({ properties: ["story.visits"] })], story: visits })).toEqual([]);
  });

  it("is an error when it is gone", () => {
    const issues = check({ contracts: [contract({ properties: ["story.visits"] })] });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe(
      'property "story.visits" is carried in pockets at the-park; it may not be renamed or removed');
  });

  it("is an error when its TYPE changed under it, anchored at the declaration", () => {
    const issues = check({
      contracts: [contract({ properties: [{ path: "story.visits", type: "number" }] })],
      story: [{ name: "visits", type: "string", default: "" }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("as number, and is now string");
    expect(issues[0]!.path).toBe("p.storyletproj");
  });

  it("says nothing about a type the contract never recorded", () => {
    expect(check({
      contracts: [contract({ properties: ["story.visits"] })],
      story: [{ name: "visits", type: "string", default: "" }],
    })).toEqual([]);
  });
});

describe("a contracted card field", () => {
  it("is fine while some box declares it", () => {
    expect(check({ contracts: [contract({ fields: ["prompt"] })] })).toEqual([]);
  });

  it("is an error when no box declares it any more", () => {
    const issues = check({ contracts: [contract({ fields: ["cue"] })] });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe(
      'card field "cue" is read by the crew at the-park; no box declares it any more');
  });
});

describe("two contracts for one installation", () => {
  it("is an error: the tools would have to guess which set of names is live", () => {
    const issues = check({ contracts: [contract({ hands: ["the-forge"] }), contract({ hands: ["the-forge"] })] });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("one installation, one contract");
    expect(issues[0]!.path).toBe("contracts/c2.storyletcontract");
  });

  it("is fine for two DIFFERENT venues, which is what a touring project is", () => {
    expect(check({
      contracts: [
        contract({ hands: ["the-forge"] }),
        contract({ installation: "the-pier", hands: ["the-forge"] }),
      ],
    })).toEqual([]);
  });
});

describe("the lines an editor shows", () => {
  it("says what depends on each entity, in the density grammar", () => {
    const notes = contractNotes(project({
      contracts: [contract({
        hands: ["the-forge"], boxes: { street: { turn: 60 } },
        properties: ["story.visits"], fields: ["prompt"],
      })],
    }));
    expect(notes.get("hand:the-forge")!.map((n) => n.line))
      .toEqual(["Bound at the-park: a station deals this hand"]);
    expect(notes.get("box:street")!.map((n) => n.line)).toEqual(["Ticked at the-park every 60s"]);
    expect(notes.get("property:story.visits")!.map((n) => n.line)).toEqual(["Carried in pockets at the-park"]);
    expect(notes.get("field:prompt")!.map((n) => n.line)).toEqual(["Read by the crew at the-park"]);
    expect(notes.get("hand:the-well")).toBeUndefined();
  });

  it("gathers every venue that depends on one entity, for a touring project", () => {
    const notes = contractNotes(project({
      contracts: [
        contract({ hands: ["the-forge"] }),
        contract({ installation: "the-pier", hands: ["the-forge"] }),
      ],
    }));
    expect(notes.get("hand:the-forge")!.map((n) => n.installation)).toEqual(["the-park", "the-pier"]);
  });
});
