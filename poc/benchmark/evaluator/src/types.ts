/**
 * Spec #174 - T06: Blind Evaluator Types
 * 
 * This file contains all type definitions for the blind evaluator.
 * These types ensure a common response format for both CodeTour and Vibe agents.
 */

// ============================================================================
// PostgreSQL Reference Types
// ============================================================================

/**
 * PostgreSQL SHA reference for verification
 * All evaluations must verify against this specific commit
 */
export const POSTGRES_SHA = '70c4a57b64d39c526eb4c44a925eb92a6e56f3c5';

// ============================================================================
// Agent Response Types (Common Format)
// ============================================================================

/**
 * A step in a code tour
 */
export interface TourStep {
  id: string;
  description: string;
  file?: string;
  line?: number;
  code?: string;
  type?: 'entry' | 'definition' | 'call' | 'relation' | 'verification' | 'other';
}

/**
 * A citation pointing to PostgreSQL source code
 * Must reference the actual code at POSTGRES_SHA
 */
export interface Citation {
  id: string;
  file: string;           // File path in PostgreSQL repo
  line: number;           // Line number (1-indexed)
  content: string;        // Exact content at that line
  context: string;        // Surrounding lines for verification
  startLine?: number;     // Start of context range
  endLine?: number;       // End of context range
}

/**
 * A claim made by the agent
 * Must be verifiable against PostgreSQL code
 */
export interface Claim {
  id: string;
  statement: string;      // The actual claim
  confidence: number;     // 0-1, agent's confidence
  citations: string[];    // IDs of citations supporting this claim
  category?: 'fact' | 'relation' | 'definition' | 'behavior' | 'location' | 'other';
  critical?: boolean;     // Whether this is a critical claim
}

/**
 * A relation between code entities
 */
export interface Relation {
  id: string;
  from: string;           // Source entity (function, file, struct, etc.)
  to: string;             // Target entity
  type: 'calls' | 'uses' | 'defines' | 'includes' | 'extends' | 'implements' | 'reads' | 'writes' | 'other';
  citations: string[];    // IDs of citations supporting this relation
  bidirectional?: boolean;
  description?: string;
}

/**
 * The tour structure
 */
export interface Tour {
  title: string;
  description: string;
  steps: TourStep[];
  summary?: string;
}

/**
 * Complete agent response format
 * MUST be produced by both CodeTour and Vibe agents
 */
export interface AgentResponse {
  // Metadata (will be removed for blind evaluation)
  run_id: string;
  agent: 'CodeTour' | 'Vibe' | string;
  timestamp: string;      // ISO 8601
  
  // Question metadata
  question_id: string;
  objective: string;
  series: 'R' | 'T' | string;
  phase?: string;
  repeat_index?: number;
  
  // The tour itself
  tour: Tour;
  
  // Evidence
  citations: Citation[];
  
  // Extracted claims
  claims: Claim[];
  
  // Relations discovered
  relations: Relation[];
  
  // Token usage (will be removed for blind evaluation)
  token_usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    calls: Array<{
      model: string;
      input: number;
      output: number;
      function?: string;
    }>;
  };
}

// ============================================================================
// Question Types
// ============================================================================

/**
 * Expected relation to verify
 */
export interface ExpectedRelation {
  from: string;
  to: string;
  type: 'calls' | 'uses' | 'defines' | 'includes' | 'extends' | 'implements' | 'reads' | 'writes' | 'other';
  critical: boolean;      // Whether this is a major/critical relation
  description?: string;
}

/**
 * Expected area in PostgreSQL code to cover
 */
export interface ExpectedArea {
  file: string;
  lines?: number[] | { start: number; end: number };
  description: string;
  critical: boolean;
}

/**
 * Evaluation criteria for a question
 */
export interface QuestionCriteria {
  id: string;
  description: string;
  required: boolean;
  weight: number;         // 0-1
}

/**
 * A benchmark question
 */
export interface Question {
  id: string;
  objective: string;
  series: 'R' | 'T' | string;
  phase?: string;
  postgres_sha: string;    // Must match POSTGRES_SHA
  
  // Expected answers (used by evaluator, NOT sent to agents)
  expected_areas: ExpectedArea[];
  relations_to_verify: ExpectedRelation[];
  criteria: QuestionCriteria[];
  
  // Quality thresholds (defined BEFORE seeing results)
  thresholds?: {
    min_coverage?: number;        // 0-1
    max_missing_critical?: number;
    max_false_claims?: number;
  };
  
  metadata?: {
    difficulty?: 'easy' | 'medium' | 'hard';
    category?: string;
    tags?: string[];
  };
}

// ============================================================================
// Evaluation Result Types
// ============================================================================

/**
 * A failed claim with details
 */
export interface FailedClaim {
  claim: string;
  claim_id?: string;
  reason: 'unsupported' | 'false' | 'misleading' | 'irrelevant' | 'out_of_context' | 'wrong_relation' | 'other';
  expected?: string;
  actual?: string;
  severity?: 'critical' | 'major' | 'minor';
}

/**
 * Result of evaluating a single response
 * 
 * A Tour is "correct" if and only if:
 * - correct === true
 * - evidence_supported === true
 * - major_missing_relation === false
 * - critical_false_claim === false
 */
export interface EvaluationResult {
  // Global judgment
  correct: boolean;
  
  // Detailed judgments
  evidence_supported: boolean;           // All claims are supported by evidence
  major_missing_relation: boolean;      // A major relation is missing
  critical_false_claim: boolean;        // A critical false claim exists
  
  // Metrics
  coverage: number;                      // 0-1, coverage of expected areas
  quality_score: number;                 // 0-1, overall quality score
  
  // Justification
  justification: string;                  // Brief explanation
  verified_lines: string[];               // Lines verified in PostgreSQL code
  verified_files: string[];               // Files verified
  
  // Failures
  failed_claims: FailedClaim[];
  missing_relations: ExpectedRelation[]; // Relations that were expected but missing
  
  // Metadata
  evaluation_id: string;
  evaluated_at: string;                   // ISO 8601
  evaluator_version?: string;
  
  // Detailed breakdown
  claim_results?: Array<{
    claim_id: string;
    supported: boolean;
    verified: boolean;
    false: boolean;
    reason?: string;
  }>;
  
  relation_results?: Array<{
    relation_id: string;
    expected: ExpectedRelation;
    found: boolean;
    verified: boolean;
  }>;
}

// ============================================================================
// Blind Evaluation Types
// ============================================================================

/**
 * Response after removing agent metadata (blinded)
 */
export interface BlindedResponse {
  evaluation_id: string;
  
  // Question metadata (preserved for evaluation context)
  question_id: string;
  objective: string;
  series: string;
  phase?: string;
  repeat_index?: number;
  postgres_sha: string;
  
  // The actual content to evaluate
  tour: Tour;
  citations: Citation[];
  claims: Claim[];
  relations: Relation[];
}

/**
 * A blinded evaluation item (response + question)
 */
export interface BlindedEvaluationItem {
  evaluation_id: string;
  response: BlindedResponse;
  question: Omit<Question, 'expected_areas' | 'relations_to_verify' | 'criteria'> & {
    // Only non-answer-revealing metadata
    id: string;
    objective: string;
    series: string;
    postgres_sha: string;
  };
}

/**
 * Complete blinded evaluation set
 */
export interface EvaluationSet {
  evaluation_set_id: string;
  items: BlindedEvaluationItem[];
  created_at: string;         // ISO 8601
  postgres_sha: string;
  evaluator_version?: string;
  
  // Shuffle seed for reproducibility
  shuffle_seed?: string;
}

// ============================================================================
// Arbitration Types
// ============================================================================

/**
 * Arbitration record for disagreements
 */
export interface Arbitration {
  evaluation_id: string;
  question_id: string;
  
  // Initial judgments
  initial_judgments: EvaluationResult[];  // All initial evaluations
  
  // Arbitrator's judgment
  arbitrator_judgment: EvaluationResult;
  
  // Final judgment (always equals arbitrator_judgment)
  final_judgment: EvaluationResult;
  
  // Metadata
  reason: string;             // Why arbitration was needed
  arbitrator_id?: string;
  arbitrated_at: string;      // ISO 8601
  
  // Preserved for audit
  disagreement_details?: string;
}

/**
 * Complete evaluation record including arbitration
 */
export interface FinalEvaluation {
  evaluation_id: string;
  question_id: string;
  agent?: string;              // Only added after blind evaluation
  run_id?: string;             // Only added after blind evaluation
  
  result: EvaluationResult;
  arbitration?: Arbitration;
  
  evaluated_at: string;
  finalized_at: string;
}

// ============================================================================
// Grader Configuration Types
// ============================================================================

/**
 * Configuration for the TourGrader
 */
export interface GraderConfig {
  postgres_path: string;       // Path to PostgreSQL fixture
  postgres_sha: string;        // Expected SHA (must match POSTGRES_SHA)
  
  // Quality thresholds (defined BEFORE seeing results)
  thresholds: {
    min_coverage: number;      // 0-1, minimum coverage to be considered
    max_missing_critical_relations: number;
    max_false_claims: number;
    critical_false_claim_weight: number; // Weight for critical false claims
  };
  
  // Behavior flags
  strict_mode: boolean;        // If true, fail on any unsupported claim
  verify_all_citations: boolean;
  
  // Performance
  max_citation_checks?: number;
  cache_enabled?: boolean;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Context for reading a file
 */
export interface FileContext {
  path: string;
  line: number;
  before: number;             // Lines before
  after: number;              // Lines after
}

/**
 * Options for citation verification
 */
export interface VerificationOptions {
  check_context: boolean;     // Verify context matches
  check_exact_match: boolean;  // Require exact match of citation content
  check_line_number: boolean;  // Verify line number is correct
  fuzzy_match: boolean;        // Allow fuzzy matching
  fuzzy_threshold: number;    // Similarity threshold for fuzzy matching (0-1)
}

/**
 * Result of verifying a single citation
 */
export interface CitationVerificationResult {
  citation_id: string;
  valid: boolean;
  file_exists: boolean;
  line_valid: boolean;
  content_matches: boolean;
  context_matches: boolean;
  error?: string;
  actual_content?: string;
  actual_line?: number;
}

/**
 * Statistics for a batch evaluation
 */
export interface EvaluationStatistics {
  total_evaluations: number;
  correct_count: number;
  incorrect_count: number;
  average_coverage: number;
  average_quality: number;
  false_claim_rate: number;
  missing_relation_rate: number;
  
  by_series?: Record<string, {
    count: number;
    correct: number;
    coverage: number;
  }>;
  by_agent?: Record<string, {
    count: number;
    correct: number;
    coverage: number;
  }>;
}

// ============================================================================
// Export Types
// ============================================================================

export type { AgentResponse as IAgentResponse };
export type { BlindedResponse as IBlindedResponse };
export type { EvaluationResult as IEvaluationResult };
export type { Question as IQuestion };
export type { Citation as ICitation };
export type { Claim as IClaim };
export type { Relation as IRelation };
export type { Tour as ITour };
export type { TourStep as ITourStep };
