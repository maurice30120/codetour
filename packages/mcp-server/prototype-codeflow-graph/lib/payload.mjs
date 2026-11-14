// Prototype logic: turn a CodeFlow Map graph into the compact payload that
// would be injected into a Targeted Context, and compare it with ground truth.
// Pure functions only: no fs, no DOM, no tokenizer. The token counter is
// injected so the same logic can be reused with any tokenizer.

export function buildIndex(graph) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const byName = new Map();
  for (const node of graph.nodes) {
    const bucket = byName.get(node.name) ?? [];
    bucket.push(node);
    byName.set(node.name, bucket);
  }
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of graph.edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to).push(edge);
  }
  return { nodes, byName, outgoing, incoming, edges: graph.edges };
}

const owner = (name) => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? null : name.slice(0, dot);
};

/** Nodes that represent the requested symbol: the class prefix or the function. */
export function symbolNodes(index, symbol) {
  const exact = index.byName.get(symbol) ?? [];
  const asClass = exact.length > 0
    ? exact
    : [...index.nodes.values()].filter((node) => owner(node.name) === symbol);
  if (asClass.length > 0) return asClass;
  return [...index.nodes.values()].filter(
    (node) => node.name === symbol || node.name.endsWith(`.${symbol}`),
  );
}

/** Directed neighborhood of a symbol, as found by the library. */
export function relationsFor(index, symbol) {
  const anchors = symbolNodes(index, symbol);
  const anchorIds = new Set(anchors.map((node) => node.id));
  const outgoing = [];
  const incoming = [];
  for (const node of anchors) {
    for (const edge of index.outgoing.get(node.id) ?? []) {
      outgoing.push(describeEdge(index, edge, "out"));
    }
  }
  for (const anchor of anchors) {
    for (const edge of index.incoming.get(anchor.id) ?? []) {
      if (anchorIds.has(edge.from)) continue;
      incoming.push(describeEdge(index, edge, "in"));
    }
  }
  return { anchors, outgoing, incoming, anchorIds };
}

function describeEdge(index, edge, direction) {
  const from = index.nodes.get(edge.from);
  const to = index.nodes.get(edge.to);
  const near = direction === "out" ? to : from;
  return {
    direction,
    from: from.name,
    to: to.name,
    fromFile: from.filePath,
    toFile: to.filePath,
    fromLine: from.startLine + 1,
    toLine: to.startLine + 1,
    line: edge.line + 1,
    callType: edge.callType ?? "direct",
    evidence: [near.filePath, `L${near.startLine + 1}-${near.endLine + 1}`].join(":"),
  };
}

/**
 * The compact text that CodeTour would inject. One line per relation, with a
 * short evidence pointer, no prose. Everything else is dropped on purpose.
 */
export function renderPayload({ symbol, file, relations, depth = 1 }) {
  const lines = [`# graph ${symbol} @ ${file} (depth ${depth})`];
  const seen = new Set();
  for (const relation of [...relations.outgoing, ...relations.incoming]) {
    const key = `${relation.direction}|${relation.from}|${relation.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const arrow = relation.direction === "out" ? "OUT" : "IN ";
    lines.push(`${arrow} ${relation.from} -> ${relation.to} [${relation.evidence}]`);
  }
  return lines.join("\n");
}

/** What an agent without the graph must read: grep hits + full file contents. */
export function renderBaseline({ symbol, hits, files }) {
  const lines = [`# baseline for ${symbol}: grep + read files`];
  for (const hit of hits) lines.push(`grep:${hit.file}:${hit.line}: ${hit.text.trim()}`);
  for (const file of files) {
    lines.push("", `### file ${file.path} (${file.lines} lines)`);
    lines.push(file.content);
  }
  return lines.join("\n");
}

const normalize = (name) => name.replace(/^self\./, "");
const shortName = (name) => name.slice(name.lastIndexOf(".") + 1);

/**
 * Honest variant: keep the resolved relations and add an explicit `?` line for
 * every call site the resolver saw but refused to attribute. This is what the
 * library *could* emit today — it already has the raw calls — but does not.
 */
export function renderPayloadWithGaps({ symbol, file, relations, gaps }) {
  const lines = [renderPayload({ symbol, file, relations })];
  if (relations.outgoing.length + relations.incoming.length === 0 && gaps.length === 0) {
    lines.push("# no relation resolved, no ambiguous call site");
  }
  for (const gap of gaps) {
    const candidates =
      gap.candidates.length > 0
        ? `${gap.candidates.length} candidat(s): ${gap.candidates.join(", ")}`
        : "aucune définition locale";
    lines.push(
      `? ${gap.direction === "out" ? "OUT" : "IN "} ${gap.caller} @${gap.file}:${gap.line} ${gap.name} -> ${candidates}`,
    );
  }
  return lines.join("\n");
}

/**
 * A relation is "actionable" when the payload either asserts it or points at
 * the call site that would prove it. Direction matters: for a review tour the
 * incoming side must be actionable-complete, the outgoing side is best effort.
 */
export function actionableCoverage(rows, gaps, symbol) {
  const belongs = (name) => name === symbol || name.startsWith(`${symbol}.`);
  const gapKeys = new Set(gaps.map((gap) => `${gap.caller}|${gap.name}`));
  const scored = rows.map((row) => ({
    ...row,
    direction: belongs(row.to) && !belongs(row.from) ? "in" : "out",
    actionable:
      row.found || gapKeys.has(`${row.from}|${shortName(row.to)}`),
  }));
  const tally = (list) => ({
    total: list.length,
    found: list.filter((row) => row.found).length,
    actionable: list.filter((row) => row.actionable).length,
  });
  return {
    rows: scored,
    incoming: tally(scored.filter((row) => row.direction === "in")),
    outgoing: tally(scored.filter((row) => row.direction === "out")),
  };
}


/** Compare observed relations with the hand-written ground truth. */
export function compareToGroundTruth(relations, expected, symbol) {
  const belongs = (name) => name === symbol || name.startsWith(`${symbol}.`);
  const observed = new Set(
    [...relations.outgoing, ...relations.incoming].map(
      (relation) => `${normalize(relation.from)}|${normalize(relation.to)}`,
    ),
  );
  const rows = expected
    .filter((row) => belongs(row.from) || belongs(row.to))
    .map((row) => ({
      ...row,
      found: observed.has(`${row.from}|${row.to}`),
    }));
  const found = rows.filter((row) => row.found).length;
  const byRelation = new Set(rows.map((row) => `${row.from}|${row.to}`));
  const falsePositives = [...observed]
    .filter((key) => !byRelation.has(key))
    .map((key) => {
      const [from, to] = key.split("|");
      return { from, to };
    });
  return {
    rows,
    found,
    total: rows.length,
    recall: rows.length === 0 ? 1 : found / rows.length,
    falsePositives,
    precision:
      observed.size === 0
        ? 1
        : (observed.size - falsePositives.length) / observed.size,
  };
}
