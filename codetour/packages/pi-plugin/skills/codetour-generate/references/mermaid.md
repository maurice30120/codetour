# CodeTour Mermaid diagrams

Use a small diagram when it clarifies the route. CodeTour accepts only
`flowchart`, `sequenceDiagram`, `stateDiagram-v2`, `classDiagram`, and
`erDiagram`; start the source with that exact declaration. Put a standalone
caption such as `**Diagram — Creation flow**` on the nearest non-blank line
before a bare ` ```mermaid ` fence. The prefix `Diagram —` is literal and
stays in English even in a French Tour; translate only the descriptive text.
Use the literal em dash. Each description allows at most three diagrams, each
at most 20 KiB.

For flowcharts, use simple node IDs and quote labels containing punctuation or
reserved words, for example `A["Start (CLI)"] --> B["Create Tour"]`. In
sequence diagrams use neutral participant IDs such as `Store`: the description
validator also checks diagram text for forbidden URI schemes, so `File:` can
be rejected. Encode newlines and quotes correctly inside JSON strings. For
other syntax consult the [Mermaid syntax reference](https://mermaid.ai/open-source/intro/syntax-reference.html);
CodeTour's supported kinds and installed renderer take precedence over newer
Mermaid features. On refusal, fix each reported diagram issue and resubmit;
the CodeTour CLI validates diagrams offline with its renderer.

