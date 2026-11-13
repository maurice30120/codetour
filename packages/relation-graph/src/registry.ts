import { createDefaultPack } from "./default-pack";
import { normalizeLanguage, SUPPORTED_LANGUAGE_IDS } from "./languages";
import { pythonPack } from "./packs/python";
import type { LanguagePack } from "./pack";

/**
 * The language registry of #150. Ships the five grammars as built-in packs;
 * languages whose real pack has landed (ticket #154: Python) use it instead of
 * the generic default, and tickets #151–#153 plug theirs in with `registerPack`
 * (a registered pack replaces the default for its language).
 */

const packs = new Map<string, LanguagePack>();
let defaultsEnsured = false;

function keyOf(language: string): string {
  return normalizeLanguage(language) ?? language.trim().toLowerCase();
}

function defaultPackFor(language: string): LanguagePack {
  // #154: the Python pack replaces the generic pack for "python".
  if (language === "python") return pythonPack;
  return createDefaultPack(language);
}

function ensureDefaultPacks(): void {
  if (defaultsEnsured) return;
  defaultsEnsured = true;
  for (const language of SUPPORTED_LANGUAGE_IDS) {
    if (!packs.has(language)) packs.set(language, defaultPackFor(language));
  }
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

/** Drop all custom packs and restore the built-in defaults (test helper). */
export function resetLanguagePacks(): void {
  packs.clear();
  defaultsEnsured = false;
  ensureDefaultPacks();
}
