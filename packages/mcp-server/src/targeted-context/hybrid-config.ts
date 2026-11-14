/**
 * Hybrid Targeted Context Configuration
 * 
 * Provides optimal default configurations for both approach C (Changes Tours)
 * and approach D (Project Tours) as specified in the Hybrid Targeted Context spec.
 * 
 * Part of Spec: Hybrid Targeted Context
 * Ticket #02: Configuration par défaut - C pour Changes Tour
 * Ticket #03: Configuration par défaut - D pour Project Tour
 */

import {
  TargetedContextConfig,
} from "./types";
import {
  ProjectTargetedContextConfig,
} from "./project-types";

// ============================================================================
// Approach C (Changes Tours) - Progressive MCP Configuration
// ============================================================================

/**
 * Optimal configuration for Approach C (Changes Tours)
 * 
 * Optimized for:
 * - Token efficiency (97% reduction vs baseline)
 * - Speed (< 3 seconds for Changes Tours)
 * - Focus on changed files only
 * 
 * Default values from spec:
 * - enabled: false (ADR 0033: the flag is off by default — the bounds below
 *   are the approach C bounds, NOT an always-on switch)
 * - maxSymbols: 5000
 * - maxFiles: 50
 * - pageSize: 200
 * - includeExtensions: TypeScript, JavaScript, Python, Java, Go
 * - excludeExtensions: test files, spec files, .d.ts
 * - trackCost: true
 * - excludeNodeModules: true
 */
/** Spec-mandated approach C bounds, shared by the config and its validator. */
const APPROACH_C_MAX_SYMBOLS = 5000;
const APPROACH_C_PAGE_SIZE = 200;
const APPROACH_C_MAX_FILES = 50;

export const APPROACH_C_CONFIG: TargetedContextConfig = {
  enabled: false, // Off by default (ADR 0033): the served codetour://context/*
  // resources honor this existing flag; a host opts a run in deliberately
  // (CODETOUR_TARGETED_CONTEXT=1) — there is no new flag.
  maxSymbols: APPROACH_C_MAX_SYMBOLS, // Maximum symbols to extract
  pageSize: APPROACH_C_PAGE_SIZE, // Symbols served per page
  maxFiles: APPROACH_C_MAX_FILES, // Maximum changed files processed
  maxDepth: 10, // Maximum depth of symbol hierarchy
  includeExtensions: [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".java",
    ".go",
  ],
  excludeExtensions: [
    ".test.",
    ".spec.",
    ".d.ts",
  ],
  includeDocumentation: true,
  trackCost: true,
  excludeNodeModules: true,
};

/**
 * Get Approach C configuration with optional overrides
 */
export function getApproachCConfig(
  overrides?: Partial<TargetedContextConfig>
): TargetedContextConfig {
  return {
    ...APPROACH_C_CONFIG,
    ...overrides,
  };
}

// ============================================================================
// Approach D (Project Tours) - Project Tour Targeted Context Configuration
// ============================================================================

/**
 * Optimal configuration for Approach D (Project Tours)
 * 
 * Optimized for:
 * - Comprehensive workspace coverage
 * - Good token efficiency (92% reduction vs baseline)
 * - Focus on key project files
 * 
 * Default values from spec:
 * - enabled: false (ADR 0033: off by default, as above)
 * - maxFiles: 50
 * - maxSymbolsPerFile: 50
 * - includeExtensions: TypeScript, JavaScript, Python, Java, Go, Rust
 * - excludeExtensions: test files, spec files, .d.ts, .min.js
 * - includeDocumentation: true
 * - trackCost: true
 * - rootDirectories: ["src", "lib", "packages", "app", "server"]
 * - excludeNodeModules: true
 */
export const APPROACH_D_CONFIG: ProjectTargetedContextConfig = {
  enabled: false, // Off by default (ADR 0033), same as Approach C above
  maxSymbolsPerFile: 50, // Maximum symbols per file
  maxFiles: 50, // Maximum number of files to scan
  maxDepth: 10, // Maximum depth of symbol hierarchy
  includeExtensions: [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".java",
    ".go",
    ".rs",
  ],
  excludeExtensions: [
    ".test.",
    ".spec.",
    ".d.ts",
    ".min.js",
  ],
  includeDocumentation: true,
  trackCost: true,
  rootDirectories: [
    "src",
    "lib",
    "packages",
    "app",
    "server",
  ],
  excludeNodeModules: true,
};

/**
 * Get Approach D configuration with optional overrides
 */
export function getApproachDConfig(
  overrides?: Partial<ProjectTargetedContextConfig>
): ProjectTargetedContextConfig {
  return {
    ...APPROACH_D_CONFIG,
    ...overrides,
  };
}

// ============================================================================
// Configuration Validation
// ============================================================================

/**
 * Validates that Approach C configuration meets the spec requirements
 */
export function validateApproachCConfig(config: TargetedContextConfig): boolean {
  const errors: string[] = [];

  // ADR 0033: `enabled` is the existing default-off flag, not a bound — the
  // validators below check the approach bounds only.
  if (typeof config.enabled !== "boolean") {
    errors.push("Approach C: enabled should be a boolean flag");
  }

  if (config.maxSymbols !== APPROACH_C_MAX_SYMBOLS) {
    errors.push(
      `Approach C: maxSymbols should be ${APPROACH_C_MAX_SYMBOLS}, got ${config.maxSymbols}`
    );
  }

  if (config.pageSize !== APPROACH_C_PAGE_SIZE) {
    errors.push(
      `Approach C: pageSize should be ${APPROACH_C_PAGE_SIZE}, got ${config.pageSize}`
    );
  }

  if (config.maxFiles !== APPROACH_C_MAX_FILES) {
    errors.push(
      `Approach C: maxFiles should be ${APPROACH_C_MAX_FILES}, got ${config.maxFiles}`
    );
  }

  if (config.excludeNodeModules !== true) {
    errors.push("Approach C: excludeNodeModules should be true");
  }

  if (config.trackCost !== true) {
    errors.push("Approach C: trackCost should be true");
  }

  // Check includeExtensions
  const requiredExtensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go"];
  for (const ext of requiredExtensions) {
    if (!config.includeExtensions.includes(ext)) {
      errors.push(`Approach C: missing required extension ${ext}`);
    }
  }

  // Check excludeExtensions
  const requiredExcludes = [".test.", ".spec.", ".d.ts"];
  for (const ext of requiredExcludes) {
    if (!config.excludeExtensions.includes(ext)) {
      errors.push(`Approach C: missing required exclude extension ${ext}`);
    }
  }

  if (errors.length > 0) {
    console.error("Approach C configuration validation failed:");
    errors.forEach((err) => console.error(`  - ${err}`));
    return false;
  }

  return true;
}

/**
 * Validates that Approach D configuration meets the spec requirements
 */
export function validateApproachDConfig(config: ProjectTargetedContextConfig): boolean {
  const errors: string[] = [];

  // ADR 0033: `enabled` is the existing default-off flag, not a bound.
  if (typeof config.enabled !== "boolean") {
    errors.push("Approach D: enabled should be a boolean flag");
  }

  if (config.maxFiles !== 50) {
    errors.push(`Approach D: maxFiles should be 50, got ${config.maxFiles}`);
  }

  if (config.maxSymbolsPerFile !== 50) {
    errors.push(`Approach D: maxSymbolsPerFile should be 50, got ${config.maxSymbolsPerFile}`);
  }

  if (config.trackCost !== true) {
    errors.push("Approach D: trackCost should be true");
  }

  if (config.excludeNodeModules !== true) {
    errors.push("Approach D: excludeNodeModules should be true");
  }

  // Check includeExtensions
  const requiredExtensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go", ".rs"];
  for (const ext of requiredExtensions) {
    if (!config.includeExtensions.includes(ext)) {
      errors.push(`Approach D: missing required extension ${ext}`);
    }
  }

  // Check excludeExtensions
  const requiredExcludes = [".test.", ".spec.", ".d.ts", ".min.js"];
  for (const ext of requiredExcludes) {
    if (!config.excludeExtensions.includes(ext)) {
      errors.push(`Approach D: missing required exclude extension ${ext}`);
    }
  }

  // Check rootDirectories
  const requiredDirectories = ["src", "lib", "packages", "app", "server"];
  for (const dir of requiredDirectories) {
    if (!config.rootDirectories.includes(dir)) {
      errors.push(`Approach D: missing required root directory ${dir}`);
    }
  }

  if (errors.length > 0) {
    console.error("Approach D configuration validation failed:");
    errors.forEach((err) => console.error(`  - ${err}`));
    return false;
  }

  return true;
}

/**
 * Validates both configurations
 */
export function validateAllConfigs(): boolean {
  const cValid = validateApproachCConfig(APPROACH_C_CONFIG);
  const dValid = validateApproachDConfig(APPROACH_D_CONFIG);

  return cValid && dValid;
}

// ============================================================================
// Configuration Getter with Tour Type
// ============================================================================

import { TourType } from "./tour-type-detector";

/**
 * Get the appropriate configuration based on tour type
 */
export function getConfigForTourType(
  tourType: TourType,
  overrides?: Partial<TargetedContextConfig> | Partial<ProjectTargetedContextConfig>
): TargetedContextConfig | ProjectTargetedContextConfig {
  switch (tourType) {
    case 'changes-tour':
      return getApproachCConfig(overrides as Partial<TargetedContextConfig>);
    case 'project-tour':
      return getApproachDConfig(overrides as Partial<ProjectTargetedContextConfig>);
    default:
      throw new Error(`Unknown tour type: ${tourType}`);
  }
}
