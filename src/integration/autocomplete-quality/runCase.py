"""Execute reviewed Python fixtures in an isolated process, never the editor Host.

The audit guard limits accidental I/O; this is not a hostile-code security sandbox.
The parent enforces a deadline and output limit. Python has no static type gate here.
"""
import ast
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import sys
import traceback
import unittest


def syntax(code, filename):
    try:
        compile(code, filename, "exec")
        return {"compiled": True, "diagnostics": []}
    except (SyntaxError, ValueError) as error:
        return {"compiled": False, "diagnostics": [{
            "message": str(error), "line": getattr(error, "lineno", None),
            "code": type(error).__name__, "file": filename,
        }]}


if sys.argv[1] == "--syntax":
    value = json.load(sys.stdin)
    print(json.dumps(syntax(value["code"], value["filename"])))
    sys.exit(0)

input_file = Path(sys.argv[1]).resolve()
root = input_file.parent
value = json.loads(input_file.read_text(encoding="utf-8"))
diagnostics = []
for filename in value["sourceFiles"]:
    diagnostics.extend(syntax(Path(filename).read_text(encoding="utf-8"), filename)["diagnostics"])
print("DROID_QUALITY_SYNTAX " + json.dumps({"compiled": not diagnostics, "diagnostics": diagnostics}), flush=True)
if diagnostics:
    sys.exit(0)

# Windows asyncio creates a private socket pair for its wake-up mechanism.
# Permit only the standard loop constructor, before any candidate callbacks run.
policy = asyncio.get_event_loop_policy()
create_loop = policy.new_event_loop
creating_loop = False


def new_event_loop():
    global creating_loop
    creating_loop = True
    try:
        return create_loop()
    finally:
        creating_loop = False


policy.new_event_loop = new_event_loop


def audit(event, args):
    if event == "open":
        filename, mode, flags = args
        if isinstance(filename, int):
            raise PermissionError("Fixture cannot open file descriptors")
        target = Path(filename).resolve()
        if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND):
            raise PermissionError("Fixture cannot write files")
        if not (target.is_relative_to(root) or target.is_relative_to(Path(sys.base_prefix).resolve())):
            raise PermissionError("Fixture cannot read outside its sources or Python runtime")
    network = event in {"socket.connect", "socket.bind", "socket.getaddrinfo", "socket.sendto"}
    if (network and not creating_loop) or event.startswith(("subprocess.", "ctypes.", "os.exec", "os.spawn")) or event in {
        "os.system", "os.remove", "os.rename", "os.mkdir", "os.rmdir", "os.chdir",
    }:
        raise PermissionError("Fixture cannot use external I/O: " + event)


sys.addaudithook(audit)
sys.path.insert(0, str(root))


class Checks(unittest.TestCase):
    assertions = 0

    def __getattribute__(self, name):
        member = super().__getattribute__(name)
        if name.startswith("assert") and callable(member):
            def counted(*args, **kwargs):
                self.assertions += 1
                return member(*args, **kwargs)
            return counted
        return member


for test in value["tests"]:
    check = Checks()
    passed, error = False, None
    try:
        for name, module in list(sys.modules.items()):
            filename = getattr(module, "__file__", None)
            if filename and Path(filename).resolve().is_relative_to(root):
                del sys.modules[name]
        spec = importlib.util.spec_from_file_location("main", root / value["entry"])
        subject = importlib.util.module_from_spec(spec)
        sys.modules["main"] = subject
        spec.loader.exec_module(subject)
        exec(compile(ast.parse(test["body"]), "<hidden-test>", "exec"),
             {"subject": subject, "check": check, "asyncio": asyncio})
        if not check.assertions:
            raise AssertionError("Test made no assertions")
        passed = True
    except Exception:
        error = traceback.format_exc(limit=8)[-4000:]
    print("DROID_QUALITY_RESULT " + json.dumps({"name": test["name"], "passed": passed,
          "assertions": check.assertions, "error": error}), flush=True)
