import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(await fs.readFile(path.join(here, "data.json"), "utf8"));
const template = await fs.readFile(path.join(here, "index.template.html"), "utf8");
const html = template.replace(
  "/*__DATA__*/null",
  JSON.stringify(data).replace(/</g, "\\u003c"),
);
await fs.writeFile(path.join(here, "index.html"), html);
console.log(`wrote index.html (${(html.length / 1024).toFixed(0)} kB)`);
