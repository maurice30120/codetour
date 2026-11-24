# Keep native playback with an optional Expanded Description View

Tour playback starts in native VS Code comments; the reader can explicitly open one Expanded Description View beside the code for the active Tour Step. Both surfaces share Tour Anchor resolution and progression, but while the expanded view is open the code displays only the active anchor marker, avoiding duplicate explanations and CodeTour comment threads.

Closing the panel restores native playback at the same step, and an asynchronous render must never reopen a closed panel. This preserves the existing native reading and recording workflow while providing room for rich descriptions and Tour Step Conversations, at the cost of maintaining two presentation lifecycles; the active anchor marker remains visible independently of the general tour-marker preference, and steps without a usable code anchor receive no invented marker.
