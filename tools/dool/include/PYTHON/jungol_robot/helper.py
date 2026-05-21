import json

from .direction import Direction
from .drawer import Drawer
from .piece import Piece
from .position import Position
from .robot import Robot as GeneralRobot
from .wall import Wall
from .world import World, load_world_from_save


def create_world(**kwargs):
    global __robots__
    __robots__ = {}
    __robots__['world'] = World(**kwargs)


def load_world(file_path, drawer=None, logger=None, log_realtime=False):
    global __robots__
    with open(file_path, 'r') as world_file:
        world_save = json.loads(world_file.read())
    __robots__ = {}
    __robots__['world'] = load_world_from_save(
        world_save,
        drawer=drawer,
        logger=logger,
        log_realtime=log_realtime
    )


class Robot(GeneralRobot):
    def __init__(self, **kwargs):
        global __robots__
        super().__init__(**kwargs)
        __robots__['world'].add_piece(self)


__all__ = [
    'create_world',
    'load_world',
    'Robot',
    'Direction',
    'Drawer',
    'Piece',
    'Position',
    'World',
    'Wall'
]
