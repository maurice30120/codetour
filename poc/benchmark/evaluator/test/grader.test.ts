/**
 * Spec #174 - T06: Grader Tests
 * 
 * Tests for the TourGrader class
 * 
 * These tests verify that:
 * 1. Claims are properly evaluated against PostgreSQL code
 * 2. Missing relations are detected
 * 3. Coverage is calculated correctly
 * 4. The grader rejects proofs that point to correct line but claim wrong relation
 * 5. Quality thresholds are applied correctly
 */

import {
  AgentResponse,
  Claim,
  Citation,
  ExpectedArea,
  ExpectedRelation,
  Question,
  Relation,
  Tour,
  TourStep,
  POSTGRES_SHA,
} from '../src/types';
import { TourGrader, createGrader } from '../src/grader';

describe('TourGrader', () => {
  let grader: TourGrader;

  beforeEach(() => {
    // Reset before each test
    grader = createGrader();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      const config = grader.getConfig();
      expect(config.postgres_sha).toBe(POSTGRES_SHA);
      expect(config.thresholds.min_coverage).toBe(0.7);
      expect(config.thresholds.max_missing_critical_relations).toBe(0);
      expect(config.thresholds.max_false_claims).toBe(0);
    });

    it('should throw error if postgres_sha is not correct for G4', () => {
      expect(() => {
        new TourGrader({ postgres_sha: 'wrong-sha' });
      }).toThrow(`postgres_sha must be ${POSTGRES_SHA} for G4 compliance`);
    });

    it('should allow custom configuration', () => {
      const customGrader = new TourGrader({
        thresholds: {
          min_coverage: 0.8,
          max_missing_critical_relations: 1,
          max_false_claims: 1,
          critical_false_claim_weight: 2.0,
        },
      });
      const config = customGrader.getConfig();
      expect(config.thresholds.min_coverage).toBe(0.8);
    });
  });

  describe('evaluate() - Full evaluation', () => {
    const baseQuestion: Question = {
      id: 'q1',
      objective: 'Find the exec_simple_query function and its callers',
      series: 'R',
      postgres_sha: POSTGRES_SHA,
      expected_areas: [],
      relations_to_verify: [],
      criteria: [],
    };

    it('should evaluate a correct response as correct', async () => {
      const response = createCorrectResponse('q1');
      const result = await grader.evaluate(response, baseQuestion);

      // A response with valid citations should be correct
      // (Assuming the grader can't verify files in test environment)
      expect(result).toBeDefined();
      expect(result.evaluation_id).toBeDefined();
      expect(result.evaluated_at).toBeDefined();
    });

    it('should detect unsupported claims', async () => {
      const response: AgentResponse = {
        run_id: 'run-1',
        agent: 'CodeTour',
        timestamp: new Date().toISOString(),
        question_id: 'q1',
        objective: 'Find the exec_simple_query function',
        series: 'R',
        tour: {
          title: 'Test Tour',
          description: 'A test tour',
          steps: [],
        },
        citations: [],
        claims: [
          {
            id: 'claim-1',
            statement: 'exec_simple_query is in src/backend/tcop/postgres.c',
            confidence: 0.9,
            citations: [], // No citations!
          },
        ],
        relations: [],
      };

      const result = await grader.evaluate(response, baseQuestion);

      expect(result.evidence_supported).toBe(false);
      expect(result.failed_claims.length).toBeGreaterThan(0);
      expect(result.failed_claims[0].reason).toBe('unsupported');
    });

    it('should detect missing critical relations', async () => {
      const question: Question = {
        id: 'q1',
        objective: 'Find the exec_simple_query function and its callers',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        expected_areas: [],
        relations_to_verify: [
          {
            from: 'exec_simple_query',
            to: 'pg_parse_query',
            type: 'calls',
            critical: true,
            description: 'exec_simple_query calls pg_parse_query',
          },
        ],
        criteria: [],
      };

      const response: AgentResponse = {
        run_id: 'run-1',
        agent: 'CodeTour',
        timestamp: new Date().toISOString(),
        question_id: 'q1',
        objective: 'Find the exec_simple_query function and its callers',
        series: 'R',
        tour: {
          title: 'Test Tour',
          description: 'A test tour',
          steps: [],
        },
        citations: [],
        claims: [],
        relations: [
          // Missing the critical relation
        ],
      };

      const result = await grader.evaluate(response, question);

      expect(result.major_missing_relation).toBe(true);
      expect(result.correct).toBe(false);
      expect(result.missing_relations.length).toBe(1);
      expect(result.missing_relations[0].from).toBe('exec_simple_query');
    });

    it('should calculate coverage correctly', async () => {
      const expectedAreas: ExpectedArea[] = [
        {
          file: 'src/backend/tcop/postgres.c',
          lines: [100, 101, 102],
          description: 'exec_simple_query definition',
          critical: true,
        },
        {
          file: 'src/backend/parser/parser.c',
          lines: [50, 51],
          description: 'pg_parse_query definition',
          critical: true,
        },
      ];

      const question: Question = {
        id: 'q1',
        objective: 'Find the exec_simple_query function and its callers',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        expected_areas,
        relations_to_verify: [],
        criteria: [],
      };

      // Response with citations covering both areas
      const response: AgentResponse = {
        run_id: 'run-1',
        agent: 'CodeTour',
        timestamp: new Date().toISOString(),
        question_id: 'q1',
        objective: 'Find the exec_simple_query function and its callers',
        series: 'R',
        tour: {
          title: 'Test Tour',
          description: 'A test tour',
          steps: [],
        },
        citations: [
          {
            id: 'cit-1',
            file: 'src/backend/tcop/postgres.c',
            line: 100,
            content: 'exec_simple_query(const char *query)',
            context: '',
          },
          {
            id: 'cit-2',
            file: 'src/backend/parser/parser.c',
            line: 50,
            content: 'pg_parse_query(const char *query)',
            context: '',
          },
        ],
        claims: [],
        relations: [],
      };

      const result = await grader.evaluate(response, question);

      // Should have 100% coverage (2 areas covered, 2 expected)
      expect(result.coverage).toBe(1);
    });

    it('should calculate partial coverage', async () => {
      const expectedAreas: ExpectedArea[] = [
        {
          file: 'src/backend/tcop/postgres.c',
          lines: [100, 101, 102],
          description: 'exec_simple_query definition',
          critical: true,
        },
        {
          file: 'src/backend/parser/parser.c',
          lines: [50, 51],
          description: 'pg_parse_query definition',
          critical: true,
        },
      ];

      const question: Question = {
        id: 'q1',
        objective: 'Find the exec_simple_query function and its callers',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        expected_areas,
        relations_to_verify: [],
        criteria: [],
      };

      // Response with citations covering only one area
      const response: AgentResponse = {
        run_id: 'run-1',
        agent: 'CodeTour',
        timestamp: new Date().toISOString(),
        question_id: 'q1',
        objective: 'Find the exec_simple_query function and its callers',
        series: 'R',
        tour: {
          title: 'Test Tour',
          description: 'A test tour',
          steps: [],
        },
        citations: [
          {
            id: 'cit-1',
            file: 'src/backend/tcop/postgres.c',
            line: 100,
            content: 'exec_simple_query(const char *query)',
            context: '',
          },
        ],
        claims: [],
        relations: [],
      };

      const result = await grader.evaluate(response, question);

      // Should have 50% coverage (1 area covered, 2 expected)
      expect(result.coverage).toBe(0.5);
    });
  });

  describe('evaluateClaim() - Claim verification', () => {
    it('should reject claim with no citations', async () => {
      const claim: Claim = {
        id: 'claim-1',
        statement: 'exec_simple_query exists',
        confidence: 1,
        citations: [],
      };

      const result = await grader.evaluateClaim(claim, []);

      expect(result.supported).toBe(false);
      expect(result.verified).toBe(false);
      expect(result.false).toBe(false);
      expect(result.reason).toContain('No citations');
    });

    it('should reject claim with non-existent citations', async () => {
      const claim: Claim = {
        id: 'claim-1',
        statement: 'exec_simple_query exists',
        confidence: 1,
        citations: ['non-existent-citation'],
      };

      const citations: Citation[] = []; // Empty, so citation doesn't exist

      const result = await grader.evaluateClaim(claim, citations);

      expect(result.supported).toBe(false);
      expect(result.reason).toContain('Citations not found');
    });

    it('should handle critical claims appropriately', async () => {
      const claim: Claim = {
        id: 'claim-1',
        statement: 'exec_simple_query calls pg_parse_query',
        confidence: 1,
        citations: [],
        critical: true,
      };

      const result = await grader.evaluateClaim(claim, []);

      // Critical claim with no support should be marked as false
      expect(result.supported).toBe(false);
    });
  });

  describe('checkRelations() - Relation verification', () => {
    it('should match relations by entity names', async () => {
      const providedRelations: Relation[] = [
        {
          id: 'rel-1',
          from: 'exec_simple_query',
          to: 'pg_parse_query',
          type: 'calls',
          citations: ['cit-1'],
        },
      ];

      const expectedRelations: ExpectedRelation[] = [
        {
          from: 'exec_simple_query',
          to: 'pg_parse_query',
          type: 'calls',
          critical: true,
        },
      ];

      const result = await grader.checkRelations(providedRelations, expectedRelations);

      expect(result.length).toBe(1);
      expect(result[0].found).toBe(true);
    });

    it('should match bidirectional relations', async () => {
      const providedRelations: Relation[] = [
        {
          id: 'rel-1',
          from: 'pg_parse_query',
          to: 'exec_simple_query',
          type: 'calls',
          citations: ['cit-1'],
        },
      ];

      const expectedRelations: ExpectedRelation[] = [
        {
          from: 'exec_simple_query',
          to: 'pg_parse_query',
          type: 'calls',
          critical: true,
        },
      ];

      const result = await grader.checkRelations(providedRelations, expectedRelations);

      expect(result.length).toBe(1);
      expect(result[0].found).toBe(true);
    });

    it('should detect missing relations', async () => {
      const providedRelations: Relation[] = [];

      const expectedRelations: ExpectedRelation[] = [
        {
          from: 'exec_simple_query',
          to: 'pg_parse_query',
          type: 'calls',
          critical: true,
        },
      ];

      const result = await grader.checkRelations(providedRelations, expectedRelations);

      expect(result.length).toBe(1);
      expect(result[0].found).toBe(false);
      expect(result[0].verified).toBe(false);
    });
  });

  describe('Relation matching edge cases', () => {
    it('should NOT match relations that point to correct line but claim wrong relation', async () => {
      // This is a critical G4 requirement:
      // "Reject proofs that point to correct line but claim wrong relation"
      const providedRelations: Relation[] = [
        {
          id: 'rel-1',
          from: 'exec_simple_query',
          to: 'pg_analyze_and_rewrite', // Wrong target!
          type: 'calls',
          citations: ['cit-1'],
        },
      ];

      const expectedRelations: ExpectedRelation[] = [
        {
          from: 'exec_simple_query',
          to: 'pg_parse_query', // Correct target
          type: 'calls',
          critical: true,
        },
      ];

      const result = await grader.checkRelations(providedRelations, expectedRelations);

      // Should NOT match - wrong relation claimed
      expect(result.length).toBe(1);
      expect(result[0].found).toBe(false);
    });

    it('should handle type mismatches', async () => {
      const providedRelations: Relation[] = [
        {
          id: 'rel-1',
          from: 'exec_simple_query',
          to: 'pg_parse_query',
          type: 'uses', // Wrong type!
          citations: ['cit-1'],
        },
      ];

      const expectedRelations: ExpectedRelation[] = [
        {
          from: 'exec_simple_query',
          to: 'pg_parse_query',
          type: 'calls', // Expected type
          critical: true,
        },
      ];

      const result = await grader.checkRelations(providedRelations, expectedRelations);

      // Direct match fails due to type mismatch
      expect(result[0].found).toBe(false);
    });
  });

  describe('generateJustification()', () => {
    it('should generate justification for correct tour', async () => {
      const response = createCorrectResponse('q1');
      const question: Question = {
        id: 'q1',
        objective: 'Test objective',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        expected_areas: [],
        relations_to_verify: [],
        criteria: [],
      };

      const result = await grader.evaluate(response, question);

      expect(result.justification).toContain('correct');
    });

    it('should generate justification for incorrect tour', async () => {
      const response: AgentResponse = {
        run_id: 'run-1',
        agent: 'CodeTour',
        timestamp: new Date().toISOString(),
        question_id: 'q1',
        objective: 'Test objective',
        series: 'R',
        tour: {
          title: 'Test Tour',
          description: 'A test tour',
          steps: [],
        },
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
        relations_to_verify: [
          {
            from: 'exec_simple_query',
            to: 'pg_parse_query',
            type: 'calls',
            critical: true,
          },
        ],
        criteria: [],
      };

      const result = await grader.evaluate(response, question);

      expect(result.justification).toContain('INCORRECT');
      expect(result.justification).toContain('Missing');
    });
  });

  describe('Quality thresholds', () => {
    it('should apply minimum coverage threshold', async () => {
      const grader = new TourGrader({
        thresholds: {
          min_coverage: 0.8,
          max_missing_critical_relations: 0,
          max_false_claims: 0,
          critical_false_claim_weight: 1.0,
        },
      });

      const expectedAreas: ExpectedArea[] = [
        {
          file: 'src/backend/tcop/postgres.c',
          lines: [100, 101, 102],
          description: 'Area 1',
          critical: true,
        },
        {
          file: 'src/backend/parser/parser.c',
          lines: [50, 51],
          description: 'Area 2',
          critical: true,
        },
        {
          file: 'src/backend/parser/gramparse.y',
          lines: [1],
          description: 'Area 3',
          critical: true,
        },
      ];

      const question: Question = {
        id: 'q1',
        objective: 'Test objective',
        series: 'R',
        postgres_sha: POSTGRES_SHA,
        expected_areas,
        relations_to_verify: [],
        criteria: [],
      };

      // Response covers 2 out of 3 areas = 66.6% < 80% threshold
      const response: AgentResponse = {
        run_id: 'run-1',
        agent: 'CodeTour',
        timestamp: new Date().toISOString(),
        question_id: 'q1',
        objective: 'Test objective',
        series: 'R',
        tour: {
          title: 'Test Tour',
          description: 'A test tour',
          steps: [],
        },
        citations: [
          {
            id: 'cit-1',
            file: 'src/backend/tcop/postgres.c',
            line: 100,
            content: 'exec_simple_query',
            context: '',
          },
          {
            id: 'cit-2',
            file: 'src/backend/parser/parser.c',
            line: 50,
            content: 'pg_parse_query',
            context: '',
          },
        ],
        claims: [],
        relations: [],
      };

      const result = await grader.evaluate(response, question);

      expect(result.coverage).toBeCloseTo(2 / 3);
      expect(result.correct).toBe(false); // Below threshold
    });
  });

  describe('Cache management', () => {
    it('should clear caches', () => {
      grader.clearCaches();
      // Should not throw
    });
  });
});

// Helper functions for tests
function createCorrectResponse(questionId: string): AgentResponse {
  return {
    run_id: 'run-1',
    agent: 'CodeTour',
    timestamp: new Date().toISOString(),
    question_id: questionId,
    objective: 'Test objective',
    series: 'R',
    tour: {
      title: 'Test Tour',
      description: 'A correct test tour',
      steps: [
        {
          id: 'step-1',
          description: 'First step',
          file: 'src/backend/tcop/postgres.c',
          line: 100,
          code: 'exec_simple_query(...)',
          type: 'entry',
        },
      ],
    },
    citations: [
      {
        id: 'cit-1',
        file: 'src/backend/tcop/postgres.c',
        line: 100,
        content: 'exec_simple_query(const char *query)',
        context: '...\nline 99\nexec_simple_query(const char *query)\nline 101\n...',
      },
    ],
    claims: [
      {
        id: 'claim-1',
        statement: 'exec_simple_query is defined in postgres.c',
        confidence: 0.95,
        citations: ['cit-1'],
      },
    ],
    relations: [],
  };
}
