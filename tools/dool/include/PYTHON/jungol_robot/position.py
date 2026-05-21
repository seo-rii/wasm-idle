def load_position_from_save(position_save):
    return Position(position_save['x'], position_save['y'])


def normalize_position(value, default=None):
    if value is None:
        return default
    if isinstance(value, Position):
        return value
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return Position(value[0], value[1])
    if isinstance(value, dict) and 'x' in value and 'y' in value:
        return Position(value['x'], value['y'])
    if hasattr(value, 'x') and hasattr(value, 'y'):
        return Position(value.x, value.y)
    raise TypeError('Invalid position')

class Position(object):
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __eq__(self, other):
        try:
            other_pos = normalize_position(other, default=None)
        except Exception:
            return False
        if other_pos is None:
            return False
        return self.x == other_pos.x and self.y == other_pos.y

    def __ne__(self, other):
        return not self == other

    def __add__(self, other):
        try:
            other_pos = normalize_position(other, default=None)
        except Exception:
            return NotImplemented
        if other_pos is None:
            return NotImplemented
        return Position(self.x + other_pos.x, self.y + other_pos.y)

    def clone(self):
        return Position(self.x, self.y)

    def to_list(self):
        return [self.x, self.y]

    def to_save(self):
        return { 
            'type': 'position', 
            'x': self.x, 
            'y': self.y 
        }
