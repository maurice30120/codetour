/**
 * Spec #174 - T06: Arbitrator Module
 * 
 * Handles disagreement resolution between multiple graders.
 * 
 * G4 Compliance Requirements:
 * - If evaluators disagree: second evaluation by arbitrator
 * - Preserve initial verdict and arbitration reason
 * - Final judgment = arbitrator judgment
 */

import {
  AgentResponse,
  Arbitration,
  EvaluationResult,
  FinalEvaluation,
  Question,
} from './types';
import { TourGrader, createGrader } from './grader';

/**
 * Arbitrator class for resolving evaluation disagreements
 */
export class Arbitrator {
  private graders: TourGrader[];
  private arbitratorGrader: TourGrader;
  
  constructor(graders: TourGrader[] = []) {
    if (graders.length === 0) {
      // Create default graders
      this.graders = [
        createGrader(),
        createGrader(),
      ];
    } else {
      this.graders = graders;
    }
    
    // Arbitrator uses a separate grader instance
    this.arbitratorGrader = createGrader();
  }

  /**
   * Perform arbitration on a response
   * 
   * Process:
   * 1. Get initial evaluation from first grader
   * 2. Get second evaluation from second grader
   * 3. If they agree, use that judgment
   * 4. If they disagree, use arbitrator judgment
   * 5. Always preserve initial verdict and arbitration reason
   * 
   * @param response - The agent response to evaluate
   * @param question - The question
   * @returns Promise<Arbitration> - The arbitration record
   */
  async arbitrate(
    response: AgentResponse,
    question: Question
  ): Promise<Arbitration> {
    // Step 1: Get initial evaluations from all graders
    const initialJudgments: EvaluationResult[] = [];
    
    for (const grader of this.graders) {
      const judgment = await grader.evaluate(response, question);
      initialJudgments.push(judgment);
    }
    
    // Check if all graders agree
    const allAgree = this.doJudgmentsAgree(...initialJudgments);
    
    if (allAgree) {
      // If all agree, use the first judgment
      const finalJudgment = initialJudgments[0];
      
      return {
        evaluation_id: response.run_id || `arb-${Date.now()}`,
        question_id: question.id,
        initial_judgments: initialJudgments,
        arbitrator_judgment: finalJudgment,
        final_judgment: finalJudgment,
        reason: 'All graders agreed',
        arbitrated_at: new Date().toISOString(),
      };
    }
    
    // Step 2: If disagreement, use arbitrator
    const arbitratorJudgment = await this.arbitratorGrader.evaluate(response, question);
    
    // Step 3: Create arbitration record
    return {
      evaluation_id: response.run_id || `arb-${Date.now()}`,
      question_id: question.id,
      initial_judgments: initialJudgments,
      arbitrator_judgment: arbitratorJudgment,
      final_judgment: arbitratorJudgment,
      reason: this.describeDisagreement(initialJudgments),
      arbitrated_at: new Date().toISOString(),
      disagreement_details: this.getDisagreementDetails(initialJudgments),
    };
  }

  /**
   * Batch arbitration for multiple responses
   */
  async arbitrateBatch(
    responses: AgentResponse[],
    questions: Question[]
  ): Promise<Arbitration[]> {
    if (responses.length !== questions.length) {
      throw new Error('Responses and questions must have the same length');
    }
    
    const arbitrations: Arbitration[] = [];
    
    for (let i = 0; i < responses.length; i++) {
      const arbitration = await this.arbitrate(responses[i], questions[i]);
      arbitrations.push(arbitration);
    }
    
    return arbitrations;
  }

  /**
   * Check if multiple judgments agree
   * 
   * Two judgments agree if:
   * - correct values match
   * - evidence_supported values match
   * - major_missing_relation values match
   * - critical_false_claim values match
   */
  private doJudgmentsAgree(...judgments: EvaluationResult[]): boolean {
    if (judgments.length === 0) return true;
    if (judgments.length === 1) return true;
    
    const first = judgments[0];
    
    for (let i = 1; i < judgments.length; i++) {
      const other = judgments[i];
      
      if (first.correct !== other.correct) return false;
      if (first.evidence_supported !== other.evidence_supported) return false;
      if (first.major_missing_relation !== other.major_missing_relation) return false;
      if (first.critical_false_claim !== other.critical_false_claim) return false;
    }
    
    return true;
  }

  /**
   * Describe the nature of disagreement
   */
  private describeDisagreement(judgments: EvaluationResult[]): string {
    const discrepancies: string[] = [];
    
    for (let i = 0; i < judgments.length; i++) {
      for (let j = i + 1; j < judgments.length; j++) {
        const j1 = judgments[i];
        const j2 = judgments[j];
        
        if (j1.correct !== j2.correct) {
          discrepancies.push(`Grader ${i + 1} said correct=${j1.correct}, Grader ${j + 1} said correct=${j2.correct}`);
        }
        if (j1.evidence_supported !== j2.evidence_supported) {
          discrepancies.push(`Grader ${i + 1} said evidence_supported=${j1.evidence_supported}, Grader ${j + 1} said evidence_supported=${j2.evidence_supported}`);
        }
        if (j1.major_missing_relation !== j2.major_missing_relation) {
          discrepancies.push(`Grader ${i + 1} said major_missing_relation=${j1.major_missing_relation}, Grader ${j + 1} said major_missing_relation=${j2.major_missing_relation}`);
        }
        if (j1.critical_false_claim !== j2.critical_false_claim) {
          discrepancies.push(`Grader ${i + 1} said critical_false_claim=${j1.critical_false_claim}, Grader ${j + 1} said critical_false_claim=${j2.critical_false_claim}`);
        }
      }
    }
    
    if (discrepancies.length === 0) {
      return 'Judgments disagree but reasons unclear';
    }
    
    return discrepancies.join('; ');
  }

  /**
   * Get detailed disagreement information
   */
  private getDisagreementDetails(judgments: EvaluationResult[]): string {
    const details: string[] = [];
    
    for (let i = 0; i < judgments.length; i++) {
      const j = judgments[i];
      details.push(`Grader ${i + 1}: correct=${j.correct}, evidence=${j.evidence_supported}, ` +
        `missing_relation=${j.major_missing_relation}, false_claim=${j.critical_false_claim}, ` +
        `coverage=${j.coverage}, quality=${j.quality_score}, ` +
        `failed_claims=${j.failed_claims?.length || 0}`);
    }
    
    return details.join(' | ');
  }

  /**
   * Create a final evaluation record including arbitration
   */
  createFinalEvaluation(
    arbitration: Arbitration,
    agent: string,
    runId: string
  ): FinalEvaluation {
    return {
      evaluation_id: arbitration.evaluation_id,
      question_id: arbitration.question_id,
      agent,
      run_id: runId,
      result: arbitration.final_judgment,
      arbitration,
      evaluated_at: arbitration.arbitrated_at,
      finalized_at: new Date().toISOString(),
    };
  }

  /**
   * Count statistics from arbitrations
   */
  getStatistics(arbitrations: Arbitration[]): {
    total: number;
    agreed: number;
    disagreed: number;
    overturned: number;
    arbitrationRate: number;
  } {
    let agreed = 0;
    let disagreed = 0;
    let overturned = 0;
    
    for (const arb of arbitrations) {
      if (arb.reason.includes('agreed')) {
        agreed++;
      } else {
        disagreed++;
        
        // Check if arbitrator overturned initial majority
        const initialCorrect = arb.initial_judgments.map(j => j.correct);
        const majorityCorrect = initialCorrect.reduce((acc, c) => acc + (c ? 1 : 0), 0) > initialCorrect.length / 2;
        
        if (arb.final_judgment.correct !== majorityCorrect) {
          overturned++;
        }
      }
    }
    
    const total = arbitrations.length;
    
    return {
      total,
      agreed,
      disagreed,
      overturned,
      arbitrationRate: total > 0 ? disagreed / total : 0,
    };
  }
}

/**
 * Simple arbitration function (for basic use cases)
 */
export async function simpleArbitrate(
  response: AgentResponse,
  question: Question,
  grader1: TourGrader,
  grader2: TourGrader
): Promise<Arbitration> {
  const arbitrator = new Arbitrator([grader1, grader2]);
  return arbitrator.arbitrate(response, question);
}

/**
 * Create a default arbitrator
 */
export function createArbitrator(): Arbitrator {
  return new Arbitrator();
}

export type { EvaluationResult, AgentResponse, Question, Arbitration, FinalEvaluation };
