// Compatibility shim: the Knowledge contract lives in `codetour-knowledge`
// (ADR 0039). The historical Research Harness imports this module unchanged;
// its behaviour is the shared contract's behaviour, never a second copy.
export {
  fileProofHash,
  hashWorkspaceFile,
  knowledgeDirectory,
  loadKnowledgeLibrary,
  parseKnowledge,
  validateCanonicalName,
  verifyKnowledge
} from 'codetour-knowledge';
export type {
  KnowledgeEntry,
  KnowledgeFailureReason,
  KnowledgeFileProof,
  KnowledgeLibrary,
  KnowledgeMetadata,
  KnowledgePathHash,
  KnowledgeProof,
  KnowledgeSymbolProof,
  KnowledgeValidation
} from 'codetour-knowledge';
