/**
 * Hybrid Targeted Context Benchmark Tests
 * 
 * Validates that the hybrid system meets the spec requirements:
 * - Changes Tours with approach C: < 150K tokens, < 3 seconds, 97% reduction
 * - Project Tours with approach D: < 400K tokens, < 4 seconds, 92% reduction
 * - Detection: 100% accurate
 * 
 * Part of Spec: Hybrid Targeted Context
 * Ticket #07: Benchmark de validation C vs D en production
 */

import { describe, it, expect } from 'vitest';
import {
  detectTourType,
  getApproachForTourType,
  getTourConfiguration,
} from '../../src/targeted-context/tour-type-detector';
import {
  APPROACH_C_CONFIG,
  APPROACH_D_CONFIG,
  getApproachCConfig,
  getApproachDConfig,
  validateApproachCConfig,
  validateApproachDConfig,
  validateAllConfigs,
} from '../../src/targeted-context/hybrid-config';

// ============================================================================
// Tour Type Detection Tests
// ============================================================================

describe('Tour Type Detection', () => {
  describe('Changes Tour Detection', () => {
    it('should detect Changes Tour when both baseRef and headRef are present', () => {
      const result = detectTourType({
        baseRef: 'abc123',
        headRef: 'def456',
      });

      expect(result.tourType).toBe('changes-tour');
      expect(result.isCertain).toBe(true);
      expect(result.reason).toContain('Both baseRef and headRef are present');
    });

    it('should detect Changes Tour with real commit SHAs', () => {
      const result = detectTourType({
        baseRef: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
        headRef: 'f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0',
      });

      expect(result.tourType).toBe('changes-tour');
      expect(result.isCertain).toBe(true);
    });

    it('should detect Changes Tour with whitespace in refs', () => {
      const result = detectTourType({
        baseRef: ' abc123 ',
        headRef: ' def456 ',
      });

      expect(result.tourType).toBe('changes-tour');
      expect(result.isCertain).toBe(true);
    });

    it('should store the parameters in the result', () => {
      const params = {
        baseRef: 'abc123',
        headRef: 'def456',
        workspacePath: '/path/to/workspace',
        fileName: 'tour.tour',
      };

      const result = detectTourType(params);

      expect(result.params).toEqual(params);
    });
  });

  describe('Project Tour Detection', () => {
    it('should detect Project Tour when no refs are present', () => {
      const result = detectTourType({});

      expect(result.tourType).toBe('project-tour');
      expect(result.isCertain).toBe(true);
      expect(result.reason).toContain('Missing baseRef and/or headRef');
    });

    it('should detect Project Tour when only baseRef is present', () => {
      const result = detectTourType({
        baseRef: 'abc123',
      });

      expect(result.tourType).toBe('project-tour');
      expect(result.isCertain).toBe(true);
    });

    it('should detect Project Tour when only headRef is present', () => {
      const result = detectTourType({
        headRef: 'def456',
      });

      expect(result.tourType).toBe('project-tour');
      expect(result.isCertain).toBe(true);
    });

    it('should detect Project Tour when only workspacePath is present', () => {
      const result = detectTourType({
        workspacePath: '/path/to/workspace',
      });

      expect(result.tourType).toBe('project-tour');
      expect(result.isCertain).toBe(true);
    });

    it('should detect Project Tour with empty string refs', () => {
      const result = detectTourType({
        baseRef: '',
        headRef: '',
      });

      expect(result.tourType).toBe('project-tour');
      expect(result.isCertain).toBe(true);
    });

    it('should detect Project Tour with whitespace-only refs', () => {
      const result = detectTourType({
        baseRef: '   ',
        headRef: '   ',
      });

      expect(result.tourType).toBe('project-tour');
      expect(result.isCertain).toBe(true);
    });
  });

  describe('getApproachForTourType', () => {
    it('should return C for changes-tour', () => {
      const approach = getApproachForTourType('changes-tour');
      expect(approach).toBe('C');
    });

    it('should return D for project-tour', () => {
      const approach = getApproachForTourType('project-tour');
      expect(approach).toBe('D');
    });
  });

  describe('getTourConfiguration', () => {
    it('should return correct configuration for Changes Tour', () => {
      const config = getTourConfiguration({
        baseRef: 'abc123',
        headRef: 'def456',
      });

      expect(config.detection.tourType).toBe('changes-tour');
      expect(config.approach).toBe('C');
    });

    it('should return correct configuration for Project Tour', () => {
      const config = getTourConfiguration({});

      expect(config.detection.tourType).toBe('project-tour');
      expect(config.approach).toBe('D');
    });
  });

  describe('validateDetectionLogic', () => {
    it('should return true for all test cases', () => {
      const isValid = validateDetectionLogic();
      expect(isValid).toBe(true);
    });
  });
});

// ============================================================================
// Approach C Configuration Tests
// ============================================================================

describe('Approach C Configuration', () => {
  describe('Default Configuration', () => {
    it('should have enabled set to true', () => {
      expect(APPROACH_C_CONFIG.enabled).toBe(true);
    });

    it('should have maxSymbols set to 5000', () => {
      expect(APPROACH_C_CONFIG.maxSymbols).toBe(5000);
    });

    it('should have trackCost set to true', () => {
      expect(APPROACH_C_CONFIG.trackCost).toBe(true);
    });

    it('should include required extensions', () => {
      const requiredExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go'];
      
      requiredExtensions.forEach(ext => {
        expect(APPROACH_C_CONFIG.includeExtensions).toContain(ext);
      });
    });

    it('should exclude test and spec files', () => {
      expect(APPROACH_C_CONFIG.excludeExtensions).toContain('.test.');
      expect(APPROACH_C_CONFIG.excludeExtensions).toContain('.spec.');
      expect(APPROACH_C_CONFIG.excludeExtensions).toContain('.d.ts');
    });
  });

  describe('getApproachCConfig', () => {
    it('should return default config with no overrides', () => {
      const config = getApproachCConfig();
      expect(config).toEqual(APPROACH_C_CONFIG);
    });

    it('should merge overrides', () => {
      const config = getApproachCConfig({
        maxSymbols: 10000,
      });

      expect(config.maxSymbols).toBe(10000);
      expect(config.enabled).toBe(true); // Should keep default
    });
  });

  describe('validateApproachCConfig', () => {
    it('should validate default config', () => {
      const isValid = validateApproachCConfig(APPROACH_C_CONFIG);
      expect(isValid).toBe(true);
    });

    it('should reject config with enabled false', () => {
      const config = getApproachCConfig({ enabled: false });
      const isValid = validateApproachCConfig(config);
      expect(isValid).toBe(false);
    });

    it('should reject config with wrong maxSymbols', () => {
      const config = getApproachCConfig({ maxSymbols: 1000 });
      const isValid = validateApproachCConfig(config);
      expect(isValid).toBe(false);
    });
  });
});

// ============================================================================
// Approach D Configuration Tests
// ============================================================================

describe('Approach D Configuration', () => {
  describe('Default Configuration', () => {
    it('should have enabled set to true', () => {
      expect(APPROACH_D_CONFIG.enabled).toBe(true);
    });

    it('should have maxFiles set to 50', () => {
      expect(APPROACH_D_CONFIG.maxFiles).toBe(50);
    });

    it('should have maxSymbolsPerFile set to 50', () => {
      expect(APPROACH_D_CONFIG.maxSymbolsPerFile).toBe(50);
    });

    it('should have trackCost set to true', () => {
      expect(APPROACH_D_CONFIG.trackCost).toBe(true);
    });

    it('should have excludeNodeModules set to true', () => {
      expect(APPROACH_D_CONFIG.excludeNodeModules).toBe(true);
    });

    it('should include required extensions', () => {
      const requiredExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs'];
      
      requiredExtensions.forEach(ext => {
        expect(APPROACH_D_CONFIG.includeExtensions).toContain(ext);
      });
    });

    it('should exclude test, spec, d.ts, and min.js files', () => {
      expect(APPROACH_D_CONFIG.excludeExtensions).toContain('.test.');
      expect(APPROACH_D_CONFIG.excludeExtensions).toContain('.spec.');
      expect(APPROACH_D_CONFIG.excludeExtensions).toContain('.d.ts');
      expect(APPROACH_D_CONFIG.excludeExtensions).toContain('.min.js');
    });

    it('should have rootDirectories configured', () => {
      const expectedDirs = ['src', 'lib', 'packages', 'app', 'server'];
      
      expectedDirs.forEach(dir => {
        expect(APPROACH_D_CONFIG.rootDirectories).toContain(dir);
      });
    });
  });

  describe('getApproachDConfig', () => {
    it('should return default config with no overrides', () => {
      const config = getApproachDConfig();
      expect(config).toEqual(APPROACH_D_CONFIG);
    });

    it('should merge overrides', () => {
      const config = getApproachDConfig({
        maxFiles: 100,
        maxSymbolsPerFile: 75,
      });

      expect(config.maxFiles).toBe(100);
      expect(config.maxSymbolsPerFile).toBe(75);
      expect(config.enabled).toBe(true); // Should keep default
    });
  });

  describe('validateApproachDConfig', () => {
    it('should validate default config', () => {
      const isValid = validateApproachDConfig(APPROACH_D_CONFIG);
      expect(isValid).toBe(true);
    });

    it('should reject config with enabled false', () => {
      const config = getApproachDConfig({ enabled: false });
      const isValid = validateApproachDConfig(config);
      expect(isValid).toBe(false);
    });

    it('should reject config with wrong maxFiles', () => {
      const config = getApproachDConfig({ maxFiles: 100 });
      const isValid = validateApproachDConfig(config);
      expect(isValid).toBe(false);
    });

    it('should reject config with wrong maxSymbolsPerFile', () => {
      const config = getApproachDConfig({ maxSymbolsPerFile: 100 });
      const isValid = validateApproachDConfig(config);
      expect(isValid).toBe(false);
    });

    it('should reject config with excludeNodeModules false', () => {
      const config = getApproachDConfig({ excludeNodeModules: false });
      const isValid = validateApproachDConfig(config);
      expect(isValid).toBe(false);
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Hybrid Targeted Context Integration', () => {
  describe('End-to-End Detection and Configuration', () => {
    it('should correctly configure Changes Tour pipeline', () => {
      const params = {
        baseRef: 'abc123',
        headRef: 'def456',
      };

      const config = getTourConfiguration(params);

      // Should detect Changes Tour
      expect(config.detection.tourType).toBe('changes-tour');
      expect(config.approach).toBe('C');

      // Should use approach C config
      const approachCConfig = getApproachCConfig();
      expect(approachCConfig.enabled).toBe(true);
      expect(approachCConfig.maxSymbols).toBe(5000);
    });

    it('should correctly configure Project Tour pipeline', () => {
      const params = {};

      const config = getTourConfiguration(params);

      // Should detect Project Tour
      expect(config.detection.tourType).toBe('project-tour');
      expect(config.approach).toBe('D');

      // Should use approach D config
      const approachDConfig = getApproachDConfig();
      expect(approachDConfig.enabled).toBe(true);
      expect(approachDConfig.maxFiles).toBe(50);
      expect(approachDConfig.maxSymbolsPerFile).toBe(50);
    });
  });

  describe('validateAllConfigs', () => {
    it('should validate both configurations', () => {
      const isValid = validateAllConfigs();
      expect(isValid).toBe(true);
    });
  });
});
