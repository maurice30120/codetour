"""Run one campaign Pi session under a PTY and answer its two dialogues.

Same environment and command as run.py, but this driver owns the PTY so it can
send the prompt, pick "Project Tour" in the /codetour menu, pick "VS Code" in the
opening dialogue, and quit Pi without an operator.

    python3 drive.py <run> <mode> [terminal|vscode]

Writes runs/<run>/{command,environment,start,end,drive}.json and terminal.raw.
"""
import fcntl
import json
import os
import pathlib
import pty
import re
import select
import signal
import struct
import sys
import termios
import time

root = pathlib.Path(__file__).resolve().parents[2]
d = pathlib.Path(__file__).resolve().parent
run, mode = sys.argv[1], sys.argv[2]
opening = sys.argv[3] if len(sys.argv) > 3 else "vscode"
# The TE home can be split from the memory choice for a control run that must not
# append to the campaign's measured state: `home` defaults to the memory's own home.
home = sys.argv[4] if len(sys.argv) > 4 else mode
rd = d / "runs" / run
rd.mkdir(exist_ok=True)
prompt = (d / "prompts" / f"{run}.txt").read_text()

env = {k: v for k, v in os.environ.items() if not k.startswith(("TE_", "TOKENECONOMIZER_"))}
env.update(
    PI_CODING_AGENT_DIR=str(d / "pi"),
    PI_OFFLINE="1",
    PI_TELEMETRY="0",
    TOKENECONOMIZER_HOME=str(d / home),
    TE_HISTORY_IMPORT="off",
    TE_TOOLPRUNE="off",
    TE_LOOPGUARD="off",
    TE_REPOMAP="off",
    TE_PI_PAID_MODEL="mistral/deepseek-v4-1-flash-1017",
    TE_PI_CLI=str(d / "pi-capture"),
    CAMPAIGN_DIR=str(d),
    TERM="xterm-256color",
    COLUMNS="120",
    LINES="40",
)
cmd = [
    "rtk",
    str(root / "launch-local.sh"),
    "pi",
    "--memory=" + mode,
    "--model", "mistral/deepseek-v4-1-flash-1017",
    "--thinking", os.environ.get("CAMPAIGN_THINKING", "off"),
    "--session-dir", str(d / "sessions"),
    "--name", d.name + "-" + run,
    "--no-prompt-templates",
    "--no-mcp",
    "--append-system-prompt",
    "Campagne de mesure : préserve les sources et les artefacts existants. Ne lis ni les "
    "données privées .campaigns/ ni les Tours existants. Tu peux écrire une proposition dans "
    "/tmp puis créer exactement un Tour via le CLI.",
]
(rd / "command.json").write_text(json.dumps(cmd, indent=2))
(rd / "environment.json").write_text(
    json.dumps({k: v for k, v in env.items() if k.startswith(("TE_", "TOKENECONOMIZER_", "PI_"))}, indent=2)
)
(rd / "start.json").write_text(json.dumps({"time": time.time(), "mode": mode, "opening": opening}))
events = []

ANSI = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[a-zA-Z]|\x1b[=>][0-9]*[a-zA-Z]?")

pid, fd = pty.fork()
if pid == 0:  # child
    try:
        os.chdir(root)
        fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        os.execvpe(cmd[0], cmd, env)
    finally:
        os._exit(127)

raw = open(rd / "terminal.raw", "wb")
buf = ""


def pump(timeout):
    """Read whatever the session writes for up to `timeout` seconds."""
    global buf
    end = time.time() + timeout
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], min(0.5, max(0.0, end - time.time())))
        if not r:
            continue
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            return False
        if not chunk:
            return False
        raw.write(chunk)
        raw.flush()
        buf = (buf + chunk.decode("utf-8", "replace"))[-400000:]
    return True


def text():
    return ANSI.sub("", buf).replace("\r", "")


def send(data, note=""):
    events.append({"at": round(time.time(), 3), "sent": note or repr(data)})
    os.write(fd, data.encode() if isinstance(data, str) else data)


def wait_for(marker, timeout, note):
    """Wait until `marker` shows up in the newest output, or give up."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if marker in text():
            events.append({"at": round(time.time(), 3), "seen": note, "marker": marker})
            return True
        if not pump(1):
            return False
    events.append({"at": round(time.time(), 3), "timeout": note, "marker": marker})
    return False


ok = True
dialogue = False
try:
    if not wait_for("escape interrupt", 180, "startup banner"):
        ok = False
    if ok:
        send(prompt, "prompt")
        pump(3)
        send("\r", "submit")
        # /codetour asks which kind of Tour: Project Tour is the first entry.
        if wait_for("Which tour should be generated?", 180, "tour kind menu"):
            send("\r", "select Project Tour")
        else:
            ok = False
    if ok:
        if not wait_for("Tour créé", 1500, "tour creation"):
            ok = False
    # The opening dialogue only appears when the extension attributes the creation to this
    # response, which fails when the agent runs the CLI from a sub-directory: the journal then
    # records another workspace. A missing dialogue is a recorded outcome, not a failure.
    dialogue = ok and wait_for("now?", 90, "opening dialogue")
    if dialogue:
        if opening == "vscode":
            send("\x1b[B", "down"); pump(1); send("\r", "select VS Code"); pump(3)
        else:
            send("\r", "select Terminal")
            wait_for("space next", 60, "terminal reader")
            for _ in range(6):
                send("q"); pump(1)
    # Back at the prompt: quit so TE folds the session.
    pump(5)
    send(b"\x04", "ctrl+d")
    if not wait_for("To resume this session", 60, "pi exit banner"):
        events.append({"at": round(time.time(), 3), "interrupted": "ctrl+d did not exit"})
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
finally:
    deadline = time.time() + 30
    while True:
        try:
            done, status = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            done, status = pid, 0
        if done:
            break
        if time.time() > deadline:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            events.append({"at": round(time.time(), 3), "killed": "session did not exit"})
            _, status = os.waitpid(pid, 0)
            break
        pump(1)
    raw.close()
    (rd / "end.json").write_text(json.dumps({"time": time.time(), "exit_code": os.waitstatus_to_exitcode(status)}))
    (rd / "drive.json").write_text(json.dumps({"ok": ok, "dialog": bool(dialogue), "events": events}, indent=1))
