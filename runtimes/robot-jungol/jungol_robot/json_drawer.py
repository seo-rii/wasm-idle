from .drawer import Drawer
import json

class JsonDrawer(Drawer):
    def __init__(self):
        super().__init__()

    def print(self, s):
        print(s)

    def print_dict(self, out_dict):
        self.print(json.dumps(out_dict))
    
    def draw(self, width, height, pieces, walls):
        self.print_dict({
            'task': 'draw_world',
            'width': width,
            'height': height
        })
        for p in pieces.values():
            self.print_dict({
                'task': 'draw_piece',
                **(p.to_dict())
            })
        for w in walls:
            self.print_dict({
                'task': 'draw_wall',
                **(w.to_dict())
            })

    def on_add(self, piece, interaction=False):
        self.print_dict({
            'task': 'draw_piece',
            **(piece.to_dict())
        })

    def on_remove(self, piece_id, interaction=False):
        self.print_dict({
            'task': 'remove_piece',
            'piece_id': piece_id
        })

    def on_move(self, piece, interaction=False):
        self.print_dict({
            'task': 'move_piece',
            **(piece.to_dict())
        })

    def on_rotate(self, piece, interaction=False):
        self.print_dict({
            'task': 'rotate_piece',
            **(piece.to_dict())
        })
