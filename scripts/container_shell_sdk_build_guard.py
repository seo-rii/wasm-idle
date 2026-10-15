"""Linux process ownership for one sequential, private SDK build attempt."""

import ctypes
import json
import os
from pathlib import Path
import resource
import signal
import subprocess
import time


STOP = None


def publish(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def enable_cleanup():
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise OSError(ctypes.get_errno(), "PR_SET_CHILD_SUBREAPER failed")

    def request_stop(number, _frame):
        global STOP
        STOP = number

    for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(number, request_stop)


def check_stop():
    if STOP is not None:
        raise RuntimeError(f"supervisor received signal {STOP}")


def resources(path):
    fields = dict(line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())
    disk = os.statvfs(path)
    return {"availableMemoryBytes": int(fields["MemAvailable"].split()[0]) * 1024,
            "freeDiskBytes": disk.f_bavail * disk.f_frsize,
            "loadAverage": list(os.getloadavg()), "checkedAtUnix": time.time()}


def read_process(pid):
    value = Path(f"/proc/{pid}/stat").read_text()
    fields = value[value.rfind(")") + 2:].split()
    return {"pid": pid, "startTicks": int(fields[19]), "state": fields[0],
            "residentSetBytes": int(fields[21]) * os.sysconf("SC_PAGE_SIZE")}


def owned_processes():
    pending, seen, values = [os.getpid()], set(), []
    while pending:
        current = pending.pop()
        if current in seen:
            continue
        seen.add(current)
        try:
            pending.extend(int(x) for x in Path(f"/proc/{current}/task/{current}/children").read_text().split())
            if current != os.getpid():
                values.append(read_process(current))
        except (FileNotFoundError, ProcessLookupError):
            continue
        if len(seen) > 4096:
            raise RuntimeError("owned process traversal limit exceeded")
    return values


def cleanup(child, seconds=10):
    deadline = time.monotonic() + seconds
    signaled, reaped, errors, remaining = [], [], [], []
    while True:
        try:
            remaining = owned_processes()
            for previous in reversed(remaining):
                try:
                    current = read_process(previous["pid"])
                    if current["startTicks"] == previous["startTicks"] and current["state"] != "Z":
                        os.kill(current["pid"], signal.SIGKILL)
                        if len(signaled) < 256:
                            signaled.append({"pid": current["pid"], "startTicks": current["startTicks"]})
                except (FileNotFoundError, ProcessLookupError):
                    pass
            while True:
                try:
                    pid, status = os.waitpid(-1, os.WNOHANG)
                except ChildProcessError:
                    break
                if not pid:
                    break
                code = os.waitstatus_to_exitcode(status)
                if child is not None and pid == child.pid:
                    child.returncode = code
                if len(reaped) < 256:
                    reaped.append({"pid": pid, "exitCode": code})
            remaining = owned_processes()
            if not remaining:
                break
        except Exception as error:
            if len(errors) < 16:
                errors.append(f"{type(error).__name__}: {error}")
        if time.monotonic() >= deadline:
            break
        time.sleep(0.05)
    return {"allReaped": not remaining and not errors, "deadlineSeconds": seconds,
            "remaining": remaining[:256], "signaled": signaled, "reaped": reaped, "errors": errors}


def run_stage(root, stage, environment, working_directory, limits):
    child = None
    started = time.monotonic()
    result = {"argv": stage["argv"], "startedAtUnix": time.time(), "exitCode": None,
              "limitScope": "CPU and address-space limits apply per process; disk admission is sampled; no aggregate RSS guarantee"}
    try:
        check_stop()

        def child_limits():
            resource.setrlimit(resource.RLIMIT_CPU, (limits["cpuSoftSeconds"], limits["cpuHardSeconds"]))
            resource.setrlimit(resource.RLIMIT_AS, (limits["addressSpaceBytes"], limits["addressSpaceBytes"]))
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

        with Path(stage["log"]).open("xb") as log:
            child = subprocess.Popen(stage["argv"], cwd=working_directory, env=environment,
                                     stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                                     preexec_fn=child_limits)
        result["pid"] = child.pid
        publish(Path(root) / "phase.json", {"phase": stage["name"], "pid": os.getpid(), "childPid": child.pid})
        maximum_count, maximum_rss, last_publication = 0, 0, 0
        while child.poll() is None:
            check_stop()
            elapsed = time.monotonic() - started
            if elapsed >= stage["wallSeconds"]:
                result["termination"] = "outer-wall-timeout"
                raise RuntimeError("outer stage wall deadline reached")
            if resources(root)["freeDiskBytes"] < limits["minimumRemainingDiskBytes"]:
                result["termination"] = "disk-headroom-limit"
                raise RuntimeError("private volume disk headroom limit reached")
            processes = owned_processes()
            maximum_count = max(maximum_count, len(processes))
            maximum_rss = max(maximum_rss, sum(x["residentSetBytes"] for x in processes))
            if elapsed - last_publication >= 5:
                publish(Path(root) / (stage["name"] + ".observations.json"), {
                    "scope": "sampled summed RSS may double-count shared pages; not a measured peak or memory limit",
                    "sampledMaximumOwnedProcesses": maximum_count,
                    "sampledMaximumSummedRssBytes": maximum_rss,
                    "elapsedSeconds": round(elapsed, 3)})
                last_publication = elapsed
            time.sleep(0.25)
        result["exitCode"] = child.returncode
        result["termination"] = "exited" if child.returncode >= 0 else "signal"
        check_stop()
    finally:
        result["cleanup"] = cleanup(child)
        if child is not None:
            result["exitCode"] = child.returncode
        result["wallSeconds"] = round(time.monotonic() - started, 3)
        if STOP is not None:
            result["supervisorSignal"] = STOP
            result["termination"] = "supervisor-signal"
        publish(Path(root) / (stage["name"] + ".process.json"), result)
        if not result["cleanup"]["allReaped"]:
            raise RuntimeError("owned child cleanup incomplete")
        if result["exitCode"] == 0 and result["cleanup"]["signaled"]:
            raise RuntimeError("successful stage left running descendants; stopped and rejected")
    if result["exitCode"] != 0:
        raise RuntimeError(f"{stage['name']} exited {result['exitCode']}")
    return result
