# Render Changes Tour diffs from persisted Git snapshots

Building on ADRs 0004 and 0010, a Changes Tour step requesting a diff compares the regular-file snapshots at the persisted `baseRef` and `ref` commit SHAs, even when the latter equals the current checkout's HEAD. The current workspace buffer cannot substitute for either side of a valid comparison: reproducible explanations take precedence over showing subsequent local edits.

A renamed file can declare `baseFile` for its original path; an added file uses an empty original document only after both commits resolve and Git explicitly reports the original path as missing. Missing revisions, unsupported object types and other Git failures must not be represented as additions. If the comparison cannot be resolved, playback falls back to its ordinary single-target presentation rather than fabricating a diff; this decision does not change the working-tree policy for Tours that include local changes.
