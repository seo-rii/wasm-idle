import json
import os
import runpy
import sys
from contextlib import contextmanager

from . import logger as logger_mod
from . import world as world_mod


DEFAULT_PREFIX = '__ROBOTLOG__'
ENV_WORLD_SAVE = 'ROBOT_WORLD_SAVE'


class ActionLogCapture:
    def __init__(self):
        self.events = []
        self._original_log = None
        self._patched = False

    def _install(self):
        if self._patched:
            return
        self._original_log = logger_mod.ActionLogger.log

        def _capturing_log(logger, event_type, **payload):
            event = self._original_log(logger, event_type, **payload)
            self.events.append(event)
            return event

        logger_mod.ActionLogger.log = _capturing_log
        world_mod.ActionLogger = logger_mod.ActionLogger
        self._patched = True

    def _restore(self):
        if self._patched and self._original_log:
            logger_mod.ActionLogger.log = self._original_log
        self._patched = False

    def __enter__(self):
        self._install()
        return self

    def __exit__(self, exc_type, exc, tb):
        self._restore()


def collect_actions(events):
    return [
        event
        for event in events
        if isinstance(event, dict) and event.get('type') == 'action'
    ]


def emit_actions(actions, prefix=DEFAULT_PREFIX, stdout=None):
    out = stdout or sys.stdout
    payload = {'actions': actions}
    try:
        text = json.dumps(payload, ensure_ascii=True)
    except Exception:
        text = '{}'
    out.write(prefix + text + '\n')

@contextmanager
def world_config(path=None):
    prev = os.environ.get(ENV_WORLD_SAVE)
    if path:
        os.environ[ENV_WORLD_SAVE] = path
    else:
        os.environ.pop(ENV_WORLD_SAVE, None)
    try:
        yield
    finally:
        if prev is None:
            os.environ.pop(ENV_WORLD_SAVE, None)
        else:
            os.environ[ENV_WORLD_SAVE] = prev


def set_world_save(path):
    os.environ[ENV_WORLD_SAVE] = path


def run_robot_judge(path=None, base_dir=None, filename='User.py', prefix=DEFAULT_PREFIX, world_file=None, world_path=None):
    if path is None:
        base_dir = os.getcwd() if base_dir is None else base_dir
        path = os.path.join(base_dir, filename)
    if not os.path.exists(path):
        raise FileNotFoundError(f'{filename} is required')

    capture = ActionLogCapture()
    if world_path is None and world_file:
        base_dir = os.path.dirname(path) if base_dir is None else base_dir
        world_path = os.path.join(base_dir, world_file)
    with world_config(world_path), capture:
        try:
            runpy.run_path(path, run_name='__main__')
        finally:
            emit_actions(collect_actions(capture.events), prefix=prefix)


def extract_actions_from_output(text, prefix=DEFAULT_PREFIX):
    payload = None
    for line in text.splitlines():
        if line.startswith(prefix):
            payload = line[len(prefix):].strip()
    if not payload:
        raise ValueError('log not found')
    data = json.loads(payload)
    return data.get('actions') or []


def parse_expected_state(text):
    tokens = text.strip().split()
    if len(tokens) < 3:
        raise ValueError('expected output missing')
    x = int(tokens[0])
    y = int(tokens[1])
    d = tokens[2].strip().upper()[0]
    return x, y, d


def _turn_left_dir(direction):
    order = ['L', 'D', 'R', 'U']
    if direction not in order:
        return direction
    return order[(order.index(direction) + 1) % 4]


def _move_delta(direction):
    if direction == 'L':
        return -1, 0
    if direction == 'R':
        return 1, 0
    if direction == 'U':
        return 0, 1
    if direction == 'D':
        return 0, -1
    return 0, 0


def simulate_robot(actions, start=(0, 0), direction='R', strict=True):
    x, y = start
    d = direction.strip().upper()[0] if direction else 'R'

    for event in actions:
        if not isinstance(event, dict):
            continue
        if event.get('type') != 'action':
            continue
        if strict and event.get('status') not in (None, 'ok'):
            raise ValueError('action error')

        action = event.get('action')
        if action == 'move':
            after = event.get('after')
            if isinstance(after, list) and len(after) == 2:
                try:
                    x, y = int(after[0]), int(after[1])
                except Exception:
                    pass
            else:
                dx, dy = _move_delta(d)
                x += dx
                y += dy
            dir_val = event.get('direction')
            if isinstance(dir_val, str) and dir_val:
                d = dir_val.strip().upper()[0]
        elif action == 'turn_left':
            after = event.get('after')
            if isinstance(after, str) and after:
                d = after.strip().upper()[0]
            else:
                d = _turn_left_dir(d)

    return x, y, d


__all__ = [
    'ActionLogCapture',
    'DEFAULT_PREFIX',
    'ENV_WORLD_SAVE',
    'collect_actions',
    'emit_actions',
    'extract_actions_from_output',
    'parse_expected_state',
    'run_robot_judge',
    'simulate_robot',
    'set_world_save',
    'world_config',
]
