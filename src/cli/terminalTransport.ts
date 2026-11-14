import type { TerminalTransport } from "@b9g/termdom";

// TermDOM's mouse tracking sends drags to its DOM selection instead of the
// host terminal's Copy/Find commands. The reader navigates by keyboard, so
// leave selection with the host. Apply this at the public transport boundary
// to cover suspend/resume too, without reaching into TermDOM's private state.
const MOUSE_MODES = new Set([9, 1000, 1001, 1002, 1003, 1006, 1015, 1016]);

function nativeMouse(text: string): string {
  // TermDOM emits complete mode controls in its writes. Keep other modes in
  // a combined DECSET: fullscreen, paste and keyboard handling still apply.
  return text.replace(/\x1b\[\?([0-9;]+)h/g, (_sequence, parameters: string) => {
    const modes = parameters.split(";").filter(mode => !MOUSE_MODES.has(Number(mode)));
    return modes.length ? "\x1b[?" + modes.join(";") + "h" : "";
  });
}

export function nativeSelectionTransport(transport: TerminalTransport): TerminalTransport {
  const writer = transport.writable.getWriter();
  const writable = new WritableStream<string>({
    write: text => {
      const filtered = nativeMouse(text);
      return filtered ? writer.write(filtered) : undefined;
    },
    close: () => writer.close(),
    abort: reason => writer.abort(reason)
  });
  return {
    // These stay live/lazy: copying them would freeze dimensions and engage
    // the process's raw input before TermDOM attaches.
    get cols() { return transport.cols; },
    get rows() { return transport.rows; },
    get readable() { return transport.readable; },
    get resizes() { return transport.resizes; },
    get sharesScreen() { return transport.sharesScreen; },
    get interactive() { return transport.interactive; },
    get ready() { return transport.ready; },
    get closed() { return transport.closed; },
    writable,
    close: info => transport.close(info),
    logError: transport.logError ? text => transport.logError!(text) : undefined,
    writeSync: transport.writeSync ? text => transport.writeSync!(nativeMouse(text)) : undefined,
    suspend: transport.suspend ? () => transport.suspend!() : undefined
  };
}
