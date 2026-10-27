import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [fullPath] : [];
  }));
  return nested.flat();
}

describe("gameplay determinism guard", () => {
  it("contains no Math.random() or Date.now() calls in packages/rules/src", async () => {
    const srcDirectory = fileURLToPath(new URL("../src/", import.meta.url));
    const files = await sourceFiles(srcDirectory);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (/\bMath\.random\s*\(/.test(source)) violations.push(`${file}: Math.random()`);
      if (/\bDate\.now\s*\(/.test(source)) violations.push(`${file}: Date.now()`);
    }
    expect(violations).toEqual([]);
  });
});
