from jungol_robot import (
    ActionLogger,
    Beeper,
    Drawer,
    JsonDrawer,
    PillowDrawer,
    Piece,
    Position,
    Direction,
    Wall,
    create_world,
    load_world,
)
from jungol_robot import World as _World
from jungol_robot import Robot as _Robot

DEFAULT_WIDTH = 10
DEFAULT_HEIGHT = 10


class World(_World):
    def __init__(self, width=DEFAULT_WIDTH, height=DEFAULT_HEIGHT, *args, **kwargs):
        super().__init__(width=width, height=height, *args, **kwargs)


class Robot(_Robot):
    def __init__(self, position=(0, 0), direction='R', *args, **kwargs):
        super().__init__(position=position, direction=direction, *args, **kwargs)


__all__ = [
    'ActionLogger',
    'Beeper',
    'Drawer',
    'JsonDrawer',
    'PillowDrawer',
    'Piece',
    'Position',
    'Direction',
    'Robot',
    'Wall',
    'World',
    'create_world',
    'load_world',
]
