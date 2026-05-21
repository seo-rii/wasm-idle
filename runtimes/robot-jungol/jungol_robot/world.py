from contextlib import contextmanager
import json
import os

from .pillow_drawer import PillowDrawer
from .logger import ActionLogger
from .wall import Wall, load_wall_from_save
from .position import normalize_position
from .beeper import Beeper
from .piece import load_piece_from_save

DEFAULT_WIDTH = 10
DEFAULT_HEIGHT = 10
ENV_WORLD_SAVE = 'ROBOT_WORLD_SAVE'

def load_world_from_save(world_save, drawer=None, logger=None, log_realtime=False):
    return World(
        width=world_save['width'],
        height=world_save['height'],
        pieces={k: load_piece_from_save(p) for k, p in world_save['pieces'].items()},
        walls=[load_wall_from_save(w) for w in world_save['walls']],
        drawer=drawer,
        logger=logger,
        log_realtime=log_realtime
    )


def _load_world_save_from_env():
    path = os.environ.get(ENV_WORLD_SAVE)
    if not path:
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None

class World(object):
    def __init__(self, width=DEFAULT_WIDTH, height=DEFAULT_HEIGHT, pieces=None, walls=None, drawer=None, logger=None, log_realtime=False):
        world_save = _load_world_save_from_env()
        if (
            world_save
            and pieces is None
            and walls is None
            and width == DEFAULT_WIDTH
            and height == DEFAULT_HEIGHT
        ):
            width = world_save.get('width', width)
            height = world_save.get('height', height)
            raw_pieces = world_save.get('pieces') or {}
            if isinstance(raw_pieces, dict):
                pieces = {k: load_piece_from_save(p) for k, p in raw_pieces.items()}
            elif isinstance(raw_pieces, list):
                pieces = {str(i): load_piece_from_save(p) for i, p in enumerate(raw_pieces)}
            else:
                pieces = {}
            raw_walls = world_save.get('walls') or []
            if isinstance(raw_walls, list):
                walls = [load_wall_from_save(w) for w in raw_walls]
            else:
                walls = []
        self.width = width
        self.height = height
        self.pieces = {} if pieces is None else pieces
        self.walls = [] if walls is None else walls
        self._interaction_depth = 0
        if logger is False:
            self.logger = None
        elif logger is None:
            self.logger = ActionLogger(realtime=log_realtime)
        else:
            self.logger = logger
        self.drawer = PillowDrawer(logger=self.logger) if drawer is None else drawer
        self.drawer.set_world(self)
        if hasattr(self.drawer, 'set_logger'):
            self.drawer.set_logger(self.logger)
        self.drawer.draw(width, height, self.pieces, self.walls)
        self._log_state('world_init', width=width, height=height)

    @contextmanager
    def interaction(self):
        self._interaction_depth += 1
        try:
            yield
        finally:
            self._interaction_depth = max(0, self._interaction_depth - 1)

    def _is_interaction(self):
        return self._interaction_depth > 0

    def to_save(self):
        return {
            'type': 'world',
            'width': self.width,
            'height': self.height,
            'pieces': {k: p.to_save() for k, p in self.pieces.items()},
            'walls': [w.to_save() for w in self.walls]
        }

    def add_piece(self, piece):
        piece.id = len(self.pieces)
        piece.world = self
        self.pieces[piece.id] = piece
        self.drawer.on_add(piece, interaction=self._is_interaction())
        self._log_state('add_piece', piece_id=piece.id, piece_type=piece.piece_type)

    def remove_piece(self, piece_id):
        if piece_id not in self.pieces:
            return
        piece = self.pieces[piece_id]
        piece.id = None
        piece.world = None
        del self.pieces[piece_id]
        self.drawer.on_remove(piece_id, interaction=self._is_interaction())
        self._log_state('remove_piece', piece_id=piece_id, piece_type=piece.piece_type)

    def is_in_world(self, position):
        pos = normalize_position(position)
        return 0 <= pos.x < self.width and 0 <= pos.y < self.height

    def is_wall_between(self, position_1, position_2):
        wall = Wall(position_1, position_2)
        return wall in self.walls

    def is_beeper(self, position):
        return self.get_beeper(position) is not None

    def get_beeper(self, position):
        for piece in self.pieces.values():
            if isinstance(piece, Beeper) and piece.position == position:
                return piece
        return None

    def on_move(self, piece):
        self.drawer.on_move(piece, interaction=self._is_interaction())
        self._log_state('move_piece', piece_id=piece.id, piece_type=piece.piece_type)

    def on_rotate(self, piece):
        self.drawer.on_rotate(piece, interaction=self._is_interaction())
        self._log_state('rotate_piece', piece_id=piece.id, piece_type=piece.piece_type)

    def _log_state(self, event, **payload):
        if self.logger:
            self.logger.log_state(event, **payload)

    def get_logs(self):
        if not self.logger:
            return []
        return self.logger.get_events()

    def set_log_realtime(self, enable=True):
        if self.logger:
            self.logger.set_realtime(enable)
