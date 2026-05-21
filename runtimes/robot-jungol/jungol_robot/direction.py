from .position import Position

def load_direction_from_save(direction_save):
    return Direction(direction_save['direction'])


def normalize_direction(value, default=None):
    if value is None:
        return default
    if isinstance(value, Direction):
        return value
    if isinstance(value, str):
        if not value:
            raise TypeError('Invalid direction')
        return Direction(value)
    if hasattr(value, 'direction'):
        return Direction(getattr(value, 'direction'))
    raise TypeError('Invalid direction')

class Direction(object):
    def __init__(self, direction):
        if isinstance(direction, Direction):
            direction = direction.direction
        if not isinstance(direction, str):
            raise TypeError('Unknown direction')
        self.direction = direction.lower()[0]
        if self.direction not in 'lrud':
            raise Exception('Unknown direction')

    def __str__(self):
        direction_dict = {
            'l': 'Left',
            'r': 'Right',
            'u': 'Up',
            'd': 'Down'
        }
        return direction_dict[self.direction]

    def __eq__(self, other):
        try:
            other_dir = normalize_direction(other, default=None)
        except Exception:
            return False
        if other_dir is None:
            return False
        return self.direction == other_dir.direction
    
    def __ne__(self, other):
        return not self == other

    def to_char(self):
        return self.direction

    def to_save(self):
        return { 
            'type': 'direction', 
            'direction': self.direction 
        }

    def get_delta(self):
        if self.direction == 'l':
            return Position(-1, 0)
        elif self.direction == 'r':
            return Position(1, 0)
        elif self.direction == 'u':
            return Position(0, 1)
        elif self.direction == 'd':
            return Position(0, -1)

    def get_next(self):
        directions = 'ldru'
        return Direction(directions[(directions.index(self.direction) + 1) % 4])

    def get_prev(self):
        directions = 'ldru'
        return Direction(directions[(directions.index(self.direction) - 1) % 4])
            
