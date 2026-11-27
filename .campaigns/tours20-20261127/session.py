"""Une session Pi neuve pour un essai, pilotée sous PTY.

Même environnement pour les vingt essais, sauf le foyer TE de la variante (qui porte la
configuration posée par `campaign.py prepare`). La session est distincte, nommée, et son
répertoire de sessions est propre à la campagne.

    python3 session.py <run>
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

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import campaign

DIR = campaign.DIR
PI = "/Users/dhuyet/.pi/agent/bin/pi"
ANSI = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[a-zA-Z]|\x1b[=>][0-9]*[a-zA-Z]?")

run = sys.argv[1]
item = campaign.entry(run)
rd = campaign.run_dir(run)
home = campaign.home(run)

env = {k: v for k, v in os.environ.items() if not k.startswith(("TE_", "TOKENECONOMIZER_", "PI_"))}
env.update(
    PI_CODING_AGENT_DIR=str(DIR / "pi"),
    PI_OFFLINE="1",
    PI_TELEMETRY="0",
    TOKENECONOMIZER_HOME=str(home),
    TE_PYTHON=str(campaign.PYTHON),
    TE_PI_PAID_MODEL=campaign.MODEL,
    TE_PI_CLI=str(DIR / "pi-capture"),
    CAMPAIGN_DIR=str(DIR),
    TERM="xterm-256color",
    COLUMNS="120",
    LINES="40",
)
cmd = [
    PI,
    "--model", campaign.MODEL,
    "--thinking", "off",
    "--session-dir", str(DIR / "sessions"),
    "--name", f"{campaign.STAMP}-{run}",
    "--no-mcp",
    "--no-prompt-templates",
    "--append-system-prompt", campaign.RULES,
]
(rd / "command.json").write_text(json.dumps(cmd, indent=2))
(rd / "environment.json").write_text(json.dumps(
    {k: v for k, v in env.items() if k.startswith(("TE_", "TOKENECONOMIZER_", "PI_"))}, indent=2))
(rd / "prompt.txt").write_text(campaign.prompt(run))
(rd / "start.json").write_text(json.dumps({"time": time.time(), "variant": item["variant"]}))

events = []
pid, fd = pty.fork()
if pid == 0:
    try:
        os.chdir(campaign.ROOT)
        fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        os.execvpe(cmd[0], cmd, env)
    finally:
        os._exit(127)

raw = open(rd / "terminal.raw", "wb")
buf = ""


def pump(timeout):
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
    events.append({"at": round(time.time(), 3), "sent": note or repr(data[:80])})
    os.write(fd, data.encode() if isinstance(data, str) else data)


STATUS = {"status": None}


def exited():
    """Le processus Pi a-t-il rendu la main ?"""
    if STATUS["status"] is not None:
        return True
    try:
        done, status = os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        STATUS["status"] = 0
        return True
    if done:
        STATUS["status"] = status
    return bool(done)


def wait_any(markers, timeout, note):
    """Attend l'un des marqueurs ; rend celui qui apparaît, ou None."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        current = text()
        for marker in markers:
            if marker in current:
                events.append({"at": round(time.time(), 3), "seen": note, "marker": marker})
                return marker
        if not pump(1):
            return None
    events.append({"at": round(time.time(), 3), "timeout": note, "markers": markers})
    return None


ok = True
dialogue = False
created = False
try:
    if not wait_any(["escape interrupt"], 180, "startup banner"):
        ok = False
    if ok:
        send(campaign.prompt(run), "prompt")
        pump(3)
        send("\r", "submit")
        # Le menu des sortes de Tour apparaît malgré `type=project` : on répond Project Tour
        # (première entrée) comme dans tous les essais.
        first = wait_any(["Which tour should be generated?", "Tour créé", '"tourPath"'],
                         300, "tour creation (or kind menu)")
        if first == "Which tour should be generated?":
            send("\r", "select Project Tour")
            first = wait_any(["Tour créé", '"tourPath"'], 1200, "tour creation")
        created = first in ("Tour créé", '"tourPath"')
        ok = created
    if ok:
        # Le dialogue d'ouverture n'apparaît que si l'extension attribue la création à cet
        # essai ; son absence est un résultat enregistré, pas une panne. On l'annule : le Tour
        # est archivé par la campagne, ouvrir un lecteur ne mesurerait rien de plus.
        dialogue = bool(wait_any(["now?"], 90, "opening dialogue"))
        if dialogue:
            send("\x1b", "cancel opening dialogue")
            pump(2)
    pump(2)
    for attempt in range(3):
        if exited():
            break
        send(b"\x04" if attempt == 0 else b"\x03", f"exit ({attempt + 1})")
        pump(4)
    if not exited():
        events.append({"at": round(time.time(), 3), "interrupted": "ctrl+d did not exit"})
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
finally:
    deadline = time.time() + 30
    while not exited():
        if time.time() > deadline:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            events.append({"at": round(time.time(), 3), "killed": "session did not exit"})
            os.waitpid(pid, 0)
            break
        pump(1)
    raw.close()
    (rd / "end.json").write_text(json.dumps(
        {"time": time.time(),
         "exit_code": os.waitstatus_to_exitcode(STATUS["status"] or 0)}))
    (rd / "session.json").write_text(json.dumps(
        {"run": run, "ok": ok, "created": created, "dialogue": bool(dialogue), "events": events},
        indent=1))
