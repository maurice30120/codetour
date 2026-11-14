/**
 * Shared dedup keys of the graph engine and the depth-1 BFS: one definition
 * per key shape, used by both so an edge/site is never deduplicated
 * differently depending on where it is added.
 */

import type { AmbiguitySite, GraphEdge } from "./types";

/** Identity of an edge: endpoints + relation + file:line evidence site. */
export function edgeKey(edge: GraphEdge): string {
  return `${edge.from}|${edge.to}|${edge.kind}|${edge.callType}|${edge.filePath}|${edge.line}`;
}

/** Identity of an ambiguity site: the "?" pointer + called name + caller. */
export function siteKey(site: AmbiguitySite): string {
  return `${site.file}|${site.line}|${site.name}|${site.caller}`;
}
