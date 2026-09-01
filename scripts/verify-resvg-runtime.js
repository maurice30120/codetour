const path = require("node:path");

function fail(message) {
  throw new Error(message);
}

const runtime = process.argv[2];
if (!runtime) {
  fail("Usage: node scripts/verify-resvg-runtime.js <resvg-runtime>");
}

const { Resvg } = require(path.resolve(runtime));
const png = new Resvg(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>',
  {}
).render().asPng();
if (png.readUInt32BE(0) !== 0x89504e47) {
  fail("The rasterizer did not produce a PNG.");
}
