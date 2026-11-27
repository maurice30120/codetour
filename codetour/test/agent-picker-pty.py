#!/usr/bin/env python3
"""Answer the `codetour --install` picker in a real pseudo-terminal.

The picker only runs when standard input is a terminal, which no ordinary test
runner provides: this helper allocates one with `pty.fork()`, waits for the
question and types the answer, exactly like `standalone-terminal-smoke.py` does
for the terminal reader. The CLI, its environment and the workspace come from
the caller.

Usage: python3 test/agent-picker-pty.py <node> <cli.js> <answer>
"""
import os
import pty
import select
import signal
import sys
import time

node, cli, answer = sys.argv[1:4]
pid, fd = pty.fork()
if pid == 0:
    os.execv(node, [node, cli, "--install"])
output = bytearray()
status = None
sent = False
try:
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.2)
        if ready:
            try:
                output.extend(os.read(fd, 65536))
            except OSError:
                pass
        if not sent and b"Agent numbers or ids" in output:
            os.write(fd, (answer + "\n").encode())
            sent = True
        done, result = os.waitpid(pid, os.WNOHANG)
        if done:
            status = os.waitstatus_to_exitcode(result)
            break
    if not sent or status != 0:
        raise SystemExit("The agent picker failed: " + output[-3000:].decode(errors="replace"))
    sys.stdout.write(output.decode(errors="replace"))
finally:
    if status is None:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
