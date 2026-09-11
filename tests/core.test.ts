import { describe, expect, it } from "vitest";

import { validateDollarPlaceholders, findPlaceholderProvenance } from "../src/core/dollars";
import { deepMergeProfileParts } from "../src/core/merge";
import { buildProfile, type StoreView } from "../src/core/pipeline";
import { PROFILE_FIELDS } from "../src/core/schema";
import { SEED_FILES } from "../src/core/seed";
import type { ProfileDoc } from "../src/core/types";
import {
  validateLauncherJson,
  validateProfileFieldSubset,
  validateTargets,
} from "../src/core/validate";
import { parseYaml, updateYamlPath } from "../src/core/yaml";
import { isDraftDirty } from "../src/core/drafts";

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

describe("source-preserving profile edits", () => {
  it("keeps selection clean and raises dirty only for changed document bytes", () => {
    expect(isDraftDirty("role: reviewer\n", undefined)).toBe(false);
    expect(isDraftDirty("role: reviewer\n", "role: reviewer\n")).toBe(false);
    expect(isDraftDirty("role: reviewer\n", "role: editor\n")).toBe(true);
  });
  it("changes one structured field while preserving comments, order, quoting and list comments", () => {
    const source = `# profile comment\nrole: 'quoted-role'\nimports:\n  - first # keep this item comment\nlayout: |\n  Hello\nvariables:\n  quoted: "still quoted"\ntargets: []\n`;
    const updated = updateYamlPath(
      source,
      "profiles/quoted-role.yaml",
      ["imports"],
      ["first", "second"],
    );
    expect(updated.issues).toEqual([]);
    expect(updated.text).toContain("# profile comment");
    expect(updated.text).toContain("role: 'quoted-role'");
    expect(updated.text).toContain("first # keep this item comment");
    expect(updated.text.indexOf("layout:")).toBeLessThan(updated.text.indexOf("variables:"));
    expect(updated.text).toContain('quoted: "still quoted"');
    expect(parseYaml<ProfileDoc>(updated.text, "profiles/quoted-role.yaml").value?.imports).toEqual(
      ["first", "second"],
    );
  });

  it("leaves invalid YAML byte-for-byte unchanged when structured editing is attempted", () => {
    const source = "role: x\nimports: [broken\n";
    const updated = updateYamlPath(source, "profiles/x.yaml", ["imports"], ["a"]);
    expect(updated.text).toBe(source);
    expect(updated.issues.length).toBeGreaterThan(0);
  });
});

describe("validation", () => {
  it("accepts exactly one governed or standalone target selector", () => {
    expect(
      validateTargets(
        {
          governed: { project: "example-project" },
          standalone: { directory: "./profiles" },
        },
        "targets.yaml",
      ),
    ).toEqual([]);
    expect(
      validateTargets({ both: { project: "example", directory: "./profiles" } }, "targets.yaml"),
    ).toHaveLength(1);
    expect(validateTargets({ neither: {} }, "targets.yaml")).toHaveLength(1);
  });

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
  it("rejects fragment prompt.template instead of silently discarding it, including without a layout", () => {
    const view = seedView({
      fragments: { bad: "prompt:\n  template: lost words\n  mode: replace\n" },
    });
    const built = buildProfile({ role: "x", imports: ["bad"] }, view);
    const issue = built.issues.find((i) => i.field === "prompt.template");
    expect(issue?.file).toBe("catalog/config/bad.yaml");
    expect(issue?.line).toBe(2);
    expect(issue?.message).toContain("would be discarded");
    expect(built.valid).toBe(false);
  });

  it("preserves prompt.mode while rejecting template assignments through overrides and variables", () => {
    const modeOnly = buildProfile(
      { role: "x", layout: "hello", imports: ["mode"] },
      seedView({ fragments: { mode: "prompt:\n  mode: replace\n" } }),
    );
    expect(modeOnly.json).toHaveProperty("prompt.mode", "replace");
    expect(modeOnly.valid).toBe(true);
    const built = buildProfile(
      {
        role: "x",
        variables: { prompt: { template: "lost" } },
        overrides: { prompt: { template: "also lost" } },
      },
      seedView(),
    );
    expect(built.issues.map((i) => i.field)).toEqual(
      expect.arrayContaining(["variables.prompt.template", "overrides.prompt.template"]),
    );
  });

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

  it("reports self and multi-node cycles by name through buildProfile", () => {
    const self = buildProfile(
      { role: "x", layout: "{{> a}}" },
      seedView({ partials: { a: "{{> a}}" } }),
    );
    expect(self.issues.some((i) => i.message.includes("layout -> a -> a"))).toBe(true);
    const multi = buildProfile(
      { role: "x", layout: "{{> a}}" },
      seedView({ partials: { a: "{{> b}}", b: "{{> a}}" } }),
    );
    expect(multi.issues.some((i) => i.message.includes("layout -> a -> b -> a"))).toBe(true);
  });

  it("rejects excessive acyclic template depth before Handlebars renders", () => {
    const partials: Record<string, string> = {};
    for (let i = 0; i < 65; i += 1) partials[`p${i}`] = i === 64 ? "end" : `{{> p${i + 1}}}`;
    const built = buildProfile({ role: "x", layout: "{{> p0}}" }, seedView({ partials }));
    expect(built.issues.some((i) => i.message.includes("exceeds the supported limit"))).toBe(true);
  });

  it("does not confuse a wide shallow graph with excessive depth", () => {
    const partials = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`p${i}`, `${i}`]));
    const layout = Object.keys(partials)
      .map((name) => `{{> ${name}}}`)
      .join(" ");
    const built = buildProfile({ role: "x", layout }, seedView({ partials }));
    expect(built.valid).toBe(true);
  });
});

describe("fragment prompt contributions", () => {
  it("renders declared contributions in import order at explicit placement and strips metadata", () => {
    const built = buildProfile(
      {
        role: "x",
        imports: ["a", "b", "a"],
        layout: "Top\n{{fragmentPrompts}}\nBottom",
        variables: { who: "reader" },
      },
      seedView({
        fragments: {
          a: "autonomy: read_only\npromptText: 'A {{who}}'\n",
          b: "effort: high\npromptText: '{{> words}}'\n",
        },
        partials: { words: "B words" },
      }),
    );
    expect(built.promptText).toBe("Top\nA reader\n\nB words\n\nA reader\nBottom");
    expect(built.json).not.toHaveProperty("promptText");
    expect(built.valid).toBe(true);
  });

  it("warns instead of appending contributions when placement is absent", () => {
    const built = buildProfile(
      { role: "x", imports: ["a"], layout: "Only layout" },
      seedView({ fragments: { a: "promptText: hidden\n" } }),
    );
    expect(built.promptText).toBe("Only layout");
    expect(
      built.issues.some((i) => i.severity === "warning" && i.field === "fragmentPrompts"),
    ).toBe(true);
  });

  it("keeps braces in ordinary fragment strings literal and rejects reserved-name collisions", () => {
    const literal = buildProfile(
      { role: "x", imports: ["a"], layout: "{{settings}}" },
      seedView({ fragments: { a: "settings: 'literal {{not-rendered}}'\n" } }),
    );
    expect(literal.promptText).toBe("literal {{not-rendered}}");
    const collision = buildProfile(
      { role: "x", layout: "x", variables: { fragmentPrompts: "no" } },
      seedView(),
    );
    expect(collision.valid).toBe(false);
  });

  it("rejects direct and partial-reached fragmentPrompts plus contribution cycles", () => {
    const direct = buildProfile(
      { role: "x", imports: ["a"], layout: "{{fragmentPrompts}}" },
      seedView({ fragments: { a: "promptText: '{{fragmentPrompts}}'\n" } }),
    );
    expect(direct.issues.some((i) => i.message.includes("reserved for the profile layout"))).toBe(
      true,
    );
    const cycle = buildProfile(
      { role: "x", imports: ["a"], layout: "{{fragmentPrompts}}" },
      seedView({
        fragments: { a: "promptText: '{{> p}}'\n" },
        partials: { p: "{{> q}}", q: "{{> p}}" },
      }),
    );
    expect(cycle.issues.some((i) => i.message.includes("fragment:a#1 -> p -> q -> p"))).toBe(true);
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
