from .position import Position, load_position_from_save
from .direction import Direction, load_direction_from_save, normalize_direction
from .piece import Piece

def load_agent_from_save(agent_save):
    from .robot import load_robot_from_save
    if agent_save['type'] == 'robot':
        return load_robot_from_save(agent_save)
    else:
        return Agent(
            position=load_position_from_save(agent_save['position']),
            direction=load_direction_from_save(agent_save['direction']),
            trace=agent_save['trace']
        )

class Agent(Piece):
    def __init__(self, position=None, direction=None, trace=None):
        super().__init__(position=position);
        self.direction = normalize_direction(direction, default=Direction('r'))
        self.piece_type = 'agent'
        self.agent_type = 'marker'
        self.trace_color = trace

    def set_trace(self, color='blue'):
        self.trace_color = color
        logger = getattr(getattr(self, 'world', None), 'logger', None)
        if logger:
            logger.log_action('set_trace', piece_id=self.id, color=color)

    def to_dict(self): 
        return {
            **(super().to_dict()),
            'agent_type': self.agent_type,
            'trace_color': self.trace_color,
            'direction': self.direction.to_char()
        }

    def to_save(self):
        return {
            'type': 'agent',
            'piece_type': 'agent',
            'position': self.position.to_save(),
            'direction': self.direction.to_save(),
            'trace': self.trace_color
        }
