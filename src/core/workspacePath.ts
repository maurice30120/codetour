/**
 * Host-independent workspace path identity.
 *
 * The rule itself lives in `codetour-knowledge`: the MCP server and the plugin
 * hooks compare the same roots, so one module owns the spelling and this file
 * only keeps the extension's historical import path. Only the canonical form
 * is re-exported — the injectable resolver stays in the package that documents
 * it, and this module's callers always want the platform's own answer.
 */
export {
  canonicalWorkspacePath,
  sameWorkspace,
  stripTrailingSeparator
} from "codetour-knowledge";
