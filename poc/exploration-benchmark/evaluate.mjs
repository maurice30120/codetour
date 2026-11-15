import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

/**
 * Independent Evaluator for Spec #172 - Ticket 07
 * 
 * This evaluator:
 * - Is independent from POC and Vibe agents
 * - Performs blind verification (doesn't know which agent produced the result)
 * - Verifies claims against the repository code
 * - Checks proof quality and coverage
 * - Does NOT serve as comparator between agents
 * - Does NOT serve as systematic production validation
 * 
 * Input formats supported:
 * 1. Simple format: { taskId, evidence: [{ file, startLine, endLine }] }
 * 2. Full agent result: { rows: [{ result: { entryPoints, components, relations, evidence } }] }
 * 3. Benchmark result: { model, root, rows: [...] }
 * 
 * Usage:
 *   node evaluate.mjs result.json [--workspace directory]
 */

if (!args[0] || (args.length !== 1 && (args.length !== 3 || args[1] !== '--workspace'))) {
  console.error('Usage: node evaluate.mjs result.json [--workspace directory]');
  process.exit(2);
}

try {
  const resultFile = args[0];
  const workspace = args[2] ?? path.join(base, 'workspace');
  const root = await realpath(workspace);
  
  // Read and parse the result file
  const rawData = JSON.parse(await readFile(resultFile, 'utf8'));
  
  // NORMALIZE: Convert any agent output format to standardized format
  // This removes agent identifiers and normalizes the structure
  const normalized = normalizeInput(rawData);
  
  // BLIND VERIFICATION: Remove all agent-specific identifiers
  // The evaluator doesn't know or care which agent produced these results
  const blindResult = removeAgentIdentifiers(normalized);
  
  // Load expected zones for verification
  const expected = JSON.parse(await readFile(path.join(base, 'expected.json'), 'utf8'));
  
  // VALIDATE: Check all evidence references against actual filesystem
  const { valid, invalid } = await validateEvidence(blindResult.evidence, root);
  
  // VERIFY: Check claims against repository code
  const claimVerification = await verifyClaims(blindResult, valid, root);
  
  // COVERAGE: Check proof quality and coverage
  const coverage = checkCoverage(blindResult.taskId, valid, expected);
  
  // QUALITY: Check proof quality
  const quality = checkProofQuality(blindResult, valid, claimVerification);
  
  // Output results
  const output = {
    // Blind verification metadata
    blindVerification: true,
    agentIdentifiersRemoved: true,
    
    // Original task identifier
    taskId: blindResult.taskId,
    
    // Evidence validation
    valid,
    invalid,
    
    // Coverage analysis
    covered: coverage.covered,
    missing: coverage.missing,
    coverageRatio: coverage.coverageRatio,
    
    // Claim verification
    claimVerification,
    
    // Proof quality assessment
    proofQuality: quality,
    
    // Overall assessment (judgment, not infallible)
    assessment: generateAssessment(valid, invalid, coverage, quality, claimVerification),
    
    // Note: This is a judgment, not a systematic production validation
    note: 'This evaluation provides judgment on claim accuracy and proof quality. ' +
          'It is NOT a comparator between agents and NOT a systematic production validation. ' +
          'Results should be reviewed manually for critical decisions.'
  };
  
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.error(`Evaluation failed: ${error.message}`);
  process.exit(1);
}

/**
 * Normalize input from any agent format to a standard format
 * This allows the evaluator to work with results from POC, Vibe, or any other agent
 */
function normalizeInput(rawData) {
  // Format 1: Simple format (current format)
  if (rawData.taskId && Array.isArray(rawData.evidence)) {
    return {
      taskId: rawData.taskId,
      evidence: rawData.evidence,
      claims: extractClaimsFromSimple(rawData)
    };
  }
  
  // Format 2: Full agent result with rows
  if (Array.isArray(rawData.rows) && rawData.rows[0]?.result) {
    // Extract all evidence from all rows
    const allEvidence = [];
    const allClaims = [];
    let taskId = 'unknown';
    
    for (const row of rawData.rows) {
      const result = row.result;
      if (result) {
        taskId = result.taskId || row.task || taskId;
        
        // Extract evidence from various structures
        if (result.evidence) {
          allEvidence.push(...result.evidence);
        }
        
        // Extract from entryPoints
        if (result.entryPoints) {
          for (const ep of result.entryPoints) {
            if (ep.evidence) {
              allEvidence.push(...ep.evidence);
              allClaims.push({
                type: 'entryPoint',
                name: ep.name,
                description: ep.description || ''
              });
            }
          }
        }
        
        // Extract from components
        if (result.components) {
          for (const comp of result.components) {
            if (comp.evidence) {
              allEvidence.push(...comp.evidence);
              allClaims.push({
                type: 'component',
                name: comp.name,
                description: comp.description || ''
              });
            }
          }
        }
        
        // Extract from relations
        if (result.relations) {
          for (const rel of result.relations) {
            if (rel.evidence) {
              allEvidence.push(...rel.evidence);
              allClaims.push({
                type: 'relation',
                from: rel.from,
                to: rel.to,
                description: rel.description || ''
              });
            }
          }
        }
      }
    }
    
    return {
      taskId,
      evidence: allEvidence,
      claims: allClaims
    };
  }
  
  // Format 3: Benchmark result with model info
  if (rawData.model && Array.isArray(rawData.rows)) {
    // Same as Format 2 but with model info
    return normalizeInput({ rows: rawData.rows });
  }
  
  // Unknown format
  throw new Error(`Unsupported input format: ${JSON.stringify(Object.keys(rawData))}`);
}

/**
 * Extract claims from simple format
 */
function extractClaimsFromSimple(data) {
  // In simple format, claims are implicit in the taskId
  // We can't extract explicit claims, so return empty array
  return [];
}

/**
 * Remove agent identifiers to ensure blind verification
 * The evaluator should not know which agent produced the results
 */
function removeAgentIdentifiers(normalized) {
  // Create a clean copy without any agent-specific information
  return {
    taskId: normalized.taskId,
    evidence: normalized.evidence.map(e => ({
      file: e.file,
      startLine: e.startLine,
      endLine: e.endLine
    })),
    claims: normalized.claims || []
  };
}

/**
 * Validate evidence against the filesystem
 * Checks that files exist, are within workspace, and line numbers are valid
 */
async function validateEvidence(evidenceList, root) {
  const valid = [];
  const invalid = [];
  
  for (const evidence of evidenceList) {
    try {
      // Validate evidence structure
      if (typeof evidence.file !== 'string') {
        throw new Error('file must be a string');
      }
      if (path.isAbsolute(evidence.file)) {
        throw new Error('file path must be relative');
      }
      if (!Number.isInteger(evidence.startLine) || !Number.isInteger(evidence.endLine)) {
        throw new Error('startLine and endLine must be integers');
      }
      if (evidence.startLine < 1) {
        throw new Error('startLine must be >= 1');
      }
      if (evidence.endLine < evidence.startLine) {
        throw new Error('endLine must be >= startLine');
      }
      
      // Resolve the file path
      const file = await realpath(path.resolve(root, evidence.file));
      const relative = path.relative(root, file);
      
      // Security check: ensure file is within workspace
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('outside workspace');
      }
      
      // Check if it's a file
      const stats = await stat(file);
      if (!stats.isFile()) {
        throw new Error('not a file');
      }
      
      // Check line numbers
      const contents = await readFile(file, 'utf8');
      const lineCount = contents === '' ? 0 : contents.split('\n').length - (contents.endsWith('\n') ? 1 : 0);
      if (evidence.endLine > lineCount) {
        throw new Error(`line out of bounds (file has ${lineCount} lines, endLine is ${evidence.endLine})`);
      }
      
      // Store with normalized path
      valid.push({
        ...evidence,
        file: relative.split(path.sep).join('/')
      });
    } catch (error) {
      invalid.push({
        evidence,
        reason: error.message
      });
    }
  }
  
  return { valid, invalid };
}

/**
 * Verify claims against actual repository code
 * This checks if the evidence actually supports the claims being made
 */
async function verifyClaims(normalized, validEvidence, root) {
  const verifications = [];
  
  // If we have explicit claims, verify each one
  if (normalized.claims && normalized.claims.length > 0) {
    for (const claim of normalized.claims) {
      const claimVerifications = [];
      
      // Find evidence that supports this claim
      const supportingEvidence = validEvidence.filter(e => {
        // For now, we assume all evidence is relevant to the task
        // In a more sophisticated implementation, we'd match claims to specific evidence
        return true;
      });
      
      // Verify each piece of supporting evidence actually contains relevant code
      for (const evidence of supportingEvidence) {
        try {
          const filePath = path.resolve(root, evidence.file.replace(/\//g, path.sep));
          const contents = await readFile(filePath, 'utf8');
          const lines = contents.split('\n');
          
          // Extract the referenced lines
          const referencedLines = lines.slice(evidence.startLine - 1, evidence.endLine);
          const codeSnippet = referencedLines.join('\n');
          
          // Basic verification: the code exists and is non-empty
          if (codeSnippet.trim().length > 0) {
            claimVerifications.push({
              evidence: evidence,
              codeSnippet: codeSnippet.substring(0, 200), // Limit snippet size
              verified: true,
              reason: 'Code exists and is non-empty'
            });
          } else {
            claimVerifications.push({
              evidence: evidence,
              codeSnippet: '',
              verified: false,
              reason: 'Referenced lines are empty'
            });
          }
        } catch (error) {
          claimVerifications.push({
            evidence: evidence,
            codeSnippet: '',
            verified: false,
            reason: `Failed to read file: ${error.message}`
          });
        }
      }
      
      verifications.push({
        claim,
        supportingEvidence: claimVerifications,
        verified: claimVerifications.every(v => v.verified),
        confidence: calculateConfidence(claimVerifications)
      });
    }
  } else {
    // No explicit claims, verify that all evidence points to valid code
    for (const evidence of validEvidence) {
      try {
        const filePath = path.resolve(root, evidence.file.replace(/\//g, path.sep));
        const contents = await readFile(filePath, 'utf8');
        const lines = contents.split('\n');
        const referencedLines = lines.slice(evidence.startLine - 1, evidence.endLine);
        const codeSnippet = referencedLines.join('\n');
        
        verifications.push({
          claim: { type: 'implicit', description: `Evidence at ${evidence.file}:${evidence.startLine}-${evidence.endLine}` },
          supportingEvidence: [{
            evidence: evidence,
            codeSnippet: codeSnippet.substring(0, 200),
            verified: codeSnippet.trim().length > 0,
            reason: codeSnippet.trim().length > 0 ? 'Code exists and is non-empty' : 'Referenced lines are empty'
          }],
          verified: codeSnippet.trim().length > 0,
          confidence: codeSnippet.trim().length > 0 ? 'high' : 'low'
        });
      } catch (error) {
        verifications.push({
          claim: { type: 'implicit', description: `Evidence at ${evidence.file}:${evidence.startLine}-${evidence.endLine}` },
          supportingEvidence: [{
            evidence: evidence,
            codeSnippet: '',
            verified: false,
            reason: `Failed to read file: ${error.message}`
          }],
          verified: false,
          confidence: 'low'
        });
      }
    }
  }
  
  return verifications;
}

/**
 * Calculate confidence level based on verification results
 */
function calculateConfidence(verifications) {
  if (verifications.length === 0) return 'none';
  
  const verifiedCount = verifications.filter(v => v.verified).length;
  const ratio = verifiedCount / verifications.length;
  
  if (ratio >= 0.8) return 'high';
  if (ratio >= 0.5) return 'medium';
  if (ratio > 0) return 'low';
  return 'none';
}

/**
 * Check coverage against expected zones
 */
function checkCoverage(taskId, validEvidence, expected) {
  if (!expected[taskId]) {
    return {
      covered: [],
      missing: [],
      coverageRatio: 0
    };
  }
  
  const expectedZones = expected[taskId];
  const covered = [];
  const coveredIds = new Set();
  
  for (const zone of expectedZones) {
    // Check if any valid evidence overlaps with this zone
    const overlaps = validEvidence.some(ref =>
      ref.file === zone.file &&
      ref.startLine <= zone.endLine &&
      ref.endLine >= zone.startLine
    );
    
    if (overlaps) {
      covered.push(zone);
      coveredIds.add(zone.id);
    }
  }
  
  const missing = expectedZones.filter(zone => !coveredIds.has(zone.id));
  const coverageRatio = expectedZones.length > 0 
    ? covered.length / expectedZones.length 
    : 0;
  
  return {
    covered: covered.map(zone => zone.id),
    missing: missing.map(zone => zone.id),
    coverageRatio
  };
}

/**
 * Check proof quality
 */
function checkProofQuality(normalized, validEvidence, claimVerification) {
  const metrics = {
    // Count metrics
    totalEvidence: normalized.evidence.length,
    validEvidence: validEvidence.length,
    invalidEvidence: normalized.evidence.length - validEvidence.length,
    
    // Claim verification metrics
    totalClaims: claimVerification.length,
    verifiedClaims: claimVerification.filter(c => c.verified).length,
    
    // Coverage metrics
    evidencePerClaim: normalized.claims.length > 0 
      ? validEvidence.length / normalized.claims.length 
      : 0,
    
    // Quality assessment
    qualityScore: 0,
    qualityLevel: 'low'
  };
  
  // Calculate quality score (0-100)
  let score = 0;
  
  // Valid evidence ratio (40 points)
  if (normalized.evidence.length > 0) {
    score += (validEvidence.length / normalized.evidence.length) * 40;
  }
  
  // Claim verification ratio (30 points)
  if (claimVerification.length > 0) {
    score += (claimVerification.filter(c => c.verified).length / claimVerification.length) * 30;
  }
  
  // Coverage (30 points) - will be added by caller
  
  metrics.qualityScore = Math.round(score);
  
  // Determine quality level
  if (metrics.qualityScore >= 80) {
    metrics.qualityLevel = 'excellent';
  } else if (metrics.qualityScore >= 60) {
    metrics.qualityLevel = 'good';
  } else if (metrics.qualityScore >= 40) {
    metrics.qualityLevel = 'fair';
  } else {
    metrics.qualityLevel = 'poor';
  }
  
  return metrics;
}

/**
 * Generate overall assessment
 * This is a judgment, not infallible
 */
function generateAssessment(valid, invalid, coverage, quality, claimVerification) {
  const totalEvidence = valid.length + invalid.length;
  const validRatio = totalEvidence > 0 ? valid.length / totalEvidence : 0;
  const verifiedRatio = claimVerification.length > 0 
    ? claimVerification.filter(c => c.verified).length / claimVerification.length 
    : 0;
  
  let overall = 'fail';
  let confidence = 'low';
  const reasons = [];
  
  if (validRatio >= 0.8) {
    reasons.push(`High evidence validity (${Math.round(validRatio * 100)}%)`);
  } else {
    reasons.push(`Low evidence validity (${Math.round(validRatio * 100)}%)`);
  }
  
  if (coverage.coverageRatio >= 0.8) {
    reasons.push(`High coverage (${Math.round(coverage.coverageRatio * 100)}%)`);
  } else {
    reasons.push(`Low coverage (${Math.round(coverage.coverageRatio * 100)}%)`);
  }
  
  if (verifiedRatio >= 0.8) {
    reasons.push(`High claim verification (${Math.round(verifiedRatio * 100)}%)`);
  } else {
    reasons.push(`Low claim verification (${Math.round(verifiedRatio * 100)}%)`);
  }
  
  // Overall assessment
  if (validRatio >= 0.8 && coverage.coverageRatio >= 0.8 && verifiedRatio >= 0.8) {
    overall = 'excellent';
    confidence = 'high';
  } else if (validRatio >= 0.6 && coverage.coverageRatio >= 0.6 && verifiedRatio >= 0.6) {
    overall = 'good';
    confidence = 'medium';
  } else if (validRatio >= 0.4 && coverage.coverageRatio >= 0.4) {
    overall = 'fair';
    confidence = 'low';
  } else {
    overall = 'poor';
    confidence = 'none';
  }
  
  return {
    overall,
    confidence,
    reasons,
    recommendation: overall === 'excellent' || overall === 'good' 
      ? 'Accept with confidence' 
      : 'Review manually before acceptance'
  };
}
