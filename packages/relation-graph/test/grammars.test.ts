import test from "node:test";
import assert from "node:assert/strict";
import { Query } from "web-tree-sitter";
import { getParser, loadGrammar, packQueryFor, GRAMMAR_IDS } from "../src/index";

const SAMPLES: Record<string, string> = {
  c_sharp: "class A { public int F() { return 1; } }\n",
  java: "class A { int f() { return 1; } }\n",
  typescript: "class A { f(): number { return 1; } }\n",
  tsx: "export const A = () => <div>{1}</div>;\n",
  python: "class A:\n    def f(self):\n        return 1\n"
};

test("the five prebuilt tree-sitter-wasms grammars load in-process via web-tree-sitter", async () => {
  assert.deepEqual(
    [...GRAMMAR_IDS].sort(),
    ["c_sharp", "java", "python", "tsx", "typescript"]
  );
  const parser = await getParser();
  for (const grammarId of GRAMMAR_IDS) {
    const language = await loadGrammar(grammarId);
    parser.setLanguage(language);
    const tree = parser.parse(SAMPLES[grammarId]);
    assert.ok(tree, `${grammarId} sample must parse`);
    assert.equal(tree.rootNode.hasError, false, `${grammarId} sample must parse cleanly`);
    assert.ok(packQueryFor(grammarId).length > 0, `${grammarId} must have an extraction query`);
  }
});

test("getParser initializes the runtime once and reuses it", async () => {
  const a = await getParser();
  const b = await getParser();
  assert.equal(a, b);
});

test("the default pack query captures declarations and calls on each grammar", async () => {
  const parser = await getParser();
  const rich: Record<string, string> = {
    ...SAMPLES,
    typescript:
      "class G { m(): number { return this.m(); } }\nfunction top(): number { return 1; }\nconst g = new G();\ntop();\n",
    python: "class G:\n    def m(self):\n        return self.m()\ndef top():\n    return 1\ng = G()\ntop()\n",
    java: "class G { int m() { return this.m(); } }\nclass M { static int top() { G g = new G(); return top(); } }\n",
    c_sharp:
      "class G { public int M() { return this.M(); } }\nclass P { static int Top() { var g = new G(); return Top(); } }\n",
    tsx:
      "class G { m(): number { return this.m(); } }\nexport const A = () => <div>{1}</div>;\nconst g = new G();\nfunction top(): number { return 1; }\ntop();\n"
  };
  for (const grammarId of GRAMMAR_IDS) {
    const language = await loadGrammar(grammarId);
    parser.setLanguage(language);
    const tree = parser.parse(rich[grammarId]);
    assert.ok(tree, `${grammarId} rich sample must parse`);
    const query = new Query(language, packQueryFor(grammarId));
    const names = new Set(query.captures(tree.rootNode).map(c => c.name));
    for (const expected of ["class.name", "class.decl", "call"]) {
      assert.ok(names.has(expected), `${grammarId} query must capture @${expected}`);
    }
  }
});
