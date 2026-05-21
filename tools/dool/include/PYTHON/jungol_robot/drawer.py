class Drawer(object):
    def __init__(self):
        pass

    def set_world(self, world):
        self.world = world

    def draw(self, width, height, pieces, walls):
        raise NotImplementedError('draw method is not implemented.')

    def on_add(self, piece, interaction=False):
        raise NotImplementedError('on_add method is not implemented.')

    def on_remove(self, piece_id, interaction=False):
        raise NotImplementedError('on_remove method is not implemented.')

    def on_move(self, piece, interaction=False):
        raise NotImplementedError('on_move method is not implemented.')

    def on_rotate(self, piece, interaction=False):
        raise NotImplementedError('on_rotate method is not implemented.')
