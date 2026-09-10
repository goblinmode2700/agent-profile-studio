import { describe, expect, it } from "vitest";

import { validateDollarPlaceholders, findPlaceholderProvenance } from "../src/core/dollars";
import { deepMergeProfileParts } from "../src/core/merge";
import { buildProfile, type StoreView } from "../src/core/pipeline";
import { PROFILE_FIELDS } from "../src/core/schema";
import { SEED_FILES } from "../src/core/seed";
import { validateLauncherJson, validateProfileFieldSubset } from "../src/core/validate";
import { parseYaml } from "../src/core/yaml";

function seedView(overrides: Partial<StoreView> = {}): StoreView {
  const pick = (prefix: string, ext: string) =>
    Object.fromEntries(
      SEED_FILES.filter((f) => f.path.startsWith(prefix)).map((f) => [
        f.path.slice(prefix.length, -ext.length),
        f.content,
      ]),
    );
  return {
    fragments: pick("catalog/config/", ".yaml"),
    partials: pick("catalog/prompt/", ".hbs"),
    helpers: pick("catalog/helpers/", ".js"),
    ...overrides,
  };
}

const seedProfile = parseYaml(
  SEED_FILES.find((f) => f.path === "profiles/code-reviewer.yaml")!.content,
  "profiles/code-reviewer.yaml",
).value as Record<string, never>;

describe("deep merge semantics", () => {
  it("merges objects key by key, later wins", () => {
    const merged = deepMergeProfileParts([
      { session: { mode: "new", id: null }, model: "a" },
      { session: { mode: "resume" } },
    ]);
    expect(merged).toEqual({ session: { mode: "resume", id: null }, model: "a" });
  });

  it("replaces plain lists", () => {
    const merged = deepMergeProfileParts([{ tags: ["a", "b", "c"] }, { tags: ["z"] }]);
    expect(merged.tags).toEqual(["z"]);
  });

  it("concatenates extra in order", () => {
    const merged = deepMergeProfileParts([
      { extra: ["--add-dir", "/one"] },
      { extra: ["--add-dir", "/two"] },
      { extra: ["--verbose"] },
    ]);
    expect(merged.extra).toEqual(["--add-dir", "/one", "--add-dir", "/two", "--verbose"]);
  });

  it("applies fragments, then variables, then overrides", () => {
    const merged = deepMergeProfileParts([
      { effort: "low", model: "m" },
      { effort: "medium", review: "spec-03" },
      { effort: "high" },
    ]);
    expect(merged).toEqual({ effort: "high", model: "m", review: "spec-03" });
  });
});

describe("validation", () => {
  it("rejects an unknown field in a fragment, naming file and field", () => {
    const issues = validateProfileFieldSubset(
      { model: "x", temperature: 0.4 },
      "catalog/config/bad.yaml",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].file).toBe("catalog/config/bad.yaml");
    expect(issues[0].field).toBe("temperature");
  });

  it("rejects an unknown field in overrides", () => {
    const issues = validateProfileFieldSubset({ nope: 1 }, "profiles/x.yaml", "overrides");
    expect(issues[0].message).toContain("overrides");
  });

  it("rejects an out-of-enum value", () => {
    expect(validateLauncherJson({ provider: "gemini" }).length).toBeGreaterThan(0);
  });

  it("accepts the launcher output of the seeded profile", () => {
    const built = buildProfile(seedProfile, seedView());
    expect(built.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(validateLauncherJson(built.json)).toEqual([]);
  });

  it("never projects template variables into the launcher JSON", () => {
    const built = buildProfile(seedProfile, seedView());
    expect(Object.keys(built.json!).every((k) => PROFILE_FIELDS.includes(k))).toBe(true);
    expect(built.json).not.toHaveProperty("review");
    expect(built.json).not.toHaveProperty("readout");
    expect(built.renderInput).toHaveProperty("review", "spec-03");
  });
});

describe("dollar placeholders", () => {
  it("allows $project, $cwd and braced forms", () => {
    expect(validateDollarPlaceholders("in $project and ${cwd} only")).toEqual([]);
  });

  it("allows $$ as a literal dollar", () => {
    expect(validateDollarPlaceholders("costs 100$$ per run")).toEqual([]);
  });

  it("rejects an unknown placeholder with line and column", () => {
    const issues = validateDollarPlaceholders("ok\nthen $unknown here");
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(2);
    expect(issues[0].column).toBe(6);
    expect(issues[0].field).toBe("unknown");
  });

  it("rejects a malformed dollar and a malformed braced placeholder", () => {
    expect(validateDollarPlaceholders("50$ off")[0].message).toContain("malformed dollar");
    expect(validateDollarPlaceholders("${not-an-ident}")[0].message).toContain(
      "malformed placeholder",
    );
  });

  it("leaves every dollar in the rendered prompt untouched", () => {
    const built = buildProfile(seedProfile, seedView());
    expect(built.promptText).toContain("$project");
    expect(built.promptText).toContain("$cwd");
    expect(built.promptText).toContain("100$$");
  });

  it("names the partial that contributed a bad placeholder", () => {
    const view = seedView();
    view.partials["readout-contract"] = "Use $unknown please\n";
    const built = buildProfile(seedProfile, view);
    const issue = built.issues.find((i) => i.field === "unknown");
    expect(issue?.partial).toBe("readout-contract");
    expect(issue?.message).toContain("catalog/prompt/readout-contract.hbs");
    expect(built.valid).toBe(false);
  });

  it("provenance ignores escaped dollars", () => {
    expect(findPlaceholderProvenance("x", { a: "$$x", b: "$x" })).toEqual(["b"]);
  });
});

describe("render pipeline", () => {
  it("names a missing partial", () => {
    const view = seedView();
    delete view.partials["write-boundary"];
    const built = buildProfile(seedProfile, view);
    const issue = built.issues.find((i) => i.partial === "write-boundary");
    expect(issue?.message).toContain("catalog/prompt/write-boundary.hbs");
  });

  it("names a missing fragment", () => {
    const built = buildProfile({ ...seedProfile, imports: ["nope"] } as never, seedView());
    expect(built.issues.some((i) => i.message.includes("catalog/config/nope.yaml"))).toBe(true);
  });

  it("loads helpers before rendering", () => {
    const built = buildProfile(seedProfile, seedView());
    expect(built.promptText).toContain("MARKDOWN");
  });

  it("renders ten partials in well under 100ms", () => {
    const view = seedView();
    let layout = "";
    for (let i = 0; i < 10; i += 1) {
      view.partials[`p${i}`] = `Paragraph ${i} for {{review}} in $project.\n`;
      layout += `{{> p${i}}}\n\n`;
    }
    const built = buildProfile({ ...seedProfile, layout } as never, view);
    expect(built.valid).toBe(true);
    expect(built.renderMs).toBeLessThan(100);
  });
});

describe("partial closure", () => {
  it("collects transitively referenced partials", async () => {
    const { partialClosure } = await import("../src/core/render");
    const available = {
      a: "A then {{> b}}",
      b: "B then {{> c}}",
      c: "C",
      unused: "U",
    };
    const closure = partialClosure("{{> a}}", available);
    expect(Object.keys(closure.used).sort()).toEqual(["a", "b", "c"]);
    expect(closure.missing).toEqual([]);
  });

  it("reports a partial that is missing only transitively", async () => {
    const { partialClosure } = await import("../src/core/render");
    const closure = partialClosure("{{> a}}", { a: "A then {{> gone}}" });
    expect(closure.missing).toEqual(["gone"]);
  });

  it("survives a cycle", async () => {
    const { partialClosure } = await import("../src/core/render");
    const closure = partialClosure("{{> a}}", { a: "{{> b}}", b: "{{> a}}" });
    expect(Object.keys(closure.used).sort()).toEqual(["a", "b"]);
  });

  it("names a transitively missing partial in the pipeline", () => {
    const view = seedView();
    view.partials["reader-role"] = "Role text {{> deep-missing}}";
    const built = buildProfile(seedProfile, view);
    expect(built.issues.some((i) => i.partial === "deep-missing")).toBe(true);
    expect(built.valid).toBe(false);
  });
});
