/**
 * Targeted Context Module
 * 
 * Provides bounded code symbol context to the Tour Generator,
 * reducing the need for open-ended exploration.
 * 
 * Part of Spec #92 - Targeted Context for Tour Generation
 * Ticket #115 - Implement Targeted Context for Changes Tour
 * Ticket #116 - Implement progressive exploration MCP for Targeted Context
 * Ticket #117 - Implement Targeted Context for Project Tour
 * Ticket #118 - Comprehensive benchmark: A vs B vs C vs D
 * 
 * Part of Spec: Hybrid Targeted Context
 * Ticket #01 - Tour type detection
 * Ticket #02 - Approach C configuration for Changes Tours
 * Ticket #03 - Approach D configuration for Project Tours
 * Ticket #04 - Unified MCP resource for Changes Tour
 * Ticket #05 - Unified MCP resource for Project Tour
 * 
 * Feature flag: enabled by default = false (off)
 */

export * from "./context-extractor";
export * from "./types";
export * from "./project-context-extractor";
export * from "./project-types";
export * from "./benchmark-types";
export * from "./benchmark-runner";
export * from "./tour-type-detector";
export * from "./hybrid-config";
