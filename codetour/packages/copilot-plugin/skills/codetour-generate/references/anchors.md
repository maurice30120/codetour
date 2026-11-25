# Anchor verification

Before submitting a proposal, verify every anchored step:

1. Select the workspace passed to the CLI. For a Project Tour, inspect its
   current files. For a Changes Tour without local changes, inspect each file
   at `headRef` (for example, `git show <headRef>:<path>`); when local changes
   are included, inspect the workspace version. For a detected rename,
   `baseFile`, if supplied, is the old path and `file` is the new path.
   Anchor at least one changed file when one can be anchored.
2. Choose an existing workspace-relative `file` or `directory` for each
   anchored step. Paths must remain inside the workspace, including after
   resolving symbolic links. Read the exact file version and locate the text
   that supports the step.
3. For a file location choose either a 1-based `line` checked against that
   file, or a `pattern`; never supply both. `pattern` is a JavaScript regular
   expression, at most 200 characters. Copy a short fragment from one line,
   escape regex metacharacters (including backslashes), and JSON-escape the
   resulting backslashes. Compile it and count matches across the entire
   selected file using JavaScript's global regex matching: exactly one match
   is required. If there are none or several, check the file version and
   extend the fragment; use a verified line if it cannot be made unique.
   Prefer literal fragments over expressions with costly backtracking.

   For example, to match the literal text `createTour(`:

   ```json
   { "file": "src/example.ts", "pattern": "createTour\\(" }
   ```

4. If using `selection`, supply `file` and verify both endpoints in that
   version: lines and characters start at 1, positions must be in bounds, and
   the start must not follow the end. `line`, `pattern`, and `selection`
   require `file`; a step cannot have both `file` and `directory`.
5. After assembling the JSON, recheck every step's description and its
   `file`–`line` or `file`–`pattern` pair together against the selected
   version. On refusal, correct every entry in `issues`, then resubmit.

