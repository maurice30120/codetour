# Keep the commits actually analyzed in a Changes Tour

A committed-only Changes Tour stores the resolved merge-base SHA in `baseRef` and the HEAD SHA in `ref`, rather than a moving base reference or its tip commit: playback must reproduce the comparison that was analyzed, even after branches move. A tour that actually includes local changes uses the current file for all its file steps, because a commit pair does not represent that whole analysis; requesting their inclusion on a clean workspace keeps the Git comparison.
