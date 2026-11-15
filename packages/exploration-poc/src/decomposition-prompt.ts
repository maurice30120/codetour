import { createHash } from 'node:crypto';

/**
 * Canonical decomposition prompt for the exploration harness.
 *
 * Single source of truth (issue #174 complement). Every consumer — the
 * exploration POC itself, the benchmark runner, the docs — must import this
 * constant; duplicated literal copies are prohibited.
 *
 * The SHA-256 below is computed from EXACTLY this string (no trailing
 * newline, UTF-8 encoding).
 */
export const DECOMPOSITION_PROMPT =
  "Avant d'explorer le dépôt, décompose mentalement l'objectif du Tour en quelques questions concrètes et indépendantes. Pour chacune, cherche les questions équivalentes via memory_list(query). Si une procédure répond déjà, exécute-la avec memory_run(id, params), vérifie ses preuves et complète seulement ce qui manque. Sinon, utilise d'abord les primitives permanentes ; si une question fonctionnelle autonome paraît réutilisable, essaie une procédure TypeScript paramétrée avec function_try(source, params). Suis le nommage canonique et les contrats du catalogue. Ne recrée ni primitives, ni questions équivalentes ; n'imbrique aucune procédure mémorisée dans une autre. Retourne des résultats structurés, compacts, sourcés, avec limites et incertitudes. Ne mémorise pas de réponse figée : seules les procédures exécutées peuvent être proposées après validation du Tour. Arrête l'exploration lorsque les preuves sont suffisantes ; n'explicite pas systématiquement la décomposition.";

/** SHA-256 of DECOMPOSITION_PROMPT (exact UTF-8 bytes of the string). */
export const PROMPT_SHA256 = createHash('sha256').update(DECOMPOSITION_PROMPT, 'utf8').digest('hex');
