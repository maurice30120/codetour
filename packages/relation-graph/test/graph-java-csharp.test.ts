import test from "node:test";
import assert from "node:assert/strict";
import { buildRelationGraph } from "../src/index";

test("a Java fixture produces a graph in the #149 format (this-call and new resolve)", async () => {
  const graph = await buildRelationGraph(
    [
      {
        path: "Greeter.java",
        content: `class Greeter {
  String greet(String name) { return "hi " + name; }
  String twice() { return this.greet("x"); }
}
class Main {
  public static void main(String[] args) {
    Greeter g = new Greeter();
    g.greet("bob");
  }
}
`
      }
    ],
    "java"
  );
  assert.equal(graph.status, "resolved");
  const greet = graph.nodes.find(n => n.name === "Greeter.greet");
  const twice = graph.nodes.find(n => n.name === "Greeter.twice");
  const ctor = graph.nodes.find(n => n.name === "Greeter.constructor");
  const main = graph.nodes.find(n => n.name === "Main.main");
  assert.ok(greet && twice && ctor && main);

  const thisCall = graph.edges.find(e => e.from === twice.id && e.to === greet.id);
  assert.ok(thisCall, "this.greet must resolve to Greeter.greet");
  assert.equal(thisCall.kind, "call");
  assert.equal(thisCall.callType, "direct");
  assert.equal(thisCall.status, "resolved");
  assert.equal(thisCall.line, 3);

  const newEdge = graph.edges.find(e => e.from === main.id && e.to === ctor.id);
  assert.ok(newEdge, "new Greeter() must be a new edge to Greeter.constructor");
  assert.equal(newEdge.kind, "new");
  assert.equal(newEdge.callType, "new");
  assert.equal(newEdge.status, "resolved");
  assert.equal(newEdge.line, 7);

  // g.greet("bob"): unknown receiver type -> ambiguity site with candidates.
  const site = graph.sites.find(s => s.name === "greet" && s.file === "Greeter.java" && s.line === 8);
  assert.ok(site, "expected an ambiguity site for g.greet");
  assert.equal(site.status, "ambiguous");
  assert.deepEqual(site.candidates, ["Greeter.greet"]);
  assert.equal(site.caller, "Main.main");
});

test("a C# fixture produces a graph in the #149 format (base call is a super edge)", async () => {
  const graph = await buildRelationGraph(
    [
      {
        path: "Program.cs",
        content: `class Greeter {
  public string Greet(string name) { return "hi " + name; }
}
class Sub : Greeter {
  public string Hello() { return base.Greet("s"); }
  public string Twice() { return this.Greet("x"); }
}
class Program {
  static void Main() {
    var g = new Greeter();
  }
}
`
      }
    ],
    "c#"
  );
  assert.equal(graph.status, "resolved");
  assert.equal(graph.language, "csharp");
  const greet = graph.nodes.find(n => n.name === "Greeter.Greet");
  const hello = graph.nodes.find(n => n.name === "Sub.Hello");
  const twice = graph.nodes.find(n => n.name === "Sub.Twice");
  const ctor = graph.nodes.find(n => n.name === "Greeter.constructor");
  const main = graph.nodes.find(n => n.name === "Program.Main");
  assert.ok(greet && hello && twice && ctor && main);

  // base.Greet("s") -> super edge (heuristic: the base member is name-matched).
  const superEdge = graph.edges.find(e => e.from === hello.id && e.to === greet.id);
  assert.ok(superEdge, "base.Greet must produce a super edge");
  assert.equal(superEdge.kind, "super");
  assert.equal(superEdge.callType, "super");
  assert.equal(superEdge.status, "heuristic");
  assert.equal(superEdge.line, 5);

  // this.Greet("x") in Sub: Greet is not declared on Sub (inheritance is a pack
  // concern, #152) -> ambiguity site with same-named candidates, never a guess.
  assert.ok(!graph.edges.some(e => e.from === twice.id), "no guessed edge for this.Greet in Sub");
  const thisSite = graph.sites.find(s => s.name === "Greet" && s.line === 6);
  assert.ok(thisSite, "expected an ambiguity site for this.Greet in Sub");
  assert.equal(thisSite.status, "ambiguous");
  assert.deepEqual(thisSite.candidates, ["Greeter.Greet"]);
  assert.equal(thisSite.caller, "Sub.Twice");

  const newEdge = graph.edges.find(e => e.from === main.id && e.to === ctor.id);
  assert.ok(newEdge, "new Greeter() must be a new edge");
  assert.equal(newEdge.kind, "new");
  assert.equal(newEdge.line, 10);
});
