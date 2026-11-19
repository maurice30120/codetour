import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { CODETOUR_KNOWLEDGE_SKILL } from "./knowledge-skill.generated";

// The Markdown under packages/knowledge/skills/ is the readable source of
// truth; the generated module embeds it verbatim so `codetour --install
// copilot` can write the skill without a checkout. These assertions pin the
// workflow promises the ticket requires, not the prose that carries them.
const skillRoot = path.resolve(__dirname, "../../../packages/knowledge/skills/codetour-knowledge");

function skillSource(): string {
  return readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
}

const VALIDATED_CONTEXT_NOTICE =
  "« La Knowledge suivante a été validée pour l’instantané de code étudié. " +
  "Utilise-la comme contexte de référence pour créer le Tour. " +
  "Complète-la par une exploration ciblée uniquement si elle ne suffit pas à " +
  "couvrir la demande ou à construire les étapes. »";

test("the embedded Knowledge skill matches its repository source", () => {
  assert.equal(
    CODETOUR_KNOWLEDGE_SKILL,
    skillSource(),
    "src/cli/knowledge-skill.generated.ts diverges from packages/knowledge/skills; " +
    "run node scripts/embed-knowledge-skill.js"
  );
});

test("the Knowledge skill is user-invocable and triggers on tour requests", () => {
  const source = skillSource();
  assert.match(source, /^---\nname: codetour-knowledge\n/);
  assert.match(source, /\ndescription: .+\n/);
  assert.match(source, /\nuser-invocable: true\n/);
});

test("the workflow pins one explicit workspace root for CLI and MCP calls", () => {
  const source = skillSource();
  assert.match(source, /one explicit workspace root/i);
  assert.match(source, /--workspace "\$WORKSPACE_ROOT"/);
  assert.match(source, /ask the user which one root/i, "an ambiguous workspace must be diagnosed");
  assert.match(source, /unusable|unreadable/i, "an absent workspace must be diagnosed");
  // The MCP call has no separate root: it must be the same one.
  assert.match(source, /same .*workspace root|that exact `\$WORKSPACE_ROOT`/i);
});

test("an absent or empty catalogue means no Knowledge and the tour continues", () => {
  const source = skillSource();
  assert.match(source, /`codetour knowledge list`|codetour knowledge list --workspace/);
  assert.match(source, /`"empty"` \(exit 3\)/);
  assert.match(source, /no Knowledge/);
  assert.match(source, /continue with normal exploration/);
});

test("only valid bodies are reference context and the required notice is literal", () => {
  const source = skillSource();
  assert.ok(
    source.includes(VALIDATED_CONTEXT_NOTICE),
    "the validated-context notice must appear verbatim, including its French punctuation"
  );
  assert.match(source, /Select only the entries/);
  assert.match(source, /codetour knowledge read <name> --workspace/);
  assert.match(source, /Use \*\*ONLY\*\* bodies whose read returned `"valid"`/);
  assert.match(source, /`"invalid"` \(exit 4\)/);
});

test("the skill forbids a systematic re-read and a second anchor pass", () => {
  const source = skillSource();
  assert.match(source, /Do not re-read or re-verify every cited source/);
  assert.match(source, /no second, mandatory anchor-verification pass|Do not run a second, mandatory anchor-verification pass/);
  assert.match(source, /`create_project_tour` validates every anchor/);
  // No instruction may reintroduce what the ticket forbids.
  assert.doesNotMatch(source, /re-read (all|every|each) (cited )?sources? (before|to verify)/i);
  assert.doesNotMatch(source, /verify (all|every|each) (declared )?(proof|anchor)s? yourself/i);
});

test("the skill creates the Tour through the MCP and only claims success after it", () => {
  const source = skillSource();
  assert.match(source, /`create_project_tour`/);
  assert.match(source, /as created only after `create_project_tour` returns success/);
  assert.match(source, /confirmed path/);
  assert.match(source, /A prose answer is not a Tour/);
  assert.match(source, /missing/i);
});

test("the consolidation step reports the CLI status and its limits", () => {
  const source = skillSource();
  assert.match(source, /zero, one or more reusable Knowledge/);
  assert.match(source, /codetour knowledge save --workspace "\$WORKSPACE_ROOT" --proposal/);
  for (const status of ["saved", "no-op", "conflict", "invalid"]) {
    assert.ok(source.includes("`" + status + "`"), `the skill must name the ${status} outcome`);
  }
  assert.match(source, /Never claim an entry was persisted unless the CLI answered `saved`/);
  assert.match(source, /not a guarantee/);
});

test("the skill never invokes the research harness or a Memory Function", () => {
  const source = skillSource();
  assert.match(source, /Never invoke the Research Harness/);
  assert.match(source, /Never create, select or run a Memory Function/);
  assert.match(source, /never require a harness API key/i);
  assert.match(source, /Historical Memory artefacts remain untouched/);
});

test("the skill states that evidence validity is not semantic correctness", () => {
  const source = skillSource();
  assert.match(source, /Evidence validity is not semantic correctness/);
  assert.match(source, /does not prove the body is accurate, complete/);
});
