# Use stable generated tour files

Generated tours use the stable destinations `.tours/project.tour` and `.tours/changes.tour`, and each generation atomically replaces the corresponding file. This favors a predictable one-command workflow over retaining generation history; version control remains responsible for recovering earlier content.
