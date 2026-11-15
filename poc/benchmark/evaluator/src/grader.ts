/**
 * Spec #174 - T06: Tour Grader
 * 
 * Main evaluation logic for blind verification of agent responses
 * against PostgreSQL code at SHA 70c4a57b64d39c526eb4c44a925eb92a6e56f3c5
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  AgentResponse,
  Claim,
  Citation,
  ExpectedArea,
  ExpectedRelation,
  EvaluationResult,
  FailedClaim,
  GraderConfig,
  POSTGRES_SHA,
  Question,
  Relation,
  VerificationOptions,
  CitationVerificationResult,
} from './types';

// Default configuration
const DEFAULT_CONFIG: GraderConfig = {
  postgres_path: 'poc/benchmark/postgres',
  postgres_sha: POSTGRES_SHA,
  thresholds: {
    min_coverage: 0.7,
    max_missing_critical_relations: 0,
    max_false_claims: 0,
    critical_false_claim_weight: 1.0,
  },
  strict_mode: false,
  verify_all_citations: true,
};

const DEFAULT_VERIFICATION_OPTIONS: VerificationOptions = {
  check_context: true,
  check_exact_match: true,
  check_line_number: true,
  fuzzy_match: false,
  fuzzy_threshold: 0.95,
};

/**
 * Main grader class for evaluating agent responses
 * 
 * The grader:
 * 1. Verifies each claim against PostgreSQL code
 * 2. Checks for missing relations
 * 3. Calculates coverage
 * 4. Produces a justified evaluation result
 * 
 * Key principle: The grader must NOT know:
 * - Which agent produced the response
 * - The execution order
 * - The token cost
 */
export class TourGrader {
  private config: GraderConfig;
  private verificationOptions: VerificationOptions;
  
  // Cache for file reads to improve performance (real reads, real cache)
  private fileCache: Map<string, string> = new Map();

  constructor(config: Partial<GraderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.verificationOptions = { ...DEFAULT_VERIFICATION_OPTIONS };
    
    // Validate configuration
    if (this.config.postgres_sha !== POSTGRES_SHA) {
      throw new Error(`postgres_sha must be ${POSTGRES_SHA} for G4 compliance`);
    }
  }

  /**
   * Main evaluation method
   * 
   * Evaluates an agent response against a question and PostgreSQL code.
   * 
   * @param response - The agent response to evaluate
   * @param question - The question with expected answers
   * @returns Promise<EvaluationResult> - The evaluation result
   */
  async evaluate(
    response: AgentResponse,
    question: Question
  ): Promise<EvaluationResult> {
    // Validate input
    if (!response) {
      throw new Error('Response is required');
    }
    if (!question) {
      throw new Error('Question is required');
    }
    if (question.postgres_sha !== POSTGRES_SHA) {
      throw new Error(`Question postgres_sha must be ${POSTGRES_SHA} for G4 compliance`);
    }

    // Initialize result
    const result: EvaluationResult = {
      correct: true,
      evidence_supported: true,
      major_missing_relation: false,
      critical_false_claim: false,
      coverage: 0,
      quality_score: 0,
      justification: '',
      verified_lines: [],
      verified_files: [],
      failed_claims: [],
      missing_relations: [],
      evaluation_id: response.run_id || `eval-${Date.now()}`,
      evaluated_at: new Date().toISOString(),
      evaluator_version: '1.0.0',
      claim_results: [],
      relation_results: [],
    };

    // Step 1: Verify each claim
    const claimResults = await this.evaluateClaims(response, question);
    result.claim_results = claimResults;
    
    for (const claimResult of claimResults) {
      // Track verified lines and files
      if (claimResult.verified) {
        const claim = response.claims.find(c => c.id === claimResult.claim_id);
        if (claim) {
          for (const citationId of claim.citations) {
            const citation = response.citations.find(c => c.id === citationId);
            if (citation) {
              if (!result.verified_lines.includes(`${citation.file}:${citation.line}`)) {
                result.verified_lines.push(`${citation.file}:${citation.line}`);
              }
              if (!result.verified_files.includes(citation.file)) {
                result.verified_files.push(citation.file);
              }
            }
          }
        }
      }
      
      // Update flags based on claim results
      if (!claimResult.supported) {
        result.evidence_supported = false;
        const claim = response.claims.find(c => c.id === claimResult.claim_id);
        if (claim) {
          result.failed_claims.push({
            claim: claim.statement,
            claim_id: claim.id,
            reason: 'unsupported',
            expected: claim.statement,
            actual: 'No supporting evidence found or verified',
            severity: claim.critical ? 'critical' : 'major',
          });
        }
      }
      
      if (claimResult.isFalse) {
        result.critical_false_claim = true;
        result.correct = false;
        const claim = response.claims.find(c => c.id === claimResult.claim_id);
        if (claim) {
          result.failed_claims.push({
            claim: claim.statement,
            claim_id: claim.id,
            reason: claimResult.reason || 'false',
            expected: claimResult.expected || 'Correct statement',
            actual: claim.statement,
            severity: claim.critical ? 'critical' : 'major',
          });
        }
      }
    }

    // Step 2: Check for missing relations — a critical relation counts as
    // missing when it is not provided OR provided-but-unverified against the
    // real code (a found-but-unverified relation is NOT an acceptable proof).
    const relationResults = await this.checkRelations(
      response.relations,
      question.relations_to_verify || [],
      response.citations
    );
    result.relation_results = relationResults;
    
    const missingCritical = relationResults.filter(
      r => (!r.found || !r.verified) && r.expected.critical
    );
    
    if (missingCritical.length > 0) {
      result.major_missing_relation = true;
      result.missing_relations = missingCritical.map(r => r.expected);
      result.correct = false;
    }

    // Fabricated relation evidence — a citation pointing at a nonexistent
    // file or an out-of-range line — is a critical false claim (spec §6:
    // proofs are verified against the real code, fabricated proofs fail).
    const fabricatedRelations = relationResults.filter(r => r.fabricated);
    if (fabricatedRelations.length > 0) {
      result.critical_false_claim = true;
      result.correct = false;
      result.failed_claims.push({
        claim: `Relation${fabricatedRelations.length > 1 ? 's' : ''} with fabricated citation evidence: ${fabricatedRelations.map(r => r.relation_id).join(', ')}`,
        claim_id: 'relation-fabricated-evidence',
        reason: 'fabricated_evidence',
        expected: 'Citations pointing at existing files and lines in the fixture',
        actual: 'Citations pointing at nonexistent files or out-of-range lines',
        severity: 'critical',
      });
    }

    // Step 3: Calculate coverage
    result.coverage = await this.calculateCoverage(
      response.citations,
      question.expected_areas || []
    );

    // Step 4: Calculate quality score
    result.quality_score = this.calculateQualityScore(result);

    // Step 5: Generate justification
    result.justification = this.generateJustification(result, response, question);

    // Final check: A Tour is only correct if ALL conditions are met
    result.correct = result.correct && 
      result.evidence_supported && 
      !result.major_missing_relation && 
      !result.critical_false_claim &&
      result.coverage >= this.config.thresholds.min_coverage;

    return result;
  }

  /**
   * Evaluate each claim in the response
   */
  private async evaluateClaims(
    response: AgentResponse,
    question: Question
  ): Promise<Array<{
    claim_id: string;
    supported: boolean;
    verified: boolean;
    isFalse: boolean;
    reason?: string;
    expected?: string;
  }>> {
    const results = [];
    
    for (const claim of response.claims) {
      const claimResult = await this.evaluateClaim(claim, response.citations);
      
      results.push({
        claim_id: claim.id,
        supported: claimResult.supported,
        verified: claimResult.verified,
        isFalse: claimResult.isFalse,
        reason: claimResult.reason,
        expected: claimResult.expected,
      });
    }
    
    return results;
  }

  /**
   * Evaluate a single claim
   *
   * A claim is supported only by citations that verify against the real
   * fixture code. A citation pointing at a nonexistent file or line is
   * FABRICATED evidence: for a critical claim this makes the claim a false
   * claim (spec §6); for any claim it makes the claim unsupported.
   */
  private async evaluateClaim(
    claim: Claim,
    citations: Citation[]
  ): Promise<{
    supported: boolean;
    verified: boolean;
    isFalse: boolean;
    reason?: string;
    expected?: string;
  }> {
    // If no citations, claim is unsupported
    if (!claim.citations || claim.citations.length === 0) {
      return {
        supported: false,
        verified: false,
        isFalse: false,
        reason: 'No citations provided',
      };
    }

    // Get the citations referenced by this claim
    const supportingCitations = citations.filter(c => 
      claim.citations.includes(c.id)
    );
    
    // If no supporting citations found (invalid citation IDs)
    if (supportingCitations.length === 0) {
      return {
        supported: false,
        verified: false,
        isFalse: false,
        reason: 'Citations not found',
      };
    }

    // Verify each supporting citation
    let anyValid = false;
    let anyFalse = false;
    let anyFabricated = false;
    let reason: string | undefined;
    let expected: string | undefined;
    
    for (const citation of supportingCitations) {
      const verification = await this.verifyCitation(citation);
      
      if (verification.valid) {
        anyValid = true;
      } else {
        if (!verification.file_exists || !verification.line_valid) {
          // The cited location does not exist in the fixture: fabricated
          // evidence, not merely an insufficient one.
          anyFabricated = true;
          reason = verification.error || 'Citation points at a nonexistent file/line';
          expected = 'An existing file and line inside the fixture at the pinned SHA';
        } else if (verification.file_exists && verification.line_valid) {
          // The line exists but doesn't match the claimed content
          // This could indicate a false claim
          anyFalse = true;
          reason = verification.error || 'Citation does not match code';
          expected = verification.actual_content;
        }
      }
    }

    // If at least one valid citation, the claim is supported
    const supported = anyValid;
    const verified = anyValid && !anyFalse && !anyFabricated;
    const isFalse = (anyFalse || (anyFabricated && claim.critical === true)) && !anyValid;
    const notSupportedReason = anyFabricated
      ? 'Fabricated evidence (citation to nonexistent file/line)'
      : 'No valid citation supporting this claim';
    
    // Special case: if claim is critical and false, mark as false
    if (claim.critical && (isFalse || (anyFabricated && !anyValid))) {
      return {
        supported: false,
        verified: false,
        isFalse: true,
        reason: reason || notSupportedReason,
        expected,
      };
    }
    
    return {
      supported,
      verified,
      isFalse,
      reason: reason,
      expected,
    };
  }

  /**
   * Verify a citation against PostgreSQL code
   */
  private async verifyCitation(citation: Citation): Promise<CitationVerificationResult> {
    const result: CitationVerificationResult = {
      citation_id: citation.id,
      valid: false,
      file_exists: false,
      line_valid: false,
      content_matches: false,
      context_matches: false,
    };

    try {
      // Read the file
      const filePath = this.getPostgresFilePath(citation.file);
      const fileContent = await this.readFile(filePath);
      
      if (!fileContent) {
        result.error = `File not found: ${filePath}`;
        return result;
      }
      
      result.file_exists = true;
      
      // Split into lines
      const lines = fileContent.split('\n');
      
      // Check line number validity
      if (citation.line < 1 || citation.line > lines.length) {
        result.error = `Line ${citation.line} out of range (file has ${lines.length} lines)`;
        result.line_valid = false;
        return result;
      }
      
      result.line_valid = true;
      
      // Get the actual line (0-indexed)
      const actualLine = lines[citation.line - 1];
      const actualContent = actualLine.trim();
      const claimedContent = citation.content.trim();
      
      // Check exact match
      if (this.verificationOptions.check_exact_match) {
        // Normalize whitespace for comparison
        const normalizedActual = this.normalizeContent(actualContent);
        const normalizedClaimed = this.normalizeContent(claimedContent);
        
        result.content_matches = normalizedActual === normalizedClaimed;
        
        if (!result.content_matches && this.verificationOptions.fuzzy_match) {
          // Try fuzzy matching
          const similarity = this.calculateSimilarity(normalizedActual, normalizedClaimed);
          result.content_matches = similarity >= this.verificationOptions.fuzzy_threshold;
        }
      } else {
        result.content_matches = true;
      }
      
      // Check context
      if (this.verificationOptions.check_context && citation.context) {
        const contextLines = this.getContextLines(citation, lines);
        const actualContext = contextLines.join('\n');
        result.context_matches = actualContext.includes(citation.context);
      } else {
        result.context_matches = true;
      }
      
      // Overall validity
      result.valid = result.file_exists && 
        result.line_valid && 
        result.content_matches && 
        result.context_matches;
      
      if (!result.valid) {
        result.error = 'Citation verification failed';
        result.actual_content = actualContent;
        result.actual_line = citation.line;
      }
      
    } catch (error) {
      result.error = `Error verifying citation: ${error}`;
      result.valid = false;
    }
    
    return result;
  }

  /**
   * Get context lines around a citation
   */
  private getContextLines(citation: Citation, lines: string[]): string[] {
    const contextBefore = citation.startLine ? Math.max(0, citation.startLine - 1) : Math.max(0, citation.line - 3);
    const contextAfter = citation.endLine ? Math.min(lines.length, citation.endLine) : Math.min(lines.length, citation.line + 2);
    
    return lines.slice(contextBefore, contextAfter);
  }

  /**
   * Normalize content for comparison (remove extra whitespace, normalize line endings)
   */
  private normalizeContent(content: string): string {
    return content
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Calculate similarity between two strings (simple implementation)
   */
  private calculateSimilarity(s1: string, s2: string): number {
    const longer = Math.max(s1.length, s2.length);
    if (longer === 0) return 1;
    
    let common = 0;
    for (let i = 0; i < s1.length; i++) {
      if (s2.includes(s1[i])) {
        common++;
        s2 = s2.replace(s1[i], '');
      }
    }
    
    return common / longer;
  }

  /**
   * Check relations against expected relations, verifying every provided
   * relation's citations against the REAL fixture code. A relation is
   * `verified` only when its citation evidence proves it against the code;
   * `fabricated` marks evidence pointing at nonexistent files/lines (a
   * critical false claim, spec §6).
   */
  private async checkRelations(
    providedRelations: Relation[],
    expectedRelations: ExpectedRelation[],
    responseCitations: Citation[]
  ): Promise<Array<{
    relation_id: string;
    expected: ExpectedRelation;
    found: boolean;
    verified: boolean;
    fabricated: boolean;
    reason?: string;
  }>> {
    const results = [];
    
    for (const expected of expectedRelations) {
      let found = false;
      let verified = false;
      let fabricated = false;
      let reason: string | undefined;
      
      // Look for matching relation
      for (const provided of providedRelations) {
        if (this.relationsMatch(provided, expected)) {
          found = true;
          
          // Verify the relation against the real code through its citations
          if (provided.citations && provided.citations.length > 0) {
            const verification = await this.verifyRelation(provided, expected, responseCitations);
            verified = verification.verified;
            fabricated = verification.fabricated;
            reason = verification.reason;
          } else {
            verified = false;
            reason = 'Relation provided without any citation';
          }
          break;
        }
      }
      
      results.push({
        relation_id: expected.from + '->' + expected.to,
        expected,
        found,
        verified,
        fabricated,
        reason,
      });
    }
    
    return results;
  }

  /**
   * Check if two relations match
   */
  private relationsMatch(provided: Relation, expected: ExpectedRelation): boolean {
    // Direct match (same entities, same type)
    const directMatch = 
      (provided.from === expected.from && 
       provided.to === expected.to &&
       provided.type === expected.type);
    
    // Bidirectional match (for calls/uses relationships)
    const bidirectionalMatch = 
      (provided.from === expected.to && 
       provided.to === expected.from) &&
      (provided.type === 'calls' || provided.type === 'uses') &&
      (expected.type === 'calls' || expected.type === 'uses');
    
    // Name-based match (ignore exact type if entities match)
    const nameMatch = 
      (provided.from === expected.from && 
       provided.to === expected.to) ||
      (provided.from === expected.to && 
       provided.to === expected.from);
    
    return directMatch || bidirectionalMatch || nameMatch;
  }

  /**
   * Verify a relation against the REAL code. Every citation must point at an
   * existing file with a valid line; the cited context must carry structural
   * evidence of the claimed relation: both endpoint symbols present, and for
   * a directional `calls` relation the target in call syntax. Citations to
   * nonexistent files/lines are fabricated evidence, never a valid proof.
   */
  private async verifyRelation(
    provided: Relation,
    expected: ExpectedRelation,
    responseCitations: Citation[]
  ): Promise<{ verified: boolean; fabricated: boolean; reason?: string }> {
    // If no citations, cannot verify
    if (!provided.citations || provided.citations.length === 0) {
      return { verified: false, fabricated: false, reason: 'No citations provided for relation' };
    }
    
    // The directional requirement comes from the PRE-REGISTERED expectation,
    // not from what the response chose to claim: a 'uses' prose claim cannot
    // verify an expected 'calls' relation.
    const directional = (expected.type || provided.type) === 'calls';
    const fromSymbol = this.lastSymbolOf(provided.from);
    const toSymbol = this.lastSymbolOf(provided.to);

    for (const citationRef of provided.citations) {
      const citation = responseCitations.find(c => c.id === citationRef);
      if (!citation) {
        return { verified: false, fabricated: true, reason: `Relation cites unknown citation id: ${citationRef}` };
      }

      const fileContent = await this.readFile(this.getPostgresFilePath(citation.file));
      if (fileContent === null) {
        return { verified: false, fabricated: true, reason: `Citation file not found in fixture: ${citation.file}` };
      }
      const lines = fileContent.split('\n');
      if (citation.line < 1 || citation.line > lines.length) {
        return { verified: false, fabricated: true, reason: `Citation line out of range: ${citation.file}:${citation.line}` };
      }

      // Structural evidence inside the cited context window.
      const window = this.getContextLines(citation, lines).join('\n');
      if (fromSymbol && toSymbol) {
        if (!window.includes(fromSymbol) || !window.includes(toSymbol)) {
          return {
            verified: false,
            fabricated: false,
            reason: `Cited context does not evidence both endpoints (${fromSymbol}, ${toSymbol})`,
          };
        }
        if (directional && !new RegExp(`${this.escapeRegExp(toSymbol)}\\s*\\(`).test(window)) {
          return {
            verified: false,
            fabricated: false,
            reason: `Call direction not evidenced in cited context (no ${toSymbol}(...) invocation)`,
          };
        }
      }
    }
    
    return { verified: true, fabricated: false };
  }

  /** Last meaningful identifier of an entity name (strip scopes/paths). */
  private lastSymbolOf(entity: string): string | undefined {
    const parts = entity.split(/[./::\\]+/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : undefined;
  }

  /** Escape a symbol for safe inclusion in a RegExp. */
  private escapeRegExp(symbol: string): string {
    return symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Calculate coverage of expected areas
   */
  private async calculateCoverage(
    citations: Citation[],
    expectedAreas: ExpectedArea[]
  ): number {
    if (expectedAreas.length === 0) {
      // If no expected areas, check if we have any citations
      return citations.length > 0 ? 1 : 0;
    }
    
    let coveredAreas = 0;
    
    for (const expectedArea of expectedAreas) {
      // Check if any VERIFIED citation covers this area: the cited file must
      // REALLY exist in the fixture and the cited line must exist — a
      // citation to a nonexistent file/line cannot cover anything.
      for (const citation of citations) {
        if (citation.file === expectedArea.file) {
          const content = await this.readFile(this.getPostgresFilePath(citation.file));
          if (content === null) {
            continue; // nonexistent/unreadable file cannot prove coverage
          }
          const lineCount = content.split('\n').length;
          if (citation.line < 1 || citation.line > lineCount) {
            continue; // fabricated line number
          }
          // Check if line is in expected range
          if (expectedArea.lines) {
            if (Array.isArray(expectedArea.lines)) {
              if (expectedArea.lines.includes(citation.line)) {
                coveredAreas++;
                break;
              }
            } else {
              // It's a range
              const range = expectedArea.lines as { start: number; end: number };
              if (citation.line >= range.start && citation.line <= range.end) {
                coveredAreas++;
                break;
              }
            }
          } else {
            // No specific lines, any citation in the file counts
            coveredAreas++;
            break;
          }
        }
      }
    }
    
    return coveredAreas / expectedAreas.length;
  }

  /**
   * Calculate overall quality score (0-1)
   */
  private calculateQualityScore(result: Partial<EvaluationResult>): number {
    let score = 0;
    let weightSum = 0;
    
    // Coverage weight: 40%
    score += (result.coverage || 0) * 0.4;
    weightSum += 0.4;
    
    // Evidence support weight: 30%
    score += (result.evidence_supported ? 1 : 0) * 0.3;
    weightSum += 0.3;
    
    // No major missing relations weight: 15%
    score += (!result.major_missing_relation ? 1 : 0) * 0.15;
    weightSum += 0.15;
    
    // No critical false claims weight: 15%
    score += (!result.critical_false_claim ? 1 : 0) * 0.15;
    weightSum += 0.15;
    
    // Penalize for failed claims
    const failedClaimPenalty = result.failed_claims?.length || 0;
    score -= failedClaimPenalty * 0.05; // 5% penalty per failed claim
    
    // Normalize and clamp
    score = Math.max(0, Math.min(1, score / weightSum));
    
    return score;
  }

  /**
   * Generate a human-readable justification
   */
  private generateJustification(
    result: Partial<EvaluationResult>,
    response: AgentResponse,
    question: Question
  ): string {
    const parts: string[] = [];
    
    if (result.correct) {
      parts.push('✓ Tour is correct and meets all quality criteria.');
      parts.push(`✓ Coverage: ${((result.coverage || 0) * 100).toFixed(1)}%`);
      if (result.verified_lines && result.verified_lines.length > 0) {
        parts.push(`✓ Verified ${result.verified_lines.length} lines across ${result.verified_files?.length || 0} files.`);
      }
      return parts.join(' ');
    }
    
    // Start with overall status
    parts.push(result.correct ? '✓ Tour is CORRECT' : '✗ Tour is INCORRECT');
    
    // Add reasons for failure
    if (!result.evidence_supported) {
      parts.push('✗ Not all claims are supported by evidence.');
    }
    
    if (result.major_missing_relation) {
      parts.push('✗ Major relation is missing.');
      if (result.missing_relations && result.missing_relations.length > 0) {
        const missingStr = result.missing_relations
          .map(r => `${r.from} → ${r.to} (${r.type})`)
          .join(', ');
        parts.push(`Missing: ${missingStr}`);
      }
    }
    
    if (result.critical_false_claim) {
      parts.push('✗ Critical false claim detected.');
    }
    
    if (result.failed_claims && result.failed_claims.length > 0) {
      const criticalFailures = result.failed_claims.filter(f => f.severity === 'critical');
      const majorFailures = result.failed_claims.filter(f => f.severity === 'major');
      
      if (criticalFailures.length > 0) {
        parts.push(`✗ ${criticalFailures.length} critical claim failure(s).`);
      }
      if (majorFailures.length > 0) {
        parts.push(`⚠ ${majorFailures.length} major claim failure(s).`);
      }
    }
    
    if (result.coverage !== undefined && result.coverage < this.config.thresholds.min_coverage) {
      parts.push(`⚠ Coverage ${((result.coverage) * 100).toFixed(1)}% is below threshold ${this.config.thresholds.min_coverage * 100}%`);
    }
    
    return parts.join(' ');
  }

  /**
   * Get the full path to a PostgreSQL file
   */
  private getPostgresFilePath(file: string): string {
    return `${this.config.postgres_path}/${file}`;
  }

  /**
   * Read a file from disk (with caching). Reads the REAL file from the
   * fixture: any path resolved outside the fixture root is rejected, so a
   * citation can only prove itself against the checked-out PostgreSQL tree.
   * A nonexistent file returns null (verification then reports
   * file_exists=false — fabricated evidence).
   */
  private async readFile(filePath: string): Promise<string | null> {
    // Check cache
    if (this.fileCache.has(filePath)) {
      return this.fileCache.get(filePath)!;
    }
    
    try {
      const root = path.resolve(this.config.postgres_path);
      const resolved = path.resolve(filePath);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        return null; // outside the fixture: cannot be used as evidence
      }
      const content = fs.readFileSync(resolved, 'utf-8');
      this.fileCache.set(filePath, content);
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Clear caches (for testing)
   */
  clearCaches(): void {
    this.fileCache.clear();
  }

  /**
   * Set verification options
   */
  setVerificationOptions(options: Partial<VerificationOptions>): void {
    this.verificationOptions = { ...this.verificationOptions, ...options };
  }

  /**
   * Get current configuration
   */
  getConfig(): GraderConfig {
    return { ...this.config };
  }
}

/**
 * Create a new TourGrader with default configuration
 */
export function createGrader(config?: Partial<GraderConfig>): TourGrader {
  return new TourGrader(config);
}

// Export types for convenience
export type {
  AgentResponse,
  Claim,
  Citation,
  ExpectedArea,
  ExpectedRelation,
  EvaluationResult,
  FailedClaim,
  GraderConfig,
  Question,
  Relation,
};
