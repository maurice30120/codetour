/**
 * Spec #174 - T06: Blinder Module
 * 
 * This module handles anonymization of agent responses for blind evaluation.
 * It ensures that the evaluator does NOT know:
 * - Which agent produced the response
 * - The execution order
 * - The token cost
 * 
 * G4 Compliance: The blinder is critical for maintaining evaluation independence.
 */

import { createHash } from 'crypto';

import {
  AgentResponse,
  BlindedResponse,
  BlindedEvaluationItem,
  EvaluationSet,
  POSTGRES_SHA,
  Question,
} from './types';

/**
 * Generates an evaluation ID.
 * - With `content`: DETERMINISTIC content hash — the same blinded content
 *   always yields the same ID, so the evaluation map and the evaluation set
 *   agree (reconstruction works). Identical anonymized responses collide by
 *   design: a blind evaluator cannot distinguish them anyway.
 * - Without `content`: unique counter-based ID (kept for tooling/tests).
 */
export function generateEvaluationId(content?: unknown): string {
  if (content === undefined) {
    return `eval-${Date.now()}-${++evaluationIdCounter}`;
  }
  const hash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  return `eval-${hash.slice(0, 16)}`;
}

let evaluationIdCounter = 0;

export function generateSetId(): string {
  return `set-${Date.now()}`;
}

/**
 * Resets the evaluation ID counter (for testing)
 */
export function resetEvaluationIdCounter(): void {
  evaluationIdCounter = 0;
}

/**
 * Remove agent metadata from a response
 * 
 * This function strips all information that could identify:
 * - The agent (CodeTour vs Vibe)
 * - The execution order (run_id, timestamp)
 * - The token cost (token_usage)
 * 
 * The resulting BlindedResponse contains only the content needed for evaluation.
 */
export function anonymizeResponse(response: AgentResponse): BlindedResponse {
  const {
    // Metadata to remove
    run_id,
    agent,
    timestamp,
    token_usage,
    
    // Keep these
    question_id,
    objective,
    series,
    phase,
    repeat_index,
    
    // Content to keep
    tour,
    citations,
    claims,
    relations,
  } = response;

  // Deterministic content-based ID: the evaluation map and the evaluation
  // set are built from the SAME blinded content, so reconstruction agrees.
  const evaluationContent = {
    question_id,
    objective,
    series,
    phase,
    repeat_index,
    tour,
    citations,
    claims,
    relations,
  };

  // Create blinded response. The response's OWN postgres_sha is propagated
  // (provenance is data, not something the blinder may silently rewrite):
  // a run claiming a wrong SHA will be flagged by verifyBlinding, not
  // laundered into validity here.
  const blinded: BlindedResponse = {
    evaluation_id: generateEvaluationId(evaluationContent),
    question_id: question_id || '',
    objective: objective || '',
    series: series || '',
    phase,
    repeat_index,
    postgres_sha: response.postgres_sha ?? POSTGRES_SHA,
    tour,
    citations: citations || [],
    claims: claims || [],
    relations: relations || [],
  };

  return blinded;
}

/**
 * Create a blinded evaluation item from a response and question
 * 
 * This combines the blinded response with the question metadata
 * (excluding expected answers that would give away the correct response)
 */
export function createBlindedItem(
  response: AgentResponse,
  question: Question
): BlindedEvaluationItem {
  const blindedResponse = anonymizeResponse(response);
  
  // Create blinded question (only include non-answer-revealing metadata)
  const blindedQuestion = {
    id: question.id,
    objective: question.objective,
    series: question.series,
    postgres_sha: POSTGRES_SHA,
  };

  return {
    evaluation_id: blindedResponse.evaluation_id,
    response: blindedResponse,
    question: blindedQuestion,
  };
}

/**
 * Create a complete evaluation set from multiple responses
 * 
 * This:
 * 1. Anonymizes all responses
 * 2. Shuffles them to prevent pattern detection
 * 3. Assigns random evaluation IDs
 * 4. Creates a single evaluation set
 * 
 * @param responses - Array of agent responses
 * @param questions - Array of corresponding questions
 * @returns EvaluationSet ready for blind evaluation
 */
export function createEvaluationSet(
  responses: AgentResponse[],
  questions: Question[]
): EvaluationSet {
  if (responses.length !== questions.length) {
    throw new Error('Responses and questions arrays must have the same length');
  }

  // Create blinded items
  const items: BlindedEvaluationItem[] = [];
  for (let i = 0; i < responses.length; i++) {
    items.push(createBlindedItem(responses[i], questions[i]));
  }

  // Shuffle the items to prevent pattern detection
  const shuffledItems = shuffleArray([...items]);

  // Create evaluation set
  const set: EvaluationSet = {
    evaluation_set_id: generateSetId(),
    items: shuffledItems,
    created_at: new Date().toISOString(),
    postgres_sha: POSTGRES_SHA,
    evaluator_version: '1.0.0',
    shuffle_seed: Date.now().toString(),
  };

  return set;
}

/**
 * Fisher-Yates shuffle algorithm
 * Creates a deterministic shuffle if seed is provided
 */
export function shuffleArray<T>(array: T[], seed?: string): T[] {
  // Make a copy to avoid mutating the original
  const shuffled = [...array];
  
  // Simple seed-based RNG for reproducibility
  let currentSeed = seed ? 
    seed.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) :
    Date.now();
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    currentSeed = (currentSeed * 9301 + 49297) % 233280;
    const j = Math.floor((currentSeed / 233280) * (i + 1));
    
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

/**
 * Verify that a response has been properly blinded
 * 
 * Checks that:
 * - No agent metadata exists
 * - No token usage data exists
 * - No run_id or timestamp exists
 * - evaluation_id is present
 */
export function verifyBlinding(response: BlindedResponse): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  // Check for forbidden fields
  const forbiddenFields = ['run_id', 'agent', 'timestamp', 'token_usage'];
  
  for (const field of forbiddenFields) {
    if (field in response) {
      issues.push(`Forbidden field found: ${field}`);
    }
  }
  
  // Check for required fields
  const requiredFields = ['evaluation_id', 'question_id', 'objective', 'tour', 'citations', 'claims', 'relations'];
  
  for (const field of requiredFields) {
    if (!(field in response)) {
      issues.push(`Missing required field: ${field}`);
    }
  }
  
  // Check postgres_sha
  if (response.postgres_sha !== POSTGRES_SHA) {
    issues.push(`Invalid postgres_sha: expected ${POSTGRES_SHA}, got ${response.postgres_sha}`);
  }
  
  // Check evaluation_id format
  if (!response.evaluation_id || !response.evaluation_id.startsWith('eval-')) {
    issues.push('Invalid evaluation_id format');
  }
  
  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Verify that an entire evaluation set is properly blinded
 */
export function verifyEvaluationSet(set: EvaluationSet): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  // Check set-level fields
  if (!set.evaluation_set_id || !set.evaluation_set_id.startsWith('set-')) {
    issues.push('Invalid evaluation_set_id format');
  }
  
  if (!set.created_at) {
    issues.push('Missing created_at');
  }
  
  if (set.postgres_sha !== POSTGRES_SHA) {
    issues.push(`Invalid postgres_sha: expected ${POSTGRES_SHA}, got ${set.postgres_sha}`);
  }
  
  // Check each item
  for (let i = 0; i < set.items.length; i++) {
    const item = set.items[i];
    const itemVerification = verifyBlinding(item.response);
    
    if (!itemVerification.valid) {
      issues.push(`Item ${i} blinding issues: ${itemVerification.issues.join(', ')}`);
    }
    
    // Check that question doesn't reveal answers
    const question = item.question;
    if ('expected_areas' in question || 'relations_to_verify' in question) {
      issues.push(`Item ${i} question contains answer-revealing fields`);
    }
  }
  
  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Create a mapping from evaluation_id to original response index
 * 
 * This can be used after blind evaluation to reconstruct which response
 * corresponds to which original (but only after all evaluations are complete)
 */
export function createEvaluationMap(
  responses: AgentResponse[],
  questions: Question[]
): Map<string, { responseIndex: number; questionIndex: number }> {
  const map = new Map<string, { responseIndex: number; questionIndex: number }>();
  
  // Reset counter for consistent IDs
  resetEvaluationIdCounter();
  
  for (let i = 0; i < responses.length; i++) {
    const blinded = anonymizeResponse(responses[i]);
    map.set(blinded.evaluation_id, {
      responseIndex: i,
      questionIndex: i,
    });
  }
  
  return map;
}

/**
 * Reconstruct the original agent responses from a blinded evaluation set
 * 
 * This should only be used AFTER all evaluations are complete to maintain blinding
 * during the evaluation process.
 * 
 * @param set - The blinded evaluation set
 * @param map - The evaluation map created by createEvaluationMap
 * @param results - Evaluation results aligned with the ORIGINAL responses
 *   order (results[i] is the verdict of responses[i] — the map, not the
 *   shuffled set order, ties a result to a response)
 * @returns Array sorted by responseIndex; each entry carries the original
 *   indices and its own result
 */
export function reconstructWithResults<T>(
  set: EvaluationSet,
  map: Map<string, { responseIndex: number; questionIndex: number }>,
  results: T[]
): Array<{ responseIndex: number; questionIndex: number; result: T }> {
  const reconstructed: Array<{ responseIndex: number; questionIndex: number; result: T }> = [];
  
  for (let i = 0; i < set.items.length; i++) {
    const item = set.items[i];
    const mapping = map.get(item.evaluation_id);
    
    if (mapping && results[mapping.responseIndex] !== undefined) {
      reconstructed.push({
        responseIndex: mapping.responseIndex,
        questionIndex: mapping.questionIndex,
        result: results[mapping.responseIndex],
      });
    }
  }
  
  // Deterministic output order (the set order is shuffled; the result array
  // is not).
  reconstructed.sort((a, b) => a.responseIndex - b.responseIndex);
  return reconstructed;
}

// Export utility functions
export {
  generateEvaluationId as generateId,
  generateSetId,
  resetEvaluationIdCounter,
};
