import { describe, expect, it } from "vitest";

import { DemoApi } from "../src/lib/demo-api";

describe("recursive demo catalog parity", () => {
  it("keeps history, versions, and restore attached to a moved document", async () => {
    const api = new DemoApi();
    const before = await api.getStore();
    const fragment = before.fragments[0]!;
    const original = fragment.content;
    await api.createDirectory("catalog/moved");
    await api.moveDoc("fragment", fragment.name, "catalog/moved");
    const moved = (await api.getStore()).fragments.find((doc) => doc.name === fragment.name)!;
    expect(moved.path).toBe(`catalog/moved/${fragment.name}.yaml`);
    const history = await api.history("fragment", fragment.name);
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(await api.version("fragment", fragment.name, history.at(-1)!.oid)).toBe(original);
    await api.saveDoc("fragment", fragment.name, `${original}# changed\n`);
    await api.restore("fragment", fragment.name, history.at(-1)!.oid);
    expect(
      (await api.getStore()).fragments.find((doc) => doc.name === fragment.name)?.content,
    ).toBe(original);
    expect((await api.getStore()).fragments.find((doc) => doc.name === fragment.name)?.path).toBe(
      moved.path,
    );
  });
});
