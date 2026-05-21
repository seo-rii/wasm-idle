import glob
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from robot import World, Robot, Beeper, ActionLogger
import jungol_robot.image_output as image_output

try:
    from robot import PillowDrawer
    _PIL_ERROR = None
except Exception as exc:
    PillowDrawer = None
    _PIL_ERROR = exc


class JungolRobotTests(unittest.TestCase):
    def setUp(self):
        if PillowDrawer is None:
            self.skipTest(f'Pillow not available: {_PIL_ERROR}')
        self.logger = ActionLogger(realtime=False)
        self.drawer = PillowDrawer(capture_frames=False, emit_images=False)
        self.world = World(width=3, height=3, drawer=self.drawer, logger=self.logger)
        self.robot = Robot(position=(0, 0), direction='R', beepers=1)
        self.world.add_piece(self.robot)

    def test_set_pause_is_ignored(self):
        self.robot.set_pause(0.1)
        actions = [
            event
            for event in self.logger.get_events()
            if event.get('type') == 'action' and event.get('action') == 'set_pause'
        ]
        self.assertTrue(actions, 'set_pause should log an action')
        self.assertEqual(actions[-1].get('status'), 'ignored')

    def test_move_updates_position_and_logs(self):
        self.robot.move()
        self.assertEqual((self.robot.position.x, self.robot.position.y), (1, 0))
        actions = [
            event
            for event in self.logger.get_events()
            if event.get('type') == 'action' and event.get('action') == 'move'
        ]
        self.assertTrue(actions, 'move should log an action')
        self.assertEqual(actions[-1].get('status'), 'ok')

    def test_images_emit_only_on_interaction(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.environ['IMG_OUT_DIR'] = tmp
            image_output._OUT_DIR = None
            image_output._LOG_PATH = None
            image_output._SEQ = 0

            drawer = PillowDrawer(capture_frames=False, emit_images=True)
            world = World(width=2, height=2, drawer=drawer, logger=False)
            robot = Robot(position=(0, 0), direction='R')
            world.add_piece(robot)

            def list_images():
                return glob.glob(os.path.join(tmp, 'img_*.json'))

            before = list_images()
            robot.set_trace('blue')
            after_trace = list_images()
            self.assertEqual(len(after_trace), len(before))

            robot.move()
            after_move = list_images()
            self.assertGreater(len(after_move), len(after_trace))
            self.assertTrue(os.path.isfile(os.path.join(tmp, 'images.jsonl')))


if __name__ == '__main__':
    unittest.main()
