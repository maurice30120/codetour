/**
 * Spec #174 - T06: Blind Evaluator
 * 
 * Main exports for the evaluator module
 * 
 * This module provides:
 * - Common response format for both CodeTour and Vibe agents
 * - Blind verification against PostgreSQL code (SHA 70c4a57b...)
 * - Evaluator that does NOT know: agent, execution order, token cost
 * - Disagreement protocol with arbitration
 * - Quality thresholds defined BEFORE observing results
 */

// Re-export types
export * from './types';

// Re-export grader
export * from './grader';

// Re-export blinder
export * from './blinder';

// Re-export arbitrator
export * from './arbitrator';
export * from './normalizer';

// Named exports for convenience
export { POSTGRES_SHA } from './types';
