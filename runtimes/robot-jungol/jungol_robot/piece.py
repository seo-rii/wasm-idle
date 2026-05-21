from .position import Position, load_position_from_save, normalize_position
from .direction import Direction

def load_piece_from_save(piece_save):
    from .marker import load_marker_from_save
    from .agent import load_agent_from_save
    if piece_save['piece_type'] == 'marker':
        return load_marker_from_save(piece_save)
    elif piece_save['piece_type'] == 'agent':
        return load_agent_from_save(piece_save)
    else:
        return Piece(position=load_position_from_save(piece_save['position']))

class Piece(object):
    def __init__(self, position=None):
        self.id = None
        self.world = None
        self.piece_type = 'piece'
        self.position = normalize_position(position, default=Position(0, 0))

    def to_dict(self): 
        return {
            'id': self.id,
            'piece_type': self.piece_type,
            'x': self.position.x,
            'y': self.position.y
        }

    def to_save(self):
        return {
            'type': 'piece',
            'position': self.position.to_save()
        }
