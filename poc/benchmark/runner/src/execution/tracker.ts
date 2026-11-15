/**
 * Token Tracker for Benchmark Execution
 * Spec #174 - T05
 * 
 * Tracks all token usage from LLM calls, including provider-side counters.
 * Ensures no call is recorded without usage data.
 */

import { CallRecord } from '../storage/logger';

/**
 * Total tokens interface for convenience
 */
export interface TotalTokens {
  input: number;
  output: number;
  total: number;
  verified: boolean;
}

/**
 * Interface for a single LLM call's token usage
 */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens?: number;
}

/**
 * Interface for tracking a call in progress
 */
export interface PendingCall {
  call_id: string;
  call_type: CallRecord['call_type'];
  start_time: number;
  input_tokens?: number;
  output_tokens?: number;
  usage_missing: boolean;
  tool_name: string | undefined;
  parameters: Record<string, unknown> | undefined;
}

/**
 * Token Tracker class
 * Tracks all token usage during a benchmark run
 */
export class TokenTracker {
  private calls: CallRecord[] = [];
  private pendingCalls: Map<string, PendingCall> = new Map();
  private callCounter: number = 0;

  /**
   * Start tracking a new call
   * @param call_type - Type of the call
   * @param tool_name - Optional tool name
   * @param parameters - Optional parameters
   */
  startCall(
    call_type: CallRecord['call_type'],
    tool_name?: string,
    parameters?: Record<string, unknown>
  ): string {
    const call_id = `call-${Date.now()}-${this.callCounter++}`;
    const pendingCall: PendingCall = {
      call_id,
      call_type,
      start_time: Date.now(),
      usage_missing: true, // Assume missing until proven otherwise
      tool_name,
      parameters,
    };

    this.pendingCalls.set(call_id, pendingCall);
    return call_id;
  }

  /**
   * Complete a call with token usage
   * @param call_id - The call ID from startCall
   * @param usage - Token usage from provider
   * @param result - Optional result
   * @param error - Optional error
   */
  completeCall(
    call_id: string,
    usage: TokenUsage,
    result?: string | Record<string, unknown> | null,
    error?: string | null
  ): void {
    const pendingCall = this.pendingCalls.get(call_id);
    
    if (!pendingCall) {
      throw new Error(`Call ${call_id} not found in pending calls`);
    }

    const duration_ms = Date.now() - pendingCall.start_time;

    const callRecord: CallRecord = {
      call_id: pendingCall.call_id,
      call_type: pendingCall.call_type,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      duration_ms,
      tool_name: pendingCall.tool_name,
      parameters: pendingCall.parameters,
      result,
      error,
      usage_missing: false, // Usage provided
    };

    this.calls.push(callRecord);
    this.pendingCalls.delete(call_id);
  }

  /**
   * Complete a call with missing usage
   * This marks the call as having missing usage, which will trigger NO-GO
   * @param call_id - The call ID from startCall
   * @param result - Optional result
   * @param error - Optional error
   */
  completeCallWithMissingUsage(
    call_id: string,
    result?: string | Record<string, unknown> | null,
    error?: string | null
  ): void {
    const pendingCall = this.pendingCalls.get(call_id);
    
    if (!pendingCall) {
      throw new Error(`Call ${call_id} not found in pending calls`);
    }

    const duration_ms = Date.now() - pendingCall.start_time;

    const callRecord: CallRecord = {
      call_id: pendingCall.call_id,
      call_type: pendingCall.call_type,
      input_tokens: 0,
      output_tokens: 0,
      duration_ms,
      tool_name: pendingCall.tool_name,
      parameters: pendingCall.parameters,
      result,
      error,
      usage_missing: true, // Usage is missing
    };

    this.calls.push(callRecord);
    this.pendingCalls.delete(call_id);
  }

  /**
   * Fail a call with an error
   * @param call_id - The call ID from startCall
   * @param error - Error message
   */
  failCall(call_id: string, error: string): void {
    const pendingCall = this.pendingCalls.get(call_id);
    
    if (!pendingCall) {
      throw new Error(`Call ${call_id} not found in pending calls`);
    }

    const duration_ms = Date.now() - pendingCall.start_time;

    const callRecord: CallRecord = {
      call_id: pendingCall.call_id,
      call_type: pendingCall.call_type,
      input_tokens: 0,
      output_tokens: 0,
      duration_ms,
      tool_name: pendingCall.tool_name,
      parameters: pendingCall.parameters,
      result: null,
      error,
      usage_missing: true, // Usage is missing on error
    };

    this.calls.push(callRecord);
    this.pendingCalls.delete(call_id);
  }

  /**
   * Get all completed calls
   */
  getCalls(): CallRecord[] {
    return [...this.calls];
  }

  /**
   * Get the number of calls with missing usage
   */
  getMissingUsageCount(): number {
    return this.calls.filter(call => call.usage_missing).length;
  }

  /**
   * Check if any call has missing usage
   */
  hasMissingUsage(): boolean {
    return this.getMissingUsageCount() > 0;
  }

  /**
   * Calculate total tokens from all completed calls
   */
  calculateTotalTokens(): TotalTokens {
    let input = 0;
    let output = 0;

    for (const call of this.calls) {
      input += call.input_tokens;
      output += call.output_tokens;
    }

    const total = input + output;

    return {
      input,
      output,
      total,
      verified: !this.hasMissingUsage(),
    };
  }

  /**
   * Get pending calls count
   */
  getPendingCount(): number {
    return this.pendingCalls.size;
  }

  /**
   * Clear all tracked data
   */
  clear(): void {
    this.calls = [];
    this.pendingCalls.clear();
    this.callCounter = 0;
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    total_calls: number;
    pending_calls: number;
    missing_usage_calls: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_tokens: number;
    verified: boolean;
  } {
    const totalTokens = this.calculateTotalTokens();

    return {
      total_calls: this.calls.length,
      pending_calls: this.pendingCalls.size,
      missing_usage_calls: this.getMissingUsageCount(),
      total_input_tokens: totalTokens.input,
      total_output_tokens: totalTokens.output,
      total_tokens: totalTokens.total,
      verified: totalTokens.verified,
    };
  }
}
