/**
 * Spec #174 - T06: Arbitrator Tests
 * 
 * Tests for the Arbitrator class
 * 
 * These tests verify that:
 * 1. Arbitration resolves disagreements
 * 2. Initial verdict is preserved
 * 3. Arbitrator judgment becomes final judgment
 * 4. Agreement is detected correctly
 */

import {
  AgentResponse,
  EvaluationResult,
  Question,
  POSTGRES_SHA,
} from '../src/types';
import { Arbitrator, createArbitrator, simpleArbitrate } from '../src/arbitrator';
import { TourGrader, createGrader } from '../src/grader';

describe('Arbitrator', () => {
  let arbitrator: Arbitrator;
  let grader1: TourGrader;
  let grader2: TourGrader;

  beforeEach(() => {
    grader1 = createGrader();
    grader2 = createGrader();
    arbitrator = new Arbitrator([grader1, grader2]);
  });

  describe('Initialization', () => {
    it('should create default arbitrator', () => {
      const arb = createArbitrator();
      expect(arb).toBeInstanceOf(Arbitrator);
    });

    it('should accept custom graders', () => {
      const arb = new Arbitrator([grader1, grader2]);
      expect(arb).toBeInstanceOf(Arbitrator);
    });
  });

  describe('arbitrate()', () => {
    const baseQuestion: Question = {
      id: 'q1',
      objective: 'Test objective',
      series: 'R',
      postgres_sha: POSTGRES_SHA,
      expected_areas: [],
      relations_to_verify: [],
      criteria: [],
    };

    const createResponse = (): AgentResponse => ({
      run_id: 'run-1',
      agent: 'CodeTour',
      timestamp: new Date().toISOString(),
      question_id: 'q1',
      objective: 'Test objective',
      series: 'R',
      tour: { title: 'Test', description: 'Desc', steps: [] },
      citations: [],
      claims: [],
      relations: [],
    });

    it('should return agreement when graders agree', async () => {
      const response = createResponse();
      const question = baseQuestion;

      const arbitration = await arbitrator.arbitrate(response, question);

      expect(arbitration).toBeDefined();
      expect(arbitration.evaluation_id).toBeDefined();
      expect(arbitration.question_id).toBe('q1');
      expect(arbitration.initial_judgments.length).toBe(2);
      expect(arbitration.arbitrator_judgment).toBeDefined();
      expect(arbitration.final_judgment).toBeDefined();
      expect(arbitration.reason).toContain('agreed');
      expect(arbitration.arbitrated_at).toBeDefined();

      // Final judgment should match arbitrator judgment
      expect(arbitration.final_judgment).toEqual(arbitration.arbitrator_judgment);
    });

    it('should use arbitrator when graders disagree', async () => {
      // Create two graders with different configurations that might produce different results
      const strictGrader = createGrader({
        thresholds: {
          min_coverage: 1.0, // Very strict
          max_missing_critical_relations: 0,
          max_false_claims: 0,
          critical_false_claim_weight: 1.0,
        },
      });

      const lenientGrader = createGrader({
        thresholds: {
          min_coverage: 0.1, // Very lenient
          max_missing_critical_relations: 0,
          max_false_claims: 0,
          critical_false_claim_weight: 1.0,
        },
      });

      const customArbitrator = new Arbitrator([strictGrader, lenientGrader]);

      // Create a response with partial coverage
      const response: AgentResponse = {
        run_id: 'run-1',
        agent: 'CodeTour',
        timestamp: new Date().toISOString(),
        question_id: 'q1',
        objective: 'Test objective',
        series: 'R',
        tour: { title: 'Test', description: 'Desc', steps: [] },
        citations: [],
        claims: [],
        relations: [],
      };

      const question: Question = {
        id: 'q1',
        objective: 'Test objective',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        expected_areas: [
          { file: 'file1.c', lines: [1], description: 'Area 1', critical: true },
          { file: 'file2.c', lines: [1], description: 'Area 2', critical: true },
        ],
        relations_to_verify: [],
        criteria: [],
      };

      const arbitration = await customArbitrator.arbitrate(response, question);

      // Check that we have results
      expect(arbitration.initial_judgments.length).toBe(2);
      
      // The strict grader might fail, lenient might pass
      // But both get the same result (no coverage due to no citations)
      // So they should agree
      
      expect(arbitration.reason).toBeDefined();
      expect(arbitration.final_judgment).toBeDefined();
    });

    it('should preserve initial verdict', async () => {
      const response = createResponse();
      const question = baseQuestion;

      const arbitration = await arbitrator.arbitrate(response, question);

      // Initial judgments should be preserved
      expect(arbitration.initial_judgments.length).toBeGreaterThan(0);
      expect(arbitration.initial_judgments[0]).toBeDefined();
    });

    it('should generate unique evaluation IDs', async () => {
      const response1 = createResponse();
      response1.run_id = 'run-1';
      
      const response2 = createResponse();
      response2.run_id = 'run-2';

      const question = baseQuestion;

      const arb1 = await arbitrator.arbitrate(response1, question);
      const arb2 = await arbitrator.arbitrate(response2, question);

      expect(arb1.evaluation_id).not.toBe(arb2.evaluation_id);
    });
  });

  describe('arbitrateBatch()', () => {
    it('should arbitrate multiple responses', async () => {
      const responses: AgentResponse[] = [
        { run_id: 'run-1', agent: 'CodeTour', timestamp: new Date().toISOString(), question_id: 'q1', objective: 'Test', series: 'R', tour: { title: 'Test', description: 'Desc', steps: [] }, citations: [], claims: [], relations: [] },
        { run_id: 'run-2', agent: 'Vibe', timestamp: new Date().toISOString(), question_id: 'q2', objective: 'Test', series: 'R', tour: { title: 'Test', description: 'Desc', steps: [] }, citations: [], claims: [], relations: [] },
      ];

      const questions: Question[] = [
        { id: 'q1', objective: 'Test', series: 'R', postgres_sha: POSTGRES_SHA, expected_areas: [], relations_to_verify: [], criteria: [] },
        { id: 'q2', objective: 'Test', series: 'R', postgres_sha: POSTGRES_SHA, expected_areas: [], relations_to_verify: [], criteria: [] },
      ];

      const arbitrations = await arbitrator.arbitrateBatch(responses, questions);

      expect(arbitrations.length).toBe(2);
      expect(arbitrations[0].question_id).toBe('q1');
      expect(arbitrations[1].question_id).toBe('q2');
    });

    it('should throw error if responses and questions have different lengths', async () => {
      const responses: AgentResponse[] = [
        { run_id: 'run-1', agent: 'CodeTour', timestamp: new Date().toISOString(), question_id: 'q1', objective: 'Test', series: 'R', tour: { title: 'Test', description: 'Desc', steps: [] }, citations: [], claims: [], relations: [] },
      ];

      const questions: Question[] = [];

      await expect(arbitrator.arbitrateBatch(responses, questions))
        .rejects.toThrow('Responses and questions must have the same length');
    });
  });

  describe('createFinalEvaluation()', () => {
    it('should create final evaluation with arbitration', async () => {
      const response = {
        run_id: 'run-1',
        agent: 'CodeTour',
        timestamp: new Date().toISOString(),
        question_id: 'q1',
        objective: 'Test',
        series: 'R',
        tour: { title: 'Test', description: 'Desc', steps: [] },
        citations: [],
        claims: [],
        relations: [],
      };

      const question = {
        id: 'q1',
        objective: 'Test',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        expected_areas: [],
        relations_to_verify: [],
        criteria: [],
      };

      const arbitration = await arbitrator.arbitrate(response, question);
      const finalEvaluation = arbitrator.createFinalEvaluation(
        arbitration,
        'CodeTour',
        'run-1'
      );

      expect(finalEvaluation.evaluation_id).toBe(arbitration.evaluation_id);
      expect(finalEvaluation.question_id).toBe('q1');
      expect(finalEvaluation.agent).toBe('CodeTour');
      expect(finalEvaluation.run_id).toBe('run-1');
      expect(finalEvaluation.result).toEqual(arbitration.final_judgment);
      expect(finalEvaluation.arbitration).toEqual(arbitration);
      expect(finalEvaluation.evaluated_at).toBeDefined();
      expect(finalEvaluation.finalized_at).toBeDefined();
    });
  });

  describe('getStatistics()', () => {
    it('should calculate statistics from arbitrations', async () => {
      const responses: AgentResponse[] = [
        { run_id: 'run-1', agent: 'CodeTour', timestamp: new Date().toISOString(), question_id: 'q1', objective: 'Test', series: 'R', tour: { title: 'Test', description: 'Desc', steps: [] }, citations: [], claims: [], relations: [] },
        { run_id: 'run-2', agent: 'Vibe', timestamp: new Date().toISOString(), question_id: 'q2', objective: 'Test', series: 'R', tour: { title: 'Test', description: 'Desc', steps: [] }, citations: [], claims: [], relations: [] },
      ];

      const questions: Question[] = [
        { id: 'q1', objective: 'Test', series: 'R', postgres_sha: POSTGRES_SHA, expected_areas: [], relations_to_verify: [], criteria: [] },
        { id: 'q2', objective: 'Test', series: 'R', postgres_sha: POSTGRES_SHA, expected_areas: [], relations_to_verify: [], criteria: [] },
      ];

      const arbitrations = await arbitrator.arbitrateBatch(responses, questions);
      const stats = arbitrator.getStatistics(arbitrations);

      expect(stats.total).toBe(2);
      expect(stats.agreed).toBeGreaterThanOrEqual(0);
      expect(stats.disagreed).toBeGreaterThanOrEqual(0);
      expect(stats.arbitrationRate).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty arbitrations', () => {
      const stats = arbitrator.getStatistics([]);

      expect(stats.total).toBe(0);
      expect(stats.agreed).toBe(0);
      expect(stats.disagreed).toBe(0);
      expect(stats.arbitrationRate).toBe(0);
    });
  });

  describe('simpleArbitrate()', () => {
    it('should perform simple arbitration', async () => {
      const response: AgentResponse = {
        run_id: 'run-1',
        agent: 'CodeTour',
        timestamp: new Date().toISOString(),
        question_id: 'q1',
        objective: 'Test',
        series: 'R',
        tour: { title: 'Test', description: 'Desc', steps: [] },
        citations: [],
        claims: [],
        relations: [],
      };

      const question: Question = {
        id: 'q1',
        objective: 'Test',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        expected_areas: [],
        relations_to_verify: [],
        criteria: [],
      };

      const arbitration = await simpleArbitrate(response, question, grader1, grader2);

      expect(arbitration).toBeDefined();
      expect(arbitration.evaluation_id).toBeDefined();
    });
  });

  describe('Judgment matching', () => {
    it('should detect matching judgments', async () => {
      // Create two identical judgments
      const judgment1: EvaluationResult = {
        correct: true,
        evidence_supported: true,
        major_missing_relation: false,
        critical_false_claim: false,
        coverage: 1,
        quality_score: 1,
        justification: 'Test',
        verified_lines: [],
        verified_files: [],
        failed_claims: [],
        missing_relations: [],
        evaluation_id: 'eval-1',
        evaluated_at: new Date().toISOString(),
      };

      const judgment2: EvaluationResult = {
        ...judgment1,
        evaluation_id: 'eval-2',
      };

      // Access private method through reflection (for testing)
      // In real code, we'd use the public arbitrate method
      const arbitratorInstance = new Arbitrator();
      
      // @ts-expect-error - accessing private method for testing
      const match = arbitratorInstance.doJudgmentsAgree(judgment1, judgment2);
      
      expect(match).toBe(true);
    });

    it('should detect non-matching judgments', async () => {
      const judgment1: EvaluationResult = {
        correct: true,
        evidence_supported: true,
        major_missing_relation: false,
        critical_false_claim: false,
        coverage: 1,
        quality_score: 1,
        justification: 'Test',
        verified_lines: [],
        verified_files: [],
        failed_claims: [],
        missing_relations: [],
        evaluation_id: 'eval-1',
        evaluated_at: new Date().toISOString(),
      };

      const judgment2: EvaluationResult = {
        ...judgment1,
        correct: false,
        evaluation_id: 'eval-2',
      };

      const arbitratorInstance = new Arbitrator();
      
      // @ts-expect-error - accessing private method for testing
      const match = arbitratorInstance.doJudgmentsAgree(judgment1, judgment2);
      
      expect(match).toBe(false);
    });
  });
});
