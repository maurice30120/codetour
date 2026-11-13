import type { GrammarId } from "./grammars";

/**
 * Per-grammar extraction queries and node-type metadata for the built-in
 * generic pack. Every pattern below is validated against the pinned grammar
 * .wasm files (tree-sitter-wasms@0.1.13) by test/grammars.test.ts.
 *
 * Capture vocabulary (consumed by default-pack.ts):
 *   @class.decl / @class.name     class declaration + its name
 *   @method.def / @method.name    method declaration (inside a class)
 *   @fn.decl / @fn.name           function declaration
 *   @call / @call.ident           call with a plain identifier callee
 *   @call.member / @call.prop     call on a receiver (member expression)
 *   @super.call / @super.prop     explicit super/base call
 *   @new / @new.ctor              object creation + constructor name
 */

export interface GrammarSpec {
  id: GrammarId;
  query: string;
  /** Ancestor node types that open a class scope. */
  classNodeTypes: string[];
  /** Declaration node types that name a member/function (used for caller attribution). */
  declNodeTypes: string[];
}

const TYPESCRIPT_QUERY = `
  (class_declaration name: (type_identifier) @class.name) @class.decl
  (method_definition name: (property_identifier) @method.name) @method.def
  (function_declaration name: (identifier) @fn.name) @fn.decl
  (call_expression function: (identifier) @call.ident) @call
  (call_expression function: (member_expression property: (property_identifier) @call.prop)) @call.member
  (call_expression function: (super) @call.super) @super.call
  (new_expression constructor: (identifier) @new.ctor) @new
  (new_expression constructor: (member_expression property: (property_identifier) @new.prop)) @new.member
`;

const PYTHON_QUERY = `
  (class_definition name: (identifier) @class.name) @class.decl
  (function_definition name: (identifier) @fn.name) @fn.decl
  (call function: (identifier) @call.ident) @call
  (call function: (attribute attribute: (identifier) @call.prop)) @call.member
  (call function: (attribute object: (call function: (identifier) @super.fn) attribute: (identifier) @super.prop)) @super.call
`;

// Java note: method_invocation's `name` is always an identifier; the receiver
// (identifier / field_access / this / super) lives in the `object` field, which
// the pack classifies in code.
const JAVA_QUERY = `
  (class_declaration name: (identifier) @class.name) @class.decl
  (method_declaration name: (identifier) @method.name) @method.def
  (method_invocation name: (identifier) @call.ident) @call
  (method_invocation object: (super) name: (identifier) @super.prop) @super.call
  (object_creation_expression type: (_) @new.ctor) @new
`;

const CSHARP_QUERY = `
  (class_declaration name: (identifier) @class.name) @class.decl
  (method_declaration name: (identifier) @method.name) @method.def
  (invocation_expression function: (identifier) @call.ident) @call
  (invocation_expression function: (member_access_expression name: (identifier) @call.prop)) @call.member
  (invocation_expression function: (member_access_expression expression: (base_expression) name: (identifier) @super.prop)) @super.call
  (object_creation_expression type: (_) @new.ctor) @new
`;

export const GRAMMAR_SPECS: Record<GrammarId, GrammarSpec> = {
  typescript: {
    id: "typescript",
    query: TYPESCRIPT_QUERY,
    classNodeTypes: ["class_declaration", "interface_declaration"],
    declNodeTypes: ["method_definition", "function_declaration"]
  },
  tsx: {
    id: "tsx",
    query: TYPESCRIPT_QUERY,
    classNodeTypes: ["class_declaration", "interface_declaration"],
    declNodeTypes: ["method_definition", "function_declaration"]
  },
  python: {
    id: "python",
    query: PYTHON_QUERY,
    classNodeTypes: ["class_definition"],
    declNodeTypes: ["function_definition"]
  },
  java: {
    id: "java",
    query: JAVA_QUERY,
    classNodeTypes: ["class_declaration", "interface_declaration"],
    declNodeTypes: ["method_declaration", "constructor_declaration"]
  },
  c_sharp: {
    id: "c_sharp",
    query: CSHARP_QUERY,
    classNodeTypes: ["class_declaration", "interface_declaration", "struct_declaration"],
    declNodeTypes: ["method_declaration", "constructor_declaration"]
  }
};

/** The extraction query of the generic pack for a grammar id. */
export function packQueryFor(grammarId: string): string {
  const spec = (GRAMMAR_SPECS as Record<string, GrammarSpec>)[grammarId];
  if (!spec) throw new Error(`unknown grammar id: ${grammarId}`);
  return spec.query;
}
