import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TERMINAL_OPTION,
  VSCODE_OPTION,
  openingOptions,
  openingQuestion,
  readerCommand,
  vscodeOpenCommand,
  vscodeUri,
} from "../packages/pi-plugin/lib/reader.mjs";

// The opening dialogue of the Pi plugin (ticket #242, amendment): at the end of
// a generation the plugin asks the user to open the created Tour in the
// terminal (the shipped CLI's real interactive reader, ticket #241) or in VS
// Code (the "Open in VS Code" contract of ticket #244, the Tour at the active
// step). Never a textual summary, whatever the choice. Pure decisions, no
// I/O, so the dialogue is testable without a Pi session, exactly like
// `guard.mjs`.

test("a created Tour proposes the default reading path on its exact title", () => {
  const command = readerCommand({ tourCreated: true, tourTitle: "Payment Flow", tourPath: ".tours/payment.tour" });
  assert.equal(command, 'codetour "Payment Flow"');
});

test("a title with quotes and spaces is quoted safely", () => {
  const command = readerCommand({ tourCreated: true, tourTitle: 'Rates "on claim"', tourPath: ".tours/rates.tour" });
  assert.equal(command, 'codetour "Rates \\"on claim\\""');
});

test("without a title the recorded Tour file drives the reader directly", () => {
  const command = readerCommand({ tourCreated: true, tourTitle: null, tourPath: ".tours/changes.tour" });
  assert.equal(command, 'codetour --internal-tour ".tours/changes.tour"');
});

test("no Tour, no command and no question", () => {
  const state = { tourCreated: false, tourTitle: null, tourPath: null };
  assert.equal(readerCommand(state), null);
  assert.equal(openingQuestion(state), null);
  assert.equal(readerCommand(null), null);
  assert.equal(openingQuestion(null), null);
  assert.equal(readerCommand({ tourCreated: true, tourTitle: "", tourPath: null }), null);
  assert.equal(readerCommand({ tourCreated: true, tourTitle: null, tourPath: "" }), null);
});

test("the dialogue offers exactly the two real openings, never a summary", () => {
  assert.deepEqual(openingOptions(), [TERMINAL_OPTION, VSCODE_OPTION]);
  assert.match(TERMINAL_OPTION, /interactive reader/);
  assert.match(VSCODE_OPTION, /VS Code/);
});

test("the question names the created Tour", () => {
  assert.equal(
    openingQuestion({ tourCreated: true, tourTitle: "Payment Flow", tourPath: ".tours/payment.tour" }),
    'Open "Payment Flow" now?'
  );
  // Without a title the Tour file identifies it.
  assert.equal(
    openingQuestion({ tourCreated: true, tourTitle: null, tourPath: ".tours/changes.tour" }),
    'Open the Tour in changes.tour now?'
  );
});

test("the VS Code path is the explicit uri contract of the extension handler", () => {
  const uri = vscodeUri({ tourCreated: true, tourPath: ".tours/payment.tour" });
  // The publisher-named deep link accepted by src/extension.ts (tour, then the
  // 1-based step — the active step after generation is the first one).
  assert.equal(uri, "vscode://maurice30120.codetour/openTour?tour=.tours%2Fpayment.tour&step=1");
  const command = vscodeOpenCommand({ tourCreated: true, tourPath: ".tours/payment.tour" });
  assert.equal(command, `code --open-url "${uri}"`);
});

test("a Tour path with spaces and a title are encoded in the VS Code contract", () => {
  const command = vscodeOpenCommand({
    tourCreated: true,
    tourTitle: null,
    tourPath: ".tours/my tour.tour",
  });
  assert.equal(command, 'code --open-url "vscode://maurice30120.codetour/openTour?tour=.tours%2Fmy%20tour.tour&step=1"');
});

test("no Tour, no VS Code contract", () => {
  assert.equal(vscodeOpenCommand({ tourCreated: false, tourPath: null }), null);
  assert.equal(vscodeOpenCommand({ tourCreated: true, tourPath: "" }), null);
  assert.equal(vscodeOpenCommand(null), null);
});
