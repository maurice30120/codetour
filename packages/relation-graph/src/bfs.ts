import { estimateTokens, TokenBudget } from "./tokens";
import {
  DEFAULT_LIMITS,
  type AmbiguitySite,
  type GraphEdge,
  type GraphLimits,
  type GraphNode,
  type RelationGraph,
  type RelationPacket,
  type TruncationFlags
} from "./types";

function edgeKey(edge: GraphEdge): string {
  return `${edge.from}|${edge.to}|${edge.kind}|${edge.callType}|${edge.filePath}|${edge.line}`;
}

/**
 * BFS of depth 1 around seed symbols (the relations packet of #149): seeds
 * plus their direct neighbours, edges incident to a seed only, deduplicated,
 * with outgoing/incoming indexes and maxNodes/maxEdges/maxTokens limits.
 * Seeds may be node ids or node names ("Type.member").
 */
export function selectDepth1(
  graph: RelationGraph,
  seeds: string[],
  limits?: Partial<GraphLimits>
): RelationPacket {
  const resolvedLimits: GraphLimits = { ...DEFAULT_LIMITS, ...limits };
  const truncated: TruncationFlags = { nodes: false, edges: false, tokens: false };

  if (!graph.supported || graph.status === "unsupported") {
    return {
      seeds: [],
      depth: 1,
      status: "unsupported",
      nodes: [],
      edges: [],
      sites: [],
      outgoing: {},
      incoming: {},
      limits: resolvedLimits,
      truncated
    };
  }

  const nodeById = new Map(graph.nodes.map(n => [n.id, n]));
  const seedIds: string[] = [];
  for (const seed of seeds) {
    if (nodeById.has(seed)) {
      if (!seedIds.includes(seed)) seedIds.push(seed);
      continue;
    }
    for (const node of graph.nodes) {
      if (node.name === seed && !seedIds.includes(node.id)) seedIds.push(node.id);
    }
  }

  const budget = new TokenBudget(resolvedLimits.maxTokens, truncated);
  const nodes: GraphNode[] = [];
  const nodeIds = new Set<string>();
  const addNode = (node: GraphNode): boolean => {
    if (nodeIds.has(node.id)) return true;
    if (nodes.length >= resolvedLimits.maxNodes) {
      truncated.nodes = true;
      return false;
    }
    if (!budget.trySpend(JSON.stringify(node))) return false;
    nodeIds.add(node.id);
    nodes.push(node);
    return true;
  };
  for (const id of seedIds) {
    const node = nodeById.get(id);
    if (node) addNode(node);
  }

  // Depth 1: only edges incident to a seed are traversed; their other endpoint
  // joins the packet. Edges between two non-seed nodes would be depth 2.
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  for (const edge of graph.edges) {
    const touchesSeed = seedIds.includes(edge.from) || seedIds.includes(edge.to);
    if (!touchesSeed) continue;
    const key = edgeKey(edge);
    if (edgeKeys.has(key)) continue;
    if (edges.length >= resolvedLimits.maxEdges) {
      truncated.edges = true;
      continue;
    }
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    if (!addNode(from) || !addNode(to)) {
      // Keep referential integrity: an edge is only included when both
      // endpoints are in the packet.
      truncated.edges = true;
      continue;
    }
    if (!budget.trySpend(JSON.stringify(edge))) {
      truncated.edges = true;
      continue;
    }
    edgeKeys.add(key);
    edges.push(edge);
  }

  // Sites whose caller is in the packet travel with it.
  const packetNames = new Set(nodes.map(n => n.name));
  const sites: AmbiguitySite[] = [];
  const siteKeys = new Set<string>();
  for (const site of graph.sites) {
    if (!packetNames.has(site.caller)) continue;
    const key = `${site.file}|${site.line}|${site.name}|${site.caller}`;
    if (siteKeys.has(key)) continue;
    if (!budget.trySpend(JSON.stringify(site))) continue;
    siteKeys.add(key);
    sites.push(site);
  }

  const outgoing: Record<string, GraphEdge[]> = {};
  const incoming: Record<string, GraphEdge[]> = {};
  for (const edge of edges) {
    if (nodeIds.has(edge.from)) (outgoing[edge.from] ??= []).push(edge);
    if (nodeIds.has(edge.to)) (incoming[edge.to] ??= []).push(edge);
  }

  return {
    seeds: seedIds,
    depth: 1,
    status: "resolved",
    nodes,
    edges,
    sites,
    outgoing,
    incoming,
    limits: resolvedLimits,
    truncated
  };
}

// Re-exported for tests and for hosts that serialize packets.
export { estimateTokens };
