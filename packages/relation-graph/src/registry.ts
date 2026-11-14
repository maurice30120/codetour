import { createDefaultPack } from "./default-pack";
import { normalizeLanguage, SUPPORTED_LANGUAGE_IDS } from "./languages";
import { createJavaPack } from "./java-pack";
import { createTypeScriptPack } from "./pack-typescript";
import { csharpPack } from "./packs/csharp";
import { pythonPack } from "./packs/python";
import type { LanguagePack } from "./pack";

/**
 * The language registry of #150. The per-language packs of tickets #151–#154
 * ship in this module and are AUTO-REGISTERED as the registry defaults by a
 * single `registerBuiltinPacks()` (called from `ensureDefaultPacks`, i.e. on
 * first use of the registry, and re-exported from the index). One consistent
 * policy for every language: the real pack is the default; `registerPack` still
 * plugs a custom pack over the default for its language, and
 * `resetLanguagePacks()` restores exactly the built-in set. Only a language
 * whose real pack has not landed falls back to the generic default pack.
 */

const packs = new Map<string, LanguagePack>();
let defaultsEnsured = false;

function keyOf(language: string): string {
  return normalizeLanguage(language) ?? language.trim().toLowerCase();
}

/** The built-in pack for a canonical language id: the real #151–#154 pack when it has landed, else the generic default. */
function builtinPackFor(language: string): LanguagePack {
  switch (language) {
    case "typescript":
      return createTypeScriptPack("typescript");
    case "tsx":
      return createTypeScriptPack("tsx");
    case "csharp":
      return csharpPack;
    case "java":
      return createJavaPack();
    case "python":
      return pythonPack;
    default:
      return createDefaultPack(language);
  }
}

/**
 * Register ALL built-in language packs (#151–#154: TypeScript/TSX, C#, Java,
 * Python) as the registry defaults. Called automatically on first registry
 * use; also exported from the index for consumers that want to re-apply the
 * built-ins explicitly. `resetLanguagePacks()` restores this exact set.
 */
export function registerBuiltinPacks(): void {
  for (const language of SUPPORTED_LANGUAGE_IDS) {
    packs.set(language, builtinPackFor(language));
  }
}

function ensureDefaultPacks(): void {
  if (defaultsEnsured) return;
  defaultsEnsured = true;
  registerBuiltinPacks();
}

/** Plug a pack into the registry (replaces any pack for the same language). */
export function registerPack(pack: LanguagePack): void {
  ensureDefaultPacks();
  packs.set(keyOf(pack.language), pack);
}

export function unregisterPack(language: string): boolean {
  ensureDefaultPacks();
  return packs.delete(keyOf(language));
}

export function getPack(language: string): LanguagePack | undefined {
  ensureDefaultPacks();
  return packs.get(keyOf(language));
}

export function listSupportedLanguages(): string[] {
  ensureDefaultPacks();
  return [...packs.keys()];
}

export function isLanguageSupported(language: string): boolean {
  return getPack(language) !== undefined;
}

/** Drop all custom packs and restore the built-in packs of #151–#154 (test helper). */
export function resetLanguagePacks(): void {
  packs.clear();
  defaultsEnsured = false;
  ensureDefaultPacks();
}
