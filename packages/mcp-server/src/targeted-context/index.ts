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
 * 
 * Feature flag: enabled by default = false (off)
 */

export * from "./context-extractor";
export * from "./types";
export * from "./project-context-extractor";
export * from "./project-types";
