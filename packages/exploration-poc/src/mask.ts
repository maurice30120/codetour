// Observation masking: keep the last `keep` tool results verbatim and replace older ones
// with a one-line stub, so the history resent at every model call stops growing linearly.
export const MASK_MIN_BYTES = 2000;

export function maskObservations(messages: any[], keep: number, spilled: Map<string, string> = new Map()): any[] {
  if (keep <= 0) return messages;
  const toolIndexes = messages.flatMap((message, index) => message.role === 'tool' ? [index] : []);
  const masked = new Set(toolIndexes.slice(0, Math.max(0, toolIndexes.length - keep)).filter(index => Buffer.byteLength(String(messages[index].content)) > MASK_MIN_BYTES));
  if (!masked.size) return messages;
  const calls = new Map<string, { name: string; arguments: string }>();
  for (const message of messages) for (const call of message.tool_calls ?? []) calls.set(call.id, call.function);
  return messages.map((message, index) => {
    if (!masked.has(index)) return message;
    const call = calls.get(message.tool_call_id);
    const description = call ? `${call.name}(${call.arguments.slice(0, 120)})` : 'tool call';
    return { ...message, content: JSON.stringify({ omitted: true, note: `Already read, result omitted to save context: ${description}.${spilled.has(message.tool_call_id) ? ` Full result saved as ${spilled.get(message.tool_call_id)}; use readScratch with resultId and offset 0 if needed. Cite original sources.` : ' Full result is not available in scratch.'} Rely on what you noted.`, bytes: Buffer.byteLength(String(message.content)), head: String(message.content).slice(0, 300) }) };
  });
}
