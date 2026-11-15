import { execFileSync } from 'child_process';
import { isAbsolute } from 'path';
import { anonymizeResponse, verifyBlinding } from './blinder';
import {
  AgentResponse, BlindedResponse, Citation, EvaluationResult,
  ExpectedArea, GraderConfig, POSTGRES_SHA, Question, SemanticFinding, SemanticReview,
} from './types';

const DEFAULT_CONFIG: GraderConfig = {
  postgres_path: 'poc/benchmark/postgres',
  postgres_sha: POSTGRES_SHA,
  thresholds: {
    min_coverage: 0.7, max_missing_critical_relations: 0,
    max_false_claims: 0, critical_false_claim_weight: 1,
  },
  strict_mode: true,
  verify_all_citations: true,
};

export class TourGrader {
  private config: GraderConfig;

  constructor(config: Partial<GraderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config,
      thresholds: { ...DEFAULT_CONFIG.thresholds, ...config.thresholds } };
    if (!/^[a-f0-9]{40}$/.test(this.config.postgres_sha)) {
      throw new Error('A full fixture commit SHA is required');
    }
  }

  async evaluate(input: AgentResponse | BlindedResponse, question: Question): Promise<EvaluationResult> {
    if (!input || !question) throw new Error('Response and question are required');
    const response = 'run_id' in input ? anonymizeResponse(input) : input;
    const blinding = verifyBlinding(response, this.config.postgres_sha);
    if (!blinding.valid) throw new Error('Invalid blind response: ' + blinding.issues.join(', '));
    if (question.postgres_sha !== this.config.postgres_sha ||
        response.postgres_sha !== this.config.postgres_sha) {
      throw new Error('Response, question and fixture SHA must match');
    }
    if (response.question_id !== question.id) throw new Error('Question ID mismatch');
    this.verifyFixture();
    const citations = response.citations.map(c => this.verifyCitation(c)).filter((c): c is Citation => c !== undefined);
    const validIds = new Set(citations.map(c => c.id));
    const result: EvaluationResult = {
      evaluation_id: response.evaluation_id, evaluated_at: new Date().toISOString(),
      evaluator_version: '2.0.0', criteria_version: 't06-v2',
      correct: false, evidence_supported: false,
      major_missing_relation: question.relations_to_verify.some(r => r.critical),
      critical_false_claim: false, coverage: 0, quality_score: 0,
      justification: 'Unsupported: independent semantic review required.',
      verified_lines: citations.map(c => c.file + ':' + c.line),
      verified_files: [...new Set(citations.map(c => c.file))],
      failed_claims: response.claims.map(c => ({
        claim: c.statement, claim_id: c.id, reason: 'unsupported',
        severity: c.critical ? 'critical' : 'major',
      })),
      missing_relations: question.relations_to_verify.filter(r => r.critical),
      claim_results: response.claims.map(c => ({
        claim_id: c.id, supported: false, verified: false, false: false,
        reason: 'Source locations alone do not establish semantic truth',
      })),
      relation_results: question.relations_to_verify.map(expected => ({
        relation_id: expected.from + '->' + expected.to, expected,
        found: response.relations.some(r => r.from === expected.from && r.to === expected.to && r.type === expected.type),
        verified: false,
      })),
      review_required: true,
    };
    const covered = question.expected_areas.filter(a =>
      citations.some(c => validIds.has(c.id) && this.inArea(c, a)));
    result.coverage = question.expected_areas.length ? covered.length / question.expected_areas.length : 0;
    if (this.config.semantic_reviewer) {
      try {
        const review = await this.config.semantic_reviewer.review(structuredClone({
          response, question, verified_citations: citations, criteria_version: 't06-v2',
        }));
        this.applyReview(result, response, question, review, validIds);
      } catch (error) {
        result.justification = 'Unsupported: independent semantic review unavailable: ' + String(error);
      }
    }
    return result;
  }

  private applyReview(result: EvaluationResult, response: BlindedResponse, question: Question,
    review: SemanticReview, validIds: Set<string>): void {
    const usable = (finding: Pick<SemanticFinding, 'reason' | 'citations'> | undefined, refs?: string[]): boolean => !!finding &&
      !!finding.reason?.trim() && finding.citations.length > 0 &&
      finding.citations.every(id => validIds.has(id) && (!refs || refs.includes(id)));
    const supported = (finding: SemanticFinding | undefined, refs?: string[]): boolean =>
      usable(finding, refs) && finding?.verdict === 'supported';
    const unique = (ids: string[]): boolean => new Set(ids).size === ids.length;
    if (!review.review_id?.trim() || !unique(review.claims.map(c => c.claim_id)) ||
        !unique(review.relations.map(r => r.relation_id)) ||
        !unique(review.criteria.map(c => c.criterion_id))) {
      throw new Error('Review ID and unique findings are required');
    }
    result.review_id = review.review_id;
    result.reviewer_id = this.config.semantic_reviewer?.id;
    result.semantic_review = structuredClone(review);
    result.failed_claims = [];
    for (const citation of response.citations.filter(c => !validIds.has(c.id))) {
      result.failed_claims.push({ claim: 'Citation ' + citation.file + ':' + citation.line,
        claim_id: citation.id, reason: 'false', severity: 'major', actual: 'Citation does not verify against committed source' });
    }
    result.claim_results = response.claims.map(claim => {
      const finding = review.claims.find(c => c.claim_id === claim.id);
      const evidenceValid = claim.citations.length > 0 && claim.citations.every(id => validIds.has(id));
      const verified = evidenceValid && supported(finding, claim.citations);
      const fabricated = claim.citations.some(id => !validIds.has(id));
      const isFalse = (usable(finding, claim.citations) && finding?.verdict === 'refuted') || fabricated;
      if (!verified) result.failed_claims.push({
        claim: claim.statement, claim_id: claim.id,
        reason: isFalse ? 'false' : 'unsupported',
        actual: finding?.reason ?? 'Independent semantic review missing',
        severity: claim.critical ? 'critical' : 'major',
      });
      if (isFalse && claim.critical) result.critical_false_claim = true;
      return { claim_id: claim.id, supported: verified, verified, false: isFalse, reason: finding?.reason };
    });
    const verifiedRelations = response.relations.filter(relation => {
      const finding = review.relations.find(r => r.relation_id === relation.id);
      const evidenceValid = relation.citations.length > 0 && relation.citations.every(id => validIds.has(id));
      const verified = evidenceValid && supported(finding, relation.citations);
      if (!verified) result.failed_claims.push({
        claim: relation.from + ' ' + relation.type + ' ' + relation.to,
        claim_id: relation.id, reason: finding?.verdict === 'refuted' ? 'wrong_relation' : 'unsupported',
        actual: finding?.reason ?? 'Independent relation review missing', severity: 'major',
      });
      if (usable(finding, relation.citations) && finding?.verdict === 'refuted' &&
          question.relations_to_verify.some(r => r.critical &&
            (r.from === relation.from || r.to === relation.to))) result.critical_false_claim = true;
      return verified;
    });
    result.relation_results = question.relations_to_verify.map(expected => {
      const matches = (r: Pick<typeof expected, 'from' | 'to' | 'type'>): boolean =>
        r.from === expected.from && r.to === expected.to && r.type === expected.type;
      const narrativeFinding = review.expected_relations?.find(matches);
      return { relation_id: expected.from + '->' + expected.to, expected,
        found: response.relations.some(matches) || narrativeFinding !== undefined,
        verified: verifiedRelations.some(matches) || supported(narrativeFinding) };
    });
    result.missing_relations = result.relation_results.filter(r => !r.verified && r.expected.critical).map(r => r.expected);
    result.major_missing_relation = result.missing_relations.length > 0;
    const criteriaMet = question.criteria.filter(c => c.required).every(c => {
      const finding = review.criteria.find(f => f.criterion_id === c.id);
      return finding?.met === true && usable(finding);
    });
    result.evidence_supported = supported(review.response) && result.failed_claims.length === 0;
    const criticalAreasCovered = question.expected_areas.filter(a => a.critical).every(a =>
      response.citations.some(c => validIds.has(c.id) && this.inArea(c, a)));
    result.review_required = !usable(review.response) || review.response.verdict === 'unsupported' ||
      result.failed_claims.some(f => f.reason === 'unsupported');
    result.correct = result.evidence_supported && !result.major_missing_relation &&
      !result.critical_false_claim && criticalAreasCovered && criteriaMet &&
      result.coverage >= Math.max(this.config.thresholds.min_coverage, question.thresholds?.min_coverage ?? 0) &&
      response.tour.steps.length > 0 && response.status !== 'partial' && response.status !== 'error' &&
      response.truncated !== true;
    result.quality_score = result.correct ? result.coverage : 0;
    result.justification = (result.correct ? 'CORRECT: ' : 'INCORRECT: ') + review.response.reason +
      (result.major_missing_relation ? ' Missing verified critical relation.' : '') +
      (!criteriaMet ? ' Required criterion unmet.' : '') +
      (!criticalAreasCovered ? ' Critical area uncovered.' : '') +
      (response.truncated || response.status === 'partial' || response.status === 'error' ? ' Incomplete response.' : '') +
      (result.review_required ? ' Unsupported; manual review required.' : '');
  }

  private git(...args: string[]): string {
    return execFileSync('git', ['-C', this.config.postgres_path, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  }

  private verifyFixture(): void {
    if (this.git('rev-parse', 'HEAD').trim() !== this.config.postgres_sha) {
      throw new Error('Fixture HEAD differs from the configured SHA');
    }
    if (this.git('status', '--porcelain', '--untracked-files=no').trim()) {
      throw new Error('Fixture has tracked modifications');
    }
  }

  private verifyCitation(citation: Citation): Citation | undefined {
    if (isAbsolute(citation.file) || citation.file.split(/[\\/]/).includes('..') ||
        !Number.isInteger(citation.line) || citation.line < 1) return undefined;
    try {
      if (!/^100(?:644|755) blob /.test(this.git('ls-tree', this.config.postgres_sha, '--', citation.file))) return undefined;
      const lines = this.git('show', this.config.postgres_sha + ':' + citation.file).split('\n');
      if (citation.line > lines.length || !lines[citation.line - 1].trim() ||
          (citation.content !== undefined && lines[citation.line - 1].trim() !== citation.content.trim())) return undefined;
      const start = citation.startLine ?? Math.max(1, citation.line - 3);
      const end = citation.endLine ?? Math.min(lines.length, citation.line + 3);
      if (!Number.isInteger(start) || !Number.isInteger(end) ||
          start < 1 || start > citation.line || end < citation.line || end > lines.length) return undefined;
      if (citation.context && lines.slice(start - 1, end).join('\n') !== citation.context) return undefined;
      return { ...citation, content: lines[citation.line - 1], context: lines.slice(start - 1, end).join('\n'), startLine: start, endLine: end };
    } catch {
      return undefined;
    }
  }

  private inArea(c: Citation, a: ExpectedArea): boolean {
    return c.file === a.file && (!a.lines || (Array.isArray(a.lines) ?
      a.lines.includes(c.line) : c.line >= a.lines.start && c.line <= a.lines.end));
  }

  clearCaches(): void {}
  getConfig(): GraderConfig {
    return { ...this.config, thresholds: { ...this.config.thresholds } };
  }
}

export function createGrader(config?: Partial<GraderConfig>): TourGrader {
  return new TourGrader(config);
}
