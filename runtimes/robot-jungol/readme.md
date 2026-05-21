# jungol-robot

`jungol-robot` provides a grid-world environment for learning Python robot control with Pillow rendering and action logs.

Quick start:

```python
from robot import World, Robot

world = World()
robot = Robot()
world.add_piece(robot)
robot.set_pause(0.5)
robot.set_trace('red')
robot.move()
robot.turn_left()
robot.move()
```

Inspired by `cs1robots` module from cs101 by Otfried Cheong.
