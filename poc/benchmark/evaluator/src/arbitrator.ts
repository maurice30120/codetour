import { AgentResponse, BlindedResponse, Arbitration, EvaluationResult, FinalEvaluation, Question } from './types';
import { TourGrader } from './grader';
import { anonymizeResponse } from './blinder';

export class Arbitrator {
  constructor(private graders: TourGrader[] = [], private arbitratorGrader?: TourGrader) {
    const all = [...graders, ...(arbitratorGrader ? [arbitratorGrader] : [])];
    const ids = all.map(g => g.getConfig().semantic_reviewer?.id);
    if (all.length && (ids.some(id => !id?.trim()) || new Set(ids).size !== ids.length)) {
      throw new Error('Independent reviewers must have distinct nonempty identities');
    }
    const configurations = all.map(g => {
      const config = g.getConfig();
      return JSON.stringify([config.postgres_path, config.postgres_sha, config.thresholds,
        config.strict_mode, config.verify_all_citations]);
    });
    if (new Set(configurations).size > 1) throw new Error('All graders must use the same fixture and criteria');
  }

  async arbitrate(input: AgentResponse | BlindedResponse, question: Question): Promise<Arbitration> {
    if (this.graders.length < 2) throw new Error('At least two independent reviewers are required');
    const response = 'run_id' in input ? anonymizeResponse(input) : structuredClone(input);
    const initial = await Promise.all(this.graders.map(g => g.evaluate(structuredClone(response), question)));
    const agree = initial.every(j => this.decisions(j) === this.decisions(initial[0]));
    const unresolved = initial.some(j => j.review_required);
    if (agree && !unresolved) return {
      status: 'agreed', evaluation_id: response.evaluation_id, question_id: question.id,
      initial_judgments: initial, arbitrator_judgment: initial[0], final_judgment: initial[0],
      reason: 'All independent graders agreed', arbitrated_at: new Date().toISOString(),
    };
    const reason = agree ? 'Initial judgments require manual review' : 'Independent graders disagree';
    const final = this.arbitratorGrader ?
      await this.arbitratorGrader.evaluate(structuredClone(response), question) :
      { ...initial[0], correct: false, evidence_supported: false, review_required: true,
        justification: 'Manual arbitration required; no independent adjudicator supplied.' };
    const pending = !this.arbitratorGrader || final.review_required === true;
    return {
      status: pending ? 'pending' : 'arbitrated',
      evaluation_id: response.evaluation_id, question_id: question.id,
      initial_judgments: initial,
      arbitrator_judgment: this.arbitratorGrader ? final : undefined,
      final_judgment: final, reason: reason + (pending ? '; manual arbitration required' : '; using adjudicator judgment'),
      arbitrator_id: this.arbitratorGrader?.getConfig().semantic_reviewer?.id,
      arbitrated_at: new Date().toISOString(),
      disagreement_details: initial.map(j => j.justification).join(' | '),
    };
  }

  private decisions(j: EvaluationResult): string {
    return JSON.stringify({
      correct: j.correct, evidence_supported: j.evidence_supported,
      major_missing_relation: j.major_missing_relation, critical_false_claim: j.critical_false_claim,
      coverage: j.coverage, quality_score: j.quality_score, review_required: j.review_required,
      criteria_version: j.criteria_version, verified_lines: j.verified_lines,
      failed_claims: j.failed_claims.map(f => [f.claim_id, f.reason, f.severity]),
      missing_relations: j.missing_relations,
      claims: j.claim_results?.map(c => [c.claim_id, c.supported, c.verified, c.false]),
      relations: j.relation_results,
      criteria: j.semantic_review?.criteria.map(c => [c.criterion_id, c.met, c.citations]),
    });
  }

  async arbitrateBatch(responses: Array<AgentResponse | BlindedResponse>, questions: Question[]): Promise<Arbitration[]> {
    if (responses.length !== questions.length) throw new Error('Responses and questions must have the same length');
    const records: Arbitration[] = [];
    for (let i = 0; i < responses.length; i++) records.push(await this.arbitrate(responses[i], questions[i]));
    return records;
  }

  createFinalEvaluation(arbitration: Arbitration, agent: string, runId: string): FinalEvaluation {
    if (arbitration.status === 'pending') throw new Error('Manual arbitration is still pending');
    return {
      evaluation_id: arbitration.evaluation_id, question_id: arbitration.question_id,
      agent, run_id: runId, result: arbitration.final_judgment, arbitration,
      evaluated_at: arbitration.arbitrated_at, finalized_at: new Date().toISOString(),
    };
  }

  getStatistics(records: Arbitration[]): {
    total: number; agreed: number; disagreed: number; overturned: number; arbitrationRate: number;
  } {
    const agreed = records.filter(r => r.status === 'agreed').length;
    const disagreed = records.length - agreed;
    const overturned = records.filter(r => r.status === 'arbitrated' &&
      r.final_judgment.correct !==
        (r.initial_judgments.filter(j => j.correct).length > r.initial_judgments.length / 2)).length;
    return { total: records.length, agreed, disagreed, overturned,
      arbitrationRate: records.length ? disagreed / records.length : 0 };
  }
}

export async function simpleArbitrate(response: AgentResponse | BlindedResponse, question: Question,
  grader1: TourGrader, grader2: TourGrader, adjudicator?: TourGrader): Promise<Arbitration> {
  return new Arbitrator([grader1, grader2], adjudicator).arbitrate(response, question);
}

export function createArbitrator(graders: TourGrader[] = [], adjudicator?: TourGrader): Arbitrator {
  return new Arbitrator(graders, adjudicator);
}
