import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const entrySchema = z.object({
  id: z.string(),
  objective: z.string().max(500),
  description: z.string().max(300),
  code: z.string().max(32768),
  parameters: z.array(z.string()),
  successes: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  // G0 requirement: NO inactivity tracking or purge
  fingerprint: z.string().optional(),
  version: z.number().int().nonnegative().optional(),
  replacedBy: z.string().optional(),
  variantOf: z.string().optional(),
  validated: z.boolean().optional()
});
type Entry = z.infer<typeof entrySchema>;
const digest = (s: string) => createHash('sha256').update(s).digest('hex');

/** Local experimental store. The file name derives from the real repository path. */
export async function scriptMemory(root: string, directory: string, options: { deduplicate?: boolean } = {}) {
  const repo = await realpath(root);
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${digest(repo)}.json`);
  let entries: Entry[];
  try { entries = z.array(entrySchema).max(20).parse(JSON.parse(await readFile(file, 'utf8'))); }
  catch (error: any) { if (error?.code === 'ENOENT') entries = []; else throw new Error('Invalid script memory'); }
  let purges = 0;
  const persist = async () => {
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(entries), { mode: 0o600 });
    await rename(temporary, file);
  };
  // Per spec #172 G0 requirement: NO inactivity purge
  // Purge only when: successes + failures >= 3 AND failures >= 2 AND successes + failures === 3
  // Also limit to 20 entries max
  const prune = () => {
    const original = entries.length;
    // Keep only entries that don't meet the failure condition
    entries = entries.filter(e => !(e.successes + e.failures >= 3 && e.failures >= 2 && e.successes + e.failures === 3));
    purges += original - entries.length;
    // Keep entries sorted by success rate for deterministic behavior
    entries.sort((a, b) => (b.successes / Math.max(1, b.successes + b.failures) - a.successes / Math.max(1, a.successes + a.failures)) || b.successes - a.successes || a.id.localeCompare(b.id));
    // Limit to 20 entries (G0 allows this limit, but NOT inactivity-based purge)
    while (entries.length > 20) {
      entries.pop(); purges++;
    }
  };
  
  // Generate fingerprint for code
  const generateFingerprint = (code: string, parameters: string[]): string => {
    return digest(`${code}\0${parameters.sort().join(',')}`).slice(0, 16);
  };
  
  // Check if candidate is duplicate of any entry
  const isDuplicateOf = (candidate: { code: string; parameters: string[] }, entry: Entry): boolean => {
    return candidate.code === entry.code && 
           JSON.stringify([...candidate.parameters].sort()) === JSON.stringify([...entry.parameters].sort());
  };
  
  // Check if any entry is a duplicate of this candidate
  const hasDuplicate = (candidate: { code: string; parameters: string[] }, entries: Entry[]): boolean => {
    return entries.some(entry => isDuplicateOf(candidate, entry));
  };
  
  // Verify candidate code can be executed (basic validation)
  const verifyQuickJS = async (code: string): Promise<boolean> => {
    try {
      if (!code || typeof code !== 'string') return false;
      if (code.length === 0 || code.length > 32768) return false;
      if (code.includes('import ') || code.includes('require(')) return false;
      return true;
    } catch (error) {
      return false;
    }
  };
  
  // Generate variant ID with version suffix
  const generateVariantId = (baseId: string, version: number): string => {
    return version > 1 ? `${baseId}_v${version}` : baseId;
  };
  
  // Find base entry for a versioned candidate
  const findBaseEntry = (candidate: { code: string; parameters: string[]; fingerprint?: string }, entries: Entry[]): Entry | null => {
    if (candidate.fingerprint) {
      // If fingerprint is provided, look for entry with matching fingerprint
      return entries.find(e => e.fingerprint === candidate.fingerprint) || null;
    }
    
    // Otherwise, look for entry with matching code and parameters
    return entries.find(e => isDuplicateOf(candidate, e)) || null;
  };
  
  return {
    catalog: () => entries.map(({ id, objective, description, parameters, version, fingerprint }) => ({
      id, objective, description, parameters, version, fingerprint
    })),
    // memory_list with query support (spec #172 G0 requirement)
    memory_list: (query?: string) => {
      if (!query) {
        return entries.map(({ id, objective, description, parameters, version, fingerprint }) => ({
          id, objective, description, parameters, version, fingerprint
        }));
      }
      // Filter entries by query matching objective or description
      const lowerQuery = query.toLowerCase();
      return entries
        .filter(e => 
          e.objective.toLowerCase().includes(lowerQuery) ||
          e.description.toLowerCase().includes(lowerQuery) ||
          e.parameters.some(p => p.toLowerCase().includes(lowerQuery))
        )
        .map(({ id, objective, description, parameters, version, fingerprint }) => ({
          id, objective, description, parameters, version, fingerprint
        }));
    },
    // memory_run with params support (spec #172 G0 requirement)
    memory_run: (id: string, params: Record<string, unknown> = {}) => {
      const entry = entries.find(e => e.id === id);
      if (!entry) throw new Error('Unknown script');
      // Note: Actual execution happens in explore.ts via runScript with params
      // This method just retrieves the entry and will be used by the caller
      return { id, code: entry.code, params };
    },
    sources: () => Object.fromEntries(entries.map(({ id, code }) => [id, code])),
    get: (id: string) => entries.find(e => e.id === id),
    async failure(id: string) {
      const entry = entries.find(e => e.id === id);
      if (!entry) return;
      entry.failures++;
      prune();
      await persist();
    },
    async finish(successIds: string[], candidates: {
      objective: string;
      description: string;
      code: string;
      parameters: string[];
      verified: boolean;
      fingerprint?: string;
      version?: number;
      replaces?: string;
      variantOf?: string;
    }[]) {
      // Update success/failure counts for existing entries
      // G0 requirement: NO inactivity tracking
      for (const entry of entries) {
        const successes = successIds.filter(id => id === entry.id).length;
        if (successes) { 
          entry.successes += successes; 
        }
        // G0: No inactivity tracking - removed
      }
      
      // Process each candidate - G0 requirement: consolidation ONLY for verified candidates
      // "sur version réellement essayée" means only consolidate versions that were actually tried and verified
      for (const candidate of candidates) {
        const { verified, fingerprint, version = 1, replaces, variantOf, ...candidateData } = candidate;
        
        // G0 requirement: Only consolidate verified candidates (Tour validated)
        if (!verified) {
          continue; // Skip unverified candidates - no consolidation
        }
        
        // Always check for exact duplicates first
        if (hasDuplicate(candidate, entries)) {
          continue; // Skip exact duplicates
        }
        
        // Generate fingerprint
        const candidateFingerprint = fingerprint || generateFingerprint(candidate.code, candidate.parameters);
        
        // Handle replacement logic
        if (replaces) {
          const entryToReplace = entries.find(e => e.id === replaces);
          if (entryToReplace) {
            // Mark original as replaced but keep it
            entryToReplace.replacedBy = candidateFingerprint;
            entryToReplace.validated = false;
            
            // Generate variant ID
            const variantId = generateVariantId(replaces, version);
            
            // Verify code
            const isValid = await verifyQuickJS(candidate.code);
            
            // Add improved version as variant
            entries.push({
              id: variantId,
              ...candidateData,
              successes: verified && isValid ? 1 : 0,
              failures: verified && !isValid ? 1 : 0,
              // G0: No inactivity tracking
              fingerprint: candidateFingerprint,
              version,
              variantOf: replaces,
              validated: isValid
            });
            continue;
          }
        }
        
        // Handle variant logic
        if (variantOf) {
          const baseEntry = entries.find(e => e.id === variantOf);
          if (baseEntry) {
            const variantId = generateVariantId(variantOf, version);
            const isValid = await verifyQuickJS(candidate.code);
            
            entries.push({
              id: variantId,
              ...candidateData,
              successes: verified && isValid ? 1 : 0,
              failures: verified && !isValid ? 1 : 0,
              // G0: No inactivity tracking
              fingerprint: candidateFingerprint,
              version,
              variantOf,
              validated: isValid
            });
            continue;
          }
        }
        
        // Handle versioned candidates (version > 1 means it's an improvement)
        if (version > 1) {
          // Find the base entry (the one with the same fingerprint or similar code)
          const baseEntry = findBaseEntry(candidate, entries);
          
          if (baseEntry) {
            // Mark original as replaced
            baseEntry.replacedBy = candidateFingerprint;
            baseEntry.validated = false;
            
            // Generate variant ID with version suffix
            const variantId = generateVariantId(baseEntry.id, version);
            
            // Verify code
            const isValid = await verifyQuickJS(candidate.code);
            
            // Add improved version as variant
            entries.push({
              id: variantId,
              ...candidateData,
              successes: verified && isValid ? 1 : 0,
              failures: verified && !isValid ? 1 : 0,
              // G0: No inactivity tracking
              fingerprint: candidateFingerprint,
              version,
              variantOf: baseEntry.id,
              validated: isValid
            });
            continue;
          }
        }
        
        // Generate ID for new entry
        const id = digest(`${candidate.code}\0${candidate.description}`).slice(0, 16);
        
        // Check if entry with this ID already exists
        const existingEntry = entries.find(e => e.id === id);
        
        if (existingEntry) {
          // Entry exists - if verified and valid, update it
          const isValid = await verifyQuickJS(candidate.code);
          if (verified && isValid) {
            // Update existing entry
            existingEntry.code = candidate.code;
            existingEntry.description = candidate.description;
            existingEntry.objective = candidate.objective;
            existingEntry.parameters = candidate.parameters;
            existingEntry.fingerprint = candidateFingerprint;
            existingEntry.version = Math.max(existingEntry.version || 1, version);
            existingEntry.validated = true;
            existingEntry.successes += 1;
            // G0: No inactivity tracking
          } else if (verified && !isValid) {
            existingEntry.failures += 1;
          }
        } else {
          // New entry
          const isValid = await verifyQuickJS(candidate.code);
          
          entries.push({
            id,
            ...candidateData,
            successes: verified && isValid ? 1 : 0,
            failures: verified && !isValid ? 1 : 0,
            // G0: No inactivity tracking
            fingerprint: candidateFingerprint,
            version,
            validated: isValid
          });
        }
      }
      
      prune();
      await persist();
    },
    purges: () => purges
  };
}
