import { workspace } from "vscode";
import { PlaybackMode } from "../store";

// Reads the user/workspace preference driving the playback presentation. The
// native comment mode remains the default for compatibility.
export function getPlaybackMode(): PlaybackMode {
  const mode = workspace
    .getConfiguration("codetour")
    .get<PlaybackMode>("playbackMode", "comments");
  return mode === "webview" ? "webview" : "comments";
}
