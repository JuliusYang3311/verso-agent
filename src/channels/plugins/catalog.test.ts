import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getChannelPluginCatalogEntry, listChannelPluginCatalogEntries } from "./catalog.js";

describe("channel plugin catalog", () => {
  it("resolves bundled channel plugin metadata by id", () => {
    const entry = getChannelPluginCatalogEntry("feishu");
    expect(entry?.install.npmSpec).toBe("@openclaw/feishu");
    expect(entry?.meta.aliases).toContain("lark");
  });

  it("excludes bundled channel plugins from install catalog", () => {
    const ids = listChannelPluginCatalogEntries().map((entry) => entry.id);
    expect(ids).not.toContain("feishu");
  });

  it("includes external catalog entries", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verso-catalog-"));
    const catalogPath = path.join(dir, "catalog.json");
    fs.writeFileSync(
      catalogPath,
      JSON.stringify({
        entries: [
          {
            name: "@verso/demo-channel",
            verso: {
              channel: {
                id: "demo-channel",
                label: "Demo Channel",
                selectionLabel: "Demo Channel",
                docsPath: "/channels/demo-channel",
                blurb: "Demo entry",
                order: 999,
              },
              install: {
                npmSpec: "@verso/demo-channel",
              },
            },
          },
        ],
      }),
    );

    const ids = listChannelPluginCatalogEntries({ catalogPaths: [catalogPath] }).map(
      (entry) => entry.id,
    );
    expect(ids).toContain("demo-channel");
  });
});
