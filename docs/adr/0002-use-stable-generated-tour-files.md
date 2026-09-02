# Use stable generated tour files

> **Superseded by [ADR-0010](0010-expose-a-single-create-tour-tool.md).** This decision is obsolete: the output file name is now chosen by the Tour Generator and validated as a bare `.tour` name, rather than fixed to `.tours/project.tour` and `.tours/changes.tour`.

Generated tours use the stable destinations `.tours/project.tour` and `.tours/changes.tour`, and each generation atomically replaces the corresponding file. This favors a predictable one-command workflow over retaining generation history; version control remains responsible for recovering earlier content.
