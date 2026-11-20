# Define symbol-proof fingerprints from the symbol's stripped span text, with one engine fingerprint per catalogue

Spec #233 needs a deterministic fingerprint for `symbol` proofs. We decide to compute it as the SHA-256 of the cited symbol's source span, stripped of comments and insignificant whitespace — not a serialization of the syntax tree — located with the tree-sitter grammar the workspace language resolves to. The engine fingerprint that detected an engine change (`engine_changed`) lives once in the catalogue metadata, never per proof.

Why: hashing a tree serialization makes fingerprints depend on grammar internals; grammars restructure or rename node types between releases, so a tool upgrade would invalidate whole catalogues with a misleading `hash_mismatch`. A spike across three years of `tree-sitter-typescript` releases (0.20-era vs 0.23-era) showed symbol spans stable — 7/7 identical fingerprints — so a stripped span satisfies the same acceptance criteria (#233: insensitive to comments and formatting, sensitive to identifiers, operators and literals) while being nearly grammar-version independent.

Considered and rejected: per-proof `engine`/`grammar` fields (pay off only in the AST-serialization design we rejected); a regex/brace-extraction canonicalizer (violates the "never invent a fingerprint for an unsupported language" rule); stripping less than comments/whitespace (breaks the formatting-only acceptance criterion).

Consequence: a future grammar upgrade that moves a symbol's boundaries can still invalidate proofs, so the catalogue-level fingerprint routes this to an explicit re-verification instead of a false code-change diagnosis.
