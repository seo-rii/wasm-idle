from .agent import Agent
from .beeper import Beeper
from .direction import Direction, load_direction_from_save
from .position import Position, load_position_from_save, normalize_position

DEFAULT_PAUSE_DURATION = 0.5

def load_robot_from_save(robot_save):
    return Robot(
        position=load_position_from_save(robot_save['position']),
        direction=load_direction_from_save(robot_save['direction']),
        beepers=robot_save['beepers'],
        pause=robot_save['pause'],
        trace=robot_save['trace']
    )

class RobotException(Exception):
    pass

class Robot(Agent):
    def __init__(self, position=None, direction=None, beepers=0, pause=None, trace=None):
        super().__init__(position=position, direction=direction, trace=trace)
        self.pause_duration = DEFAULT_PAUSE_DURATION if pause is None else pause
        self.beepers = []
        for _ in range(beepers):
            self.beepers.append(Beeper())
        self.agent_type = 'robot'

    def _is_adjacent_position_clear(self, position):
        pos = normalize_position(position)
        is_front_in_world = self.world.is_in_world(pos)
        is_no_wall_front = not self.world.is_wall_between(self.position, pos)
        return is_front_in_world and is_no_wall_front

    def to_save(self):
        return {
            'type': 'robot',
            'piece_type': 'agent',
            'position': self.position.to_save(),
            'direction': self.direction.to_save(),
            'beepers': len(self.beepers),
            'pause': self.pause_duration,
            'trace': self.trace_color
        }

    def set_pause(self, duration):
        self.pause_duration = duration
        self._log_action('set_pause', duration=duration, status='ignored')

    def move(self):
        before = self.position.clone()
        after_position = self.position + self.direction.get_delta()
        try:
            if not self.world.is_in_world(after_position):
                raise RobotException('Cannot move! I cannot go out of the world!')
            if self.world.is_wall_between(self.position, after_position):
                raise RobotException('Cannot move! There is a wall in front of me!')
            self.position = after_position
            if self.world:
                with self.world.interaction():
                    self.world.on_move(self)
            self._log_action(
                'move',
                before=before.to_list(),
                after=after_position.to_list(),
                direction=self.direction.to_char()
            )
        except RobotException as e:
            self._log_action(
                'move',
                status='error',
                before=before.to_list(),
                after=after_position.to_list(),
                direction=self.direction.to_char(),
                error=str(e)
            )
            raise

    def turn_left(self):
        before = self.direction.to_char()
        self.direction = self.direction.get_next()
        if self.world:
            with self.world.interaction():
                self.world.on_rotate(self)
        self._log_action('turn_left', before=before, after=self.direction.to_char())

    def is_front_clear(self):
        result = self._is_adjacent_position_clear(self.position + self.direction.get_delta())
        self._log_query('is_front_clear', result=result)
        return result

    def is_left_clear(self):
        result = self._is_adjacent_position_clear(self.position + self.direction.get_next().get_delta())
        self._log_query('is_left_clear', result=result)
        return result

    def is_right_clear(self):
        result = self._is_adjacent_position_clear(self.position + self.direction.get_prev().get_delta())
        self._log_query('is_right_clear', result=result)
        return result

    def is_facing_up(self):
        result = self.direction == 'u'
        self._log_query('is_facing_up', result=result)
        return result

    def has_beepers(self):
        result = bool(self.beepers)
        self._log_query('has_beepers', result=result)
        return result

    def is_on_beepers(self):
        result = self.world.is_beeper(self.position)
        self._log_query('is_on_beepers', result=result)
        return result

    def pick_beeper(self):
        beeper = self.world.get_beeper(self.position)
        if beeper is None:
            self._log_action('pick_beeper', status='error', error='no_beeper')
            raise RobotException('There is no beeper to pick up!')
        with self.world.interaction():
            self.world.remove_piece(beeper.id)
        self.beepers.append(beeper)
        self._log_action('pick_beeper', beepers=len(self.beepers))

    def drop_beeper(self):
        if not self.beepers:
            self._log_action('drop_beeper', status='error', error='empty')
            raise RobotException('I have no beeper to drop!')
        beeper = self.beepers.pop()
        beeper.set_position(self.position.clone())
        with self.world.interaction():
            self.world.add_piece(beeper)
        self._log_action('drop_beeper', beepers=len(self.beepers))

    def _log_action(self, action, status='ok', **payload):
        logger = getattr(self.world, 'logger', None)
        if logger:
            payload.setdefault('position', self.position.to_list())
            if hasattr(self, 'direction'):
                payload.setdefault('direction', self.direction.to_char())
            logger.log_action(action, status=status, **payload)

    def _log_query(self, query, result=None, **payload):
        logger = getattr(self.world, 'logger', None)
        if logger:
            payload.setdefault('position', self.position.to_list())
            if hasattr(self, 'direction'):
                payload.setdefault('direction', self.direction.to_char())
            logger.log_query(query, result=result, **payload)
