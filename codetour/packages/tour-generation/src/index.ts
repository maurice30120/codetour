// Transport-free CodeTour creation rules.
//
// A caller supplies the workspace to create in and the proposal it received;
// the entry points validate, apply the Git, image, Mermaid and
// workspace-confinement rules, write the Tour file atomically, and return the
// outcome as a value. The command-line surface is the only consumer, so the
// rules live here once instead of in each surface.

export { createChangesTour, createProjectTour } from "./creation";
export {
  CREATIONS_DIRECTORY,
  CREATION_RECORD_VERSION,
  creationIdentity,
  recordCreation,
} from "./journal";
export type { CreationIdentity, CreationRecord, CreationRecordInput } from "./journal";
export { createContext, selectContext } from "./context";
export {
  changedFiles,
  committedDiffIsEmpty,
  currentBranchName,
  currentHeadSha,
  git,
  isGitRepository,
  mergeBase,
  normalizeSlashes,
  readCommitAnchors,
  renamedFiles,
  resolveCommit,
  uncommittedChanges,
  workspacePrefix,
} from "./git";
export type { CommitAnchor, GitResult, UncommittedEntry } from "./git";
export { validateCodetourTour } from "./codetour-schema";
export { OutputPathError, writeTourAtomic } from "./persistence";
export { stageCommitAnchors, validateTourProposal } from "./proposal-validation";
export type {
  CommitComparison,
  ProposalRejection,
  ProposalValidation,
  StagedCommitAnchors,
  TourProposalKind,
  ValidatedProposal,
} from "./proposal-validation";
export { IMAGE_TOOL_GUIDANCE, tourImageDirectoryName, validateImageDescriptions } from "./image-validation";
export { MERMAID_TOOL_GUIDANCE, validateMermaidDescriptions } from "./mermaid-validation";
export {
  MAX_PATTERN_LENGTH,
  MAX_QUESTIONS,
  MAX_RECOMMENDED_DIAGRAM_NODES,
  MAX_RECOMMENDED_STEPS,
  orientationStepWarnings,
  STEP_FIELDS,
  validateChangesParams,
  validateProjectParams,
  validateSteps,
} from "./validation";
export type { AnchorSource } from "./validation";
export * from "./types";
