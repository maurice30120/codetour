# Spec — Optional local voice narration for the terminal Tour reader

**Status:** Draft — product behavior agreed; implementation not started  
**Decision date:** 2026-10-30  
**Depends on:** [Autonomous CodeTour CLI and TermDOM playback](./autonomous-cli-termdom-copilot-poc.md), branch `feature/spec-71-integration`  
**Scope:** Standalone TermDOM Tour reader only (`src/cli`)

## Problem

When reading a CodeTour step, the reader must currently divide attention between the step description and the associated code. Optional spoken narration would let the reader listen to the existing explanation while examining the code. This is a reader convenience feature for an open-source product, not a paid feature or a new tour-generation mechanism.

## Agreed experience

1. Narration is **disabled by default**, for each new terminal reading session. No setting is persisted to the repository or a Tour.
2. Press **V** (`v` in normal reader keyboard mode) to toggle narration on or off. This is a single unmodified key, **not Ctrl+V**. Do not intercept text entry while a step-chat question is being typed.
3. When enabled, the current step's existing `description` is read **immediately**. Subsequent steps are narrated automatically as the user navigates.
4. Navigating to another step interrupts the previous reading and replaces it with the new step's narration. The reader should never hear two steps concurrently; stale asynchronous callbacks must not resume earlier speech.
5. Disabling narration stops current speech immediately. Closing the reader also stops speech and releases resources.
6. Finishing a spoken description **never moves to the next step**. Normal reading, scrolling, diff inspection, and step-chat behavior remain available while narration runs.
7. A discrete **VOICE ON / VOICE OFF** indicator appears in the terminal reader's status area without obscuring existing navigation/help text.
8. Use the **operating system's default installed voice** and its normal language selection. Do not perform language detection, voice selection, or remote synthesis for this MVP.
9. If local speech is unavailable or fails, show a clear nonblocking warning and keep the Tour usable. Never abort a Tour because the optional audio engine cannot start.

## Spoken-text rules

Narrate **only the step's Markdown description**. Do not automatically narrate the embedded source/diff, file paths and line anchors, suggested questions, ACP exchanges, or the terminal UI.

Prepare spoken text from Markdown, independently of the visual TermDOM rendering:

- Read normal paragraphs, headings, and list text in a natural order; omit formatting punctuation.
- For a **Mermaid fenced diagram**, say **“Voir diagramme”** once instead of reading Mermaid source or node labels.
- For each **image**, say **“Voir image”** rather than a file path or URL.
- For other **fenced code blocks**, say **“Bloc de code”** rather than reading every line.
- Read inline code identifiers as ordinary words, and links by their visible label rather than the URL.
- Preserve the description's order: ordinary text before and after skipped rich content must still be spoken.
- Empty descriptions produce no audio; do not invent spoken summaries.

These are fixed MVP transformations, not user-configurable options. The existing renderer and Mermaid validation rules remain authoritative for *display*; the speech preparation module is only responsible for the spoken text.

## Architecture and integration

Keep the implementation **strictly isolated** from terminal rendering, the agent, and Tour persistence. Proposed module layout (filenames are implementation guidance):

- `src/cli/narration/NarrationController.ts`: enabled state, cancellation, replacement of speech, and race protection.
- `src/cli/narration/prepareText.ts`: pure Markdown-to-speech-text transformation.
- `src/cli/narration/SystemSpeech.ts`: replaceable local speech adapter, process lifecycle, and cancellation.

Minimal reader-facing contract:

```ts
class NarrationController {
  setEnabled(enabled: boolean): void;
  onStepChanged(description: string): void;
}
```

The controller owns speech state; TermDOM must not own the synthesis engine. `setEnabled(true)` reads the currently displayed step (via an explicit call or a supplied current-description context); `setEnabled(false)` cancels speech. `onStepChanged` cancels previous speech and reads the new description only when enabled. Reader shutdown must also cancel any active process, without requiring a broader public controller API for the MVP.

**Integration point:** `src/cli/terminal.ts` already owns `current`, keydown handling, and step navigation. Add the V binding there and notify the controller only on **real step changes**, plus the explicit transition from OFF to ON.

**Do not trigger narration from `render()` itself.** That function is also called on terminal resize and its async output is versioned. Scrolling, resizing, repainting, or re-rendering the same step must never restart narration. Avoid starting audio for a stale or failed step render; interrupt old speech promptly during navigation and only commit the new narration for the active, successfully displayed step.

Keep the rest of the VS Code player, standalone HTML renderer, Tour creation, MCP generation, agent adapters, and ACP conversations unchanged. No change to the `.tour` schema, on-disk data, or stored progress.

## Speech adapter and portability

- Use **local OS text-to-speech**, independent of AI agents and network services.
- **macOS:** evaluate the installed `say` command with the system-selected default voice.
- **Windows:** evaluate Windows' installed speech engine through an OS-native mechanism (for example Windows PowerShell / System.Speech), using the default voice.
- The adapter must be asynchronous, cancellable, and testable with an injected fake implementation.
- Pass user-controlled description text to the synthesizer safely. **Do not interpolate Markdown into shell commands** or run authored text as executable code.
- When a supported OS speech facility or voice is missing, fail gracefully and report why. Linux speech support is not a requirement for this first pass; Linux readers still work without audio.
- No external TTS API, paid service, model download, auto-language detection, voice catalogue, configurable speed, or automatic advancement in this MVP.

Feasibility and interruption behavior must be smoke-tested on real Windows and macOS terminals before claiming cross-platform support.

## Acceptance criteria

1. Start a terminal Tour: narration is OFF, the current step is silent, and the status accurately reflects OFF.
2. Press V: the current step begins using the local default voice; press V again: active speech stops and status reflects OFF.
3. With narration ON, move next/previous: previous speech is interrupted; only the newly displayed step is spoken.
4. Rapid navigation and slow speech startup never cause overlapping or out-of-order speech.
5. Resize, scroll, redraw, or open/close step-chat input: no spurious narration restart; typing a V inside the chat prompt enters text.
6. A Markdown fixture with prose, a Mermaid fence, an image, and a code fence speaks text in order with **“Voir diagramme”**, **“Voir image”**, and **“Bloc de code”**, without source dumps.
7. End the Tour or close the terminal reader while speech is active: speech stops and subprocess/resources are cleaned up.
8. Missing/failed TTS displays a nonblocking diagnostic; keyboard navigation and reading continue.
9. A fake speech adapter makes text preparation, toggling, cancellation, order, and error handling **deterministically testable** without speakers or paid services.
10. Existing CLI/TermDOM tests and CodeTour Tour-schema, playback, and creation behavior remain unchanged.

## Out of scope / later possibilities

Pausing, replay controls, volume/rate settings, different voices, detecting the description language, speech highlighting/synchronization, narration of code or diagram internals, auto-next, VS Code and HTML playback, and agents generating audio are **not part of this draft**.

## Implementation note

This document records the agreed UX and technical direction only. It does **not** implement narration and does **not** claim Windows/macOS synthesizer or keyboard behavior has been experimentally verified.
