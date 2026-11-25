import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

// Every generated Tour is validated against this package's schema.json, while
// the editor validates the files it authors against the extension's
// `codetour/schema.json`. Nothing else compares the two copies, so a drift
// would silently accept or reject different Tours in the two surfaces.
test("the shipped Tour schema stays identical to the extension's authoring schema", () => {
  const shipped = path.resolve(__dirname, "..", "..", "..", "schema.json");
  const authoring = path.resolve(__dirname, "..", "..", "..", "..", "..", "schema.json");
  assert.equal(fs.readFileSync(shipped, "utf8"), fs.readFileSync(authoring, "utf8"));
});
