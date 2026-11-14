/**
 * Tour Type Detection Module
 * 
 * Automatically detects whether a tour request is for a Changes Tour or Project Tour
 * based on the request parameters.
 * 
 * Part of Spec: Hybrid Targeted Context
 * Ticket #01: Détection automatique du type de Tour
 */

/**
 * Type of Tour that can be detected
 */
export type TourType = 'changes-tour' | 'project-tour';

/**
 * Parameters that can be used to detect tour type
 */
export interface TourDetectionParams {
  /**
   * Base reference (commit SHA) - required for Changes Tours
   */
  baseRef?: string;
  /**
   * Head reference (commit SHA) - required for Changes Tours
   */
  headRef?: string;
  /**
   * Workspace path - can be used for both tour types
   */
  workspacePath?: string;
  /**
   * File name - can be used for both tour types
   */
  fileName?: string;
}

/**
 * Result of tour type detection
 */
export interface TourTypeDetectionResult {
  /**
   * The detected tour type
   */
  tourType: TourType;
  /**
   * Whether the detection was successful
   */
  isCertain: boolean;
  /**
   * Reason for the detection result
   */
  reason: string;
  /**
   * The parameters used for detection
   */
  params: TourDetectionParams;
}

/**
 * Detects the type of tour based on the provided parameters.
 * 
 * Rules:
 * - Changes Tour: Both `baseRef` AND `headRef` must be present
 * - Project Tour: Otherwise (missing baseRef or headRef, or neither)
 * 
 * @param params - The parameters to analyze
 * @returns The detection result
 */
export function detectTourType(params: TourDetectionParams): TourTypeDetectionResult {
  const { baseRef, headRef, workspacePath, fileName } = params;

  // Changes Tour detection: both baseRef AND headRef must be present and non-empty
  if (baseRef && headRef && baseRef.trim() !== '' && headRef.trim() !== '') {
    return {
      tourType: 'changes-tour',
      isCertain: true,
      reason: 'Both baseRef and headRef are present - identified as Changes Tour',
      params: { baseRef, headRef, workspacePath, fileName },
    };
  }

  // Project Tour detection: missing baseRef or headRef (or both)
  return {
    tourType: 'project-tour',
    isCertain: true,
    reason: 'Missing baseRef and/or headRef - identified as Project Tour',
    params: { baseRef, headRef, workspacePath, fileName },
  };
}

/**
 * Determines which approach (C or D) to use based on tour type.
 * 
 * - Approach C (Progressive MCP): For Changes Tours
 * - Approach D (Project Tour): For Project Tours
 * 
 * @param tourType - The detected tour type
 * @returns The approach identifier
 */
export function getApproachForTourType(tourType: TourType): 'C' | 'D' {
  switch (tourType) {
    case 'changes-tour':
      return 'C';
    case 'project-tour':
      return 'D';
    default:
      // This should never happen, but default to D (Project Tour) as it's more general
      return 'D';
  }
}

/**
 * Validates that the detection logic is working correctly through test cases
 */
export function validateDetectionLogic(): boolean {
  // Test cases for validation

  // Test 1: Changes Tour with both refs
  const result1 = detectTourType({ baseRef: 'abc123', headRef: 'def456' });
  if (result1.tourType !== 'changes-tour' || !result1.isCertain) {
    console.error('Detection test 1 failed: should detect Changes Tour with both refs');
    return false;
  }

  // Test 2: Project Tour with no refs
  const result2 = detectTourType({});
  if (result2.tourType !== 'project-tour' || !result2.isCertain) {
    console.error('Detection test 2 failed: should detect Project Tour with no refs');
    return false;
  }

  // Test 3: Project Tour with only baseRef
  const result3 = detectTourType({ baseRef: 'abc123' });
  if (result3.tourType !== 'project-tour' || !result3.isCertain) {
    console.error('Detection test 3 failed: should detect Project Tour with only baseRef');
    return false;
  }

  // Test 4: Project Tour with only headRef
  const result4 = detectTourType({ headRef: 'def456' });
  if (result4.tourType !== 'project-tour' || !result4.isCertain) {
    console.error('Detection test 4 failed: should detect Project Tour with only headRef');
    return false;
  }

  // Test 5: Project Tour with workspacePath only
  const result5 = detectTourType({ workspacePath: '/path/to/workspace' });
  if (result5.tourType !== 'project-tour' || !result5.isCertain) {
    console.error('Detection test 5 failed: should detect Project Tour with workspacePath only');
    return false;
  }

  // Test 6: Changes Tour with empty strings (should be Project Tour)
  const result6 = detectTourType({ baseRef: '', headRef: '' });
  if (result6.tourType !== 'project-tour' || !result6.isCertain) {
    console.error('Detection test 6 failed: should detect Project Tour with empty refs');
    return false;
  }

  // Test 7: Changes Tour with whitespace-only strings (should be Project Tour)
  const result7 = detectTourType({ baseRef: '   ', headRef: '   ' });
  if (result7.tourType !== 'project-tour' || !result7.isCertain) {
    console.error('Detection test 7 failed: should detect Project Tour with whitespace refs');
    return false;
  }

  return true;
}

/**
 * Determines the appropriate extractor and configuration based on request parameters.
 * This is the main entry point for the automatic detection system.
 */
export function getTourConfiguration(params: TourDetectionParams) {
  const detection = detectTourType(params);
  const approach = getApproachForTourType(detection.tourType);

  return {
    detection,
    approach,
    tourType: detection.tourType,
  };
}
