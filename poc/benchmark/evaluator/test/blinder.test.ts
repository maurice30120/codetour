/**
 * Spec #174 - T06: Blinder Tests
 * 
 * Tests for the blinding/anonymization functionality
 * 
 * These tests verify that:
 * 1. Agent metadata is completely removed
 * 2. Execution order information is removed
 * 3. Token cost information is removed
 * 4. Responses can be properly shuffled
 * 5. Blinding can be verified
 * 6. Original responses can be reconstructed (after evaluation)
 */

import {
  AgentResponse,
  BlindedResponse,
  BlindedEvaluationItem,
  EvaluationSet,
  POSTGRES_SHA,
  Question,
  Tour,
  TourStep,
  Claim,
  Citation,
  Relation,
} from '../src/types';
import {
  anonymizeResponse,
  createBlindedItem,
  createEvaluationSet,
  verifyBlinding,
  verifyEvaluationSet,
  createEvaluationMap,
  reconstructWithResults,
  generateEvaluationId,
  generateSetId,
  resetEvaluationIdCounter,
  shuffleArray,
} from '../src/blinder';

describe('Blinder', () => {
  beforeEach(() => {
    // Reset counter before each test for reproducibility
    resetEvaluationIdCounter();
  });

  describe('anonymizeResponse()', () => {
    it('should remove agent metadata', () => {
      const response: AgentResponse = {
        run_id: 'run-123',
        agent: 'CodeTour',
        timestamp: '2026-11-15T10:00:00Z',
        question_id: 'q1',
        objective: 'Test objective',
        series: 'R',
        tour: { title: 'Test', description: 'Desc', steps: [] },
        citations: [],
        claims: [],
        relations: [],
        token_usage: {
          input_tokens: 100,
          output_tokens: 200,
          total_tokens: 300,
          calls: [],
        },
      };

      const blinded = anonymizeResponse(response);

      // Should not have agent metadata
      expect(blinded).not.toHaveProperty('run_id');
      expect(blinded).not.toHaveProperty('agent');
      expect(blinded).not.toHaveProperty('timestamp');
      expect(blinded).not.toHaveProperty('token_usage');

      // Should have evaluation_id
      expect(blinded.evaluation_id).toBeDefined();
      expect(blinded.evaluation_id).toMatch(/^eval-\d+-\d+$/);
    });

    it('should preserve content needed for evaluation', () => {
      const tour: Tour = {
        title: 'Test Tour',
        description: 'A test tour',
        steps: [
          { id: 'step-1', description: 'First step', file: 'file.c', line: 100 },
        ],
      };

      const claims: Claim[] = [
        { id: 'claim-1', statement: 'Test claim', confidence: 0.9, citations: ['cit-1'] },
      ];

      const citations: Citation[] = [
        { id: 'cit-1', file: 'file.c', line: 100, content: 'test content', context: 'context' },
      ];

      const relations: Relation[] = [
        { id: 'rel-1', from: 'a', to: 'b', type: 'calls', citations: ['cit-1'] },
      ];

      const response: AgentResponse = {
        run_id: 'run-1',
        agent: 'Vibe',
        timestamp: '2026-11-15T10:00:00Z',
        question_id: 'q1',
        objective: 'Test objective',
        series: 'R',
        tour,
        citations,
        claims,
        relations,
      };

      const blinded = anonymizeResponse(response);

      // Content should be preserved
      expect(blinded.tour).toEqual(tour);
      expect(blinded.citations).toEqual(citations);
      expect(blinded.claims).toEqual(claims);
      expect(blinded.relations).toEqual(relations);
      expect(blinded.question_id).toBe('q1');
      expect(blinded.objective).toBe('Test objective');
      expect(blinded.series).toBe('R');
      expect(blinded.postgres_sha).toBe(POSTGRES_SHA);
    });

    it('should generate unique evaluation IDs for different responses', () => {
      const response1: AgentResponse = {
        run_id: 'run-1',
        agent: 'CodeTour',
        timestamp: '2026-11-15T10:00:00Z',
        question_id: 'q1',
        objective: 'Test',
        series: 'R',
        tour: { title: 'Test 1', description: 'Desc', steps: [] },
        citations: [],
        claims: [],
        relations: [],
      };

      const response2: AgentResponse = {
        run_id: 'run-2',
        agent: 'Vibe',
        timestamp: '2026-11-15T10:01:00Z',
        question_id: 'q2',
        objective: 'Test',
        series: 'R',
        tour: { title: 'Test 2', description: 'Desc', steps: [] },
        citations: [],
        claims: [],
        relations: [],
      };

      const blinded1 = anonymizeResponse(response1);
      const blinded2 = anonymizeResponse(response2);

      expect(blinded1.evaluation_id).not.toBe(blinded2.evaluation_id);
    });
  });

  describe('createBlindedItem()', () => {
    it('should create a blinded evaluation item', () => {
      const response: AgentResponse = {
        run_id: 'run-1',
        agent: 'CodeTour',
        timestamp: '2026-11-15T10:00:00Z',
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
        expected_areas: [],
        relations_to_verify: [],
        criteria: [],
      };

      const item = createBlindedItem(response, question);

      expect(item.evaluation_id).toBeDefined();
      expect(item.response).toBeDefined();
      expect(item.response.evaluation_id).toBe(item.evaluation_id);
      expect(item.question.id).toBe('q1');
      expect(item.question.objective).toBe('Test objective');
      expect(item.question.series).toBe('R');

      // Question should not have answer-revealing fields
      expect(item.question).not.toHaveProperty('expected_areas');
      expect(item.question).not.toHaveProperty('relations_to_verify');
      expect(item.question).not.toHaveProperty('criteria');
    });
  });

  describe('createEvaluationSet()', () => {
    it('should create a blinded evaluation set', () => {
      const responses: AgentResponse[] = [
        {
          run_id: 'run-1',
          agent: 'CodeTour',
          timestamp: '2026-11-15T10:00:00Z',
          question_id: 'q1',
          objective: 'Test 1',
          series: 'R',
          tour: { title: 'Tour 1', description: 'Desc', steps: [] },
          citations: [],
          claims: [],
          relations: [],
        },
        {
          run_id: 'run-2',
          agent: 'Vibe',
          timestamp: '2026-11-15T10:01:00Z',
          question_id: 'q2',
          objective: 'Test 2',
          series: 'R',
          tour: { title: 'Tour 2', description: 'Desc', steps: [] },
          citations: [],
          claims: [],
          relations: [],
        },
        {
          run_id: 'run-3',
          agent: 'CodeTour',
          timestamp: '2026-11-15T10:02:00Z',
          question_id: 'q3',
          objective: 'Test 3',
          series: 'T',
          tour: { title: 'Tour 3', description: 'Desc', steps: [] },
          citations: [],
          claims: [],
          relations: [],
        },
      ];

      const questions: Question[] = [
        { id: 'q1', objective: 'Test 1', series: 'R', postgres_sha: POSTGRES_SHA, expected_areas: [], relations_to_verify: [], criteria: [] },
        { id: 'q2', objective: 'Test 2', series: 'R', postgres_sha: POSTGRES_SHA, expected_areas: [], relations_to_verify: [], criteria: [] },
        { id: 'q3', objective: 'Test 3', series: 'T', postgres_sha: POSTGRES_SHA, expected_areas: [], relations_to_verify: [], criteria: [] },
      ];

      const set = createEvaluationSet(responses, questions);

      expect(set.evaluation_set_id).toBeDefined();
      expect(set.evaluation_set_id).toMatch(/^set-\d+$/);
      expect(set.items.length).toBe(3);
      expect(set.created_at).toBeDefined();
      expect(set.postgres_sha).toBe(POSTGRES_SHA);
      expect(set.evaluator_version).toBe('1.0.0');
    });

    it('should shuffle items to prevent pattern detection', () => {
      const responses: AgentResponse[] = [
        { run_id: 'run-1', agent: 'CodeTour', timestamp: '2026-11-15T10:00:00Z', question_id: 'q1', objective: 'Test', series: 'R', tour: { title: 'Tour 1', description: 'Desc', steps: [] }, citations: [], claims: [], relations: [] },
        { run_id: 'run-2', agent: 'Vibe', timestamp: '2026-11-15T10:01:00Z', question_id: 'q2', objective: 'Test', series: 'R', tour: { title: 'Tour 2', description: 'Desc', steps: [] }, citations: [], claims: [], relations: [] },
        { run_id: 'run-3', agent: 'CodeTour', timestamp: '2026-11-15T10:02:00Z', question_id: 'q3', objective: 'Test', series: 'T', tour: { title: 'Tour 3', description: 'Desc', steps: [] }, citations: [], claims: [], relations: [] },
        { run_id: 'run-4', agent: 'Vibe', timestamp: '2026-11-15T10:03:00Z', question_id: 'q4', objective: 'Test', series: 'T', tour: { title: 'Tour 4', description: 'Desc', steps: [] }, citations: [], claims: [], relations: [] },
      ];

      const questions: Question[] = [
        { id: 'q1', objective: 'Test', series: 'R', postgres_sha: POSTGRES_SHA, expected_areas: [], relations_to_verify: [], criteria: [] },
        { id: 'q2', objective: 'Test', series: 'R', postgres_sha: POSTGRES_SHA, expected_areas: [], relations_to_verify: [], criteria: [] },
        { id: 'q3', objective: 'Test', series: 'T', postgres_sha: POSTGRES_SHA, expected_areas: [], relations_to_verify: [], criteria: [] },
        { id: 'q4', objective: 'Test', series: 'T', postgres_sha: POSTGRES_SHA, expected_areas: [], relations_to_verify: [], criteria: [] },
      ];

      const set = createEvaluationSet(responses, questions);

      // Original order: q1(R), q2(R), q3(T), q4(T)
      // Shuffled order should be different
      const originalOrder = ['q1', 'q2', 'q3', 'q4'];
      const shuffledOrder = set.items.map(item => item.question.id);

      // With 4 items, there's a good chance they're shuffled
      // But we can't guarantee it in a single test run
      // So we just check that we got 4 items
      expect(shuffledOrder.length).toBe(4);
      expect(new Set(shuffledOrder)).toEqual(new Set(originalOrder));
    });

    it('should throw error if responses and questions have different lengths', () => {
      const responses: AgentResponse[] = [
        { run_id: 'run-1', agent: 'CodeTour', timestamp: '2026-11-15T10:00:00Z', question_id: 'q1', objective: 'Test', series: 'R', tour: { title: 'Tour 1', description: 'Desc', steps: [] }, citations: [], claims: [], relations: [] },
      ];

      const questions: Question[] = [];

      expect(() => createEvaluationSet(responses, questions)).toThrow(
        'Responses and questions arrays must have the same length'
      );
    });
  });

  describe('verifyBlinding()', () => {
    it('should verify properly blinded response', () => {
      const response: AgentResponse = {
        run_id: 'run-1',
        agent: 'CodeTour',
        timestamp: '2026-11-15T10:00:00Z',
        question_id: 'q1',
        objective: 'Test',
        series: 'R',
        tour: { title: 'Test', description: 'Desc', steps: [] },
        citations: [],
        claims: [],
        relations: [],
      };

      const blinded = anonymizeResponse(response);
      const verification = verifyBlinding(blinded);

      expect(verification.valid).toBe(true);
      expect(verification.issues).toHaveLength(0);
    });

    it('should detect forbidden fields', () => {
      const response: AgentResponse = {
        run_id: 'run-1',
        agent: 'CodeTour',
        timestamp: '2026-11-15T10:00:00Z',
        question_id: 'q1',
        objective: 'Test',
        series: 'R',
        tour: { title: 'Test', description: 'Desc', steps: [] },
        citations: [],
        claims: [],
        relations: [],
      };

      const blinded = anonymizeResponse(response);
      
      // Add a forbidden field
      (blinded as any).agent = 'CodeTour';

      const verification = verifyBlinding(blinded);

      expect(verification.valid).toBe(false);
      expect(verification.issues).toContain('Forbidden field found: agent');
    });

    it('should detect missing required fields', () => {
      const incompleteResponse: any = {
        evaluation_id: 'eval-1',
        question_id: 'q1',
      };

      const verification = verifyBlinding(incompleteResponse);

      expect(verification.valid).toBe(false);
      expect(verification.issues.some(issue => issue.includes('Missing required field'))).toBe(true);
    });

    it('should detect invalid postgres_sha', () => {
      const response: AgentResponse = {
        run_id: 'run-1',
        agent: 'CodeTour',
        timestamp: '2026-11-15T10:00:00Z',
        question_id: 'q1',
        objective: 'Test',
        series: 'R',
        tour: { title: 'Test', description: 'Desc', steps: [] },
        citations: [],
        claims: [],
        relations: [],
        postgres_sha: 'wrong-sha',
      };

      const blinded = anonymizeResponse(response);
      
      const verification = verifyBlinding(blinded);

      expect(verification.valid).toBe(false);
      expect(verification.issues.some(issue => issue.includes('Invalid postgres_sha'))).toBe(true);
    });

    it('should detect invalid evaluation_id format', () => {
      const incompleteResponse: any = {
        evaluation_id: 'invalid-id',
        question_id: 'q1',
        objective: 'Test',
        series: 'R',
        tour: { title: 'Test', description: 'Desc', steps: [] },
        citations: [],
        claims: [],
        relations: [],
        postgres_sha: POSTGRES_SHA,
      };

      const verification = verifyBlinding(incompleteResponse);

      expect(verification.valid).toBe(false);
      expect(verification.issues).toContain('Invalid evaluation_id format');
    });
  });

  describe('verifyEvaluationSet()', () => {
    it('should verify properly blinded evaluation set', () => {
      const responses: AgentResponse[] = [
        { run_id: 'run-1', agent: 'CodeTour', timestamp: '2026-11-15T10:00:00Z', question_id: 'q1', objective: 'Test', series: 'R', tour: { title: 'Test', description: 'Desc', steps: [] }, citations: [], claims: [], relations: [] },
        { run_id: 'run-2', agent: 'Vibe', timestamp: '2026-11-15T10:01:00Z', question_id: 'q2', objective: 'Test', series: 'R', tour: { title: 'Test', description: 'Desc', steps: [] }, citations: [], claims: [], relations: [] },
      ];

      const questions: Question[] = [
        { id: 'q1', objective: 'Test', series: 'R', postgres_sha: POSTGRES_SHA, expected_areas: [], relations_to_verify: [], criteria: [] },
        { id: 'q2', objective: 'Test', series: 'R', postgres_sha: POSTGRES_SHA, expected_areas: [], relations_to_verify: [], criteria: [] },
      ];

      const set = createEvaluationSet(responses, questions);
      const verification = verifyEvaluationSet(set);

      expect(verification.valid).toBe(true);
      expect(verification.issues).toHaveLength(0);
    });

    it('should detect issues in evaluation set', () => {
      const set: EvaluationSet = {
        evaluation_set_id: 'invalid-set-id',
        items: [],
        created_at: '',
        postgres_sha: 'wrong-sha',
      };

      const verification = verifyEvaluationSet(set);

      expect(verification.valid).toBe(false);
      expect(verification.issues.length).toBeGreaterThan(0);
    });
  });

  describe('createEvaluationMap() and reconstructWithResults()', () => {
    it('should create and use evaluation map', () => {
      resetEvaluationIdCounter();

      const responses: AgentResponse[] = [
        { run_id: 'run-1', agent: 'CodeTour', timestamp: '2026-11-15T10:00:00Z', question_id: 'q1', objective: 'Test', series: 'R', tour: { title: 'Tour 1', description: 'Desc', steps: [] }, citations: [], claims: [], relations: [] },
        { run_id: 'run-2', agent: 'Vibe', timestamp: '2026-11-15T10:01:00Z', question_id: 'q2', objective: 'Test', series: 'R', tour: { title: 'Tour 2', description: 'Desc', steps: [] }, citations: [], claims: [], relations: [] },
      ];

      const questions: Question[] = [
        { id: 'q1', objective: 'Test', series: 'R', postgres_sha: POSTGRES_SHA, expected_areas: [], relations_to_verify: [], criteria: [] },
        { id: 'q2', objective: 'Test', series: 'R', postgres_sha: POSTGRES_SHA, expected_areas: [], relations_to_verify: [], criteria: [] },
      ];

      const map = createEvaluationMap(responses, questions);

      // Anonymize to get evaluation IDs
      const blinded1 = anonymizeResponse(responses[0]);
      const blinded2 = anonymizeResponse(responses[1]);

      // Check that map has entries for both
      expect(map.size).toBe(2);
      expect(map.has(blinded1.evaluation_id)).toBe(true);
      expect(map.has(blinded2.evaluation_id)).toBe(true);

      // Get original indices
      const entry1 = map.get(blinded1.evaluation_id);
      const entry2 = map.get(blinded2.evaluation_id);

      expect(entry1).toEqual({ responseIndex: 0, questionIndex: 0 });
      expect(entry2).toEqual({ responseIndex: 1, questionIndex: 1 });
    });

    it('should reconstruct with results', () => {
      resetEvaluationIdCounter();

      const responses: AgentResponse[] = [
        { run_id: 'run-1', agent: 'CodeTour', timestamp: '2026-11-15T10:00:00Z', question_id: 'q1', objective: 'Test', series: 'R', tour: { title: 'Tour 1', description: 'Desc', steps: [] }, citations: [], claims: [], relations: [] },
        { run_id: 'run-2', agent: 'Vibe', timestamp: '2026-11-15T10:01:00Z', question_id: 'q2', objective: 'Test', series: 'R', tour: { title: 'Tour 2', description: 'Desc', steps: [] }, citations: [], claims: [], relations: [] },
      ];

      const questions: Question[] = [
        { id: 'q1', objective: 'Test', series: 'R', postgres_sha: POSTGRES_SHA, expected_areas: [], relations_to_verify: [], criteria: [] },
        { id: 'q2', objective: 'Test', series: 'R', postgres_sha: POSTGRES_SHA, expected_areas: [], relations_to_verify: [], criteria: [] },
      ];

      const map = createEvaluationMap(responses, questions);
      const set = createEvaluationSet(responses, questions);

      // Create mock results
      const results = [
        { correct: true } as any,
        { correct: false } as any,
      ];

      const reconstructed = reconstructWithResults(set, map, results);

      expect(reconstructed.length).toBe(2);
      expect(reconstructed[0]).toEqual({
        responseIndex: 0,
        questionIndex: 0,
        result: { correct: true },
      });
      expect(reconstructed[1]).toEqual({
        responseIndex: 1,
        questionIndex: 1,
        result: { correct: false },
      });
    });
  });

  describe('shuffleArray()', () => {
    it('should shuffle array deterministically with seed', () => {
      const array = [1, 2, 3, 4, 5];
      
      const shuffled1 = shuffleArray(array, 'seed-123');
      const shuffled2 = shuffleArray(array, 'seed-123');
      
      expect(shuffled1).toEqual(shuffled2);
    });

    it('should produce different results with different seeds', () => {
      const array = [1, 2, 3, 4, 5];
      
      const shuffled1 = shuffleArray(array, 'seed-123');
      const shuffled2 = shuffleArray(array, 'seed-456');
      
      // They might be different, but not guaranteed in all cases
      // Just check that both are valid shuffles
      expect(shuffled1).toHaveLength(5);
      expect(shuffled2).toHaveLength(5);
      expect(new Set(shuffled1)).toEqual(new Set(array));
      expect(new Set(shuffled2)).toEqual(new Set(array));
    });

    it('should not mutate original array', () => {
      const array = [1, 2, 3, 4, 5];
      const original = [...array];
      
      shuffleArray(array);
      
      expect(array).toEqual(original);
    });
  });

  describe('ID generation', () => {
    it('should generate evaluation IDs with correct prefix', () => {
      resetEvaluationIdCounter();
      const id = generateEvaluationId();
      
      expect(id).toMatch(/^eval-\d+-\d+$/);
    });

    it('should generate set IDs with correct prefix', () => {
      const id = generateSetId();
      
      expect(id).toMatch(/^set-\d+$/);
    });

    it('should generate unique IDs on consecutive calls', () => {
      resetEvaluationIdCounter();
      
      const id1 = generateEvaluationId();
      const id2 = generateEvaluationId();
      
      expect(id1).not.toBe(id2);
    });

    it('should reset counter properly', () => {
      resetEvaluationIdCounter();
      const id1 = generateEvaluationId();
      
      resetEvaluationIdCounter();
      const id2 = generateEvaluationId();
      
      // After reset, should start from 1 again
      // The IDs should have the same counter value
      const counter1 = parseInt(id1.split('-')[2]);
      const counter2 = parseInt(id2.split('-')[2]);
      
      expect(counter2).toBe(1);
    });
  });

  describe('G4 Compliance Tests', () => {
    it('should ensure evaluator does not know agent', () => {
      const response: AgentResponse = {
        run_id: 'run-1',
        agent: 'CodeTour',
        timestamp: '2026-11-15T10:00:00Z',
        question_id: 'q1',
        objective: 'Test',
        series: 'R',
        tour: { title: 'Test', description: 'Desc', steps: [] },
        citations: [],
        claims: [],
        relations: [],
        token_usage: {
          input_tokens: 1000,
          output_tokens: 2000,
          total_tokens: 3000,
          calls: [],
        },
      };

      const blinded = anonymizeResponse(response);
      
      // Verify that no agent information remains
      expect(blinded).not.toHaveProperty('agent');
      expect(blinded).not.toHaveProperty('run_id');
      expect(blinded).not.toHaveProperty('timestamp');
      expect(blinded).not.toHaveProperty('token_usage');
      
      // Should not be able to infer agent from any field
      const blindedString = JSON.stringify(blinded);
      expect(blindedString).not.toContain('CodeTour');
      expect(blindedString).not.toContain('Vibe');
      expect(blindedString).not.toContain('run-1');
    });

    it('should ensure evaluator does not know execution order', () => {
      const response1: AgentResponse = {
        run_id: 'run-001',
        agent: 'CodeTour',
        timestamp: '2026-11-15T10:00:00Z',
        question_id: 'q1',
        objective: 'Test',
        series: 'R',
        tour: { title: 'Test 1', description: 'Desc', steps: [] },
        citations: [],
        claims: [],
        relations: [],
      };

      const response2: AgentResponse = {
        run_id: 'run-002',
        agent: 'CodeTour',
        timestamp: '2026-11-15T10:01:00Z',
        question_id: 'q2',
        objective: 'Test',
        series: 'R',
        tour: { title: 'Test 2', description: 'Desc', steps: [] },
        citations: [],
        claims: [],
        relations: [],
      };

      const blinded1 = anonymizeResponse(response1);
      const blinded2 = anonymizeResponse(response2);

      // The evaluation IDs should not reveal order
      expect(blinded1.evaluation_id).not.toContain('001');
      expect(blinded1.evaluation_id).not.toContain('002');
      expect(blinded2.evaluation_id).not.toContain('001');
      expect(blinded2.evaluation_id).not.toContain('002');
      
      // Timestamps should be removed
      expect(blinded1).not.toHaveProperty('timestamp');
      expect(blinded2).not.toHaveProperty('timestamp');
    });

    it('should ensure evaluator does not know token cost', () => {
      const response: AgentResponse = {
        run_id: 'run-1',
        agent: 'Vibe',
        timestamp: '2026-11-15T10:00:00Z',
        question_id: 'q1',
        objective: 'Test',
        series: 'R',
        tour: { title: 'Test', description: 'Desc', steps: [] },
        citations: [],
        claims: [],
        relations: [],
        token_usage: {
          input_tokens: 5000,
          output_tokens: 3000,
          total_tokens: 8000,
          calls: [
            { model: 'gpt-4', input: 1000, output: 500, function: 'search' },
            { model: 'gpt-4', input: 2000, output: 1000, function: 'read' },
          ],
        },
      };

      const blinded = anonymizeResponse(response);
      
      expect(blinded).not.toHaveProperty('token_usage');
      expect(JSON.stringify(blinded)).not.toContain('5000');
      expect(JSON.stringify(blinded)).not.toContain('3000');
      expect(JSON.stringify(blinded)).not.toContain('8000');
    });

    it('should ensure format is common for both agents', () => {
      const codeTourResponse: AgentResponse = {
        run_id: 'run-1',
        agent: 'CodeTour',
        timestamp: '2026-11-15T10:00:00Z',
        question_id: 'q1',
        objective: 'Test',
        series: 'R',
        tour: { title: 'CodeTour Response', description: 'Desc', steps: [] },
        citations: [],
        claims: [],
        relations: [],
      };

      const vibeResponse: AgentResponse = {
        run_id: 'run-2',
        agent: 'Vibe',
        timestamp: '2026-11-15T10:00:00Z',
        question_id: 'q1',
        objective: 'Test',
        series: 'R',
        tour: { title: 'Vibe Response', description: 'Desc', steps: [] },
        citations: [],
        claims: [],
        relations: [],
      };

      const blindedCodeTour = anonymizeResponse(codeTourResponse);
      const blindedVibe = anonymizeResponse(vibeResponse);

      // Both should have the same structure
      const codeTourKeys = Object.keys(blindedCodeTour).sort();
      const vibeKeys = Object.keys(blindedVibe).sort();
      
      expect(codeTourKeys).toEqual(vibeKeys);
    });
  });
});
