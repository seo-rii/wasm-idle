import io

from PIL import Image, ImageDraw, ImageFont

from .assets import get_beeper_image, get_robot_image
from .drawer import Drawer
from .image_output import emit_image

RESAMPLE = Image.Resampling.LANCZOS if hasattr(Image, 'Resampling') else Image.LANCZOS


class PillowDrawer(Drawer):
    def __init__(
        self,
        cell_size=64,
        padding=12,
        background='#ffffff',
        grid='#dddddd',
        wall='#666666',
        border='#666666',
        trace_width=3,
        capture_frames=True,
        on_frame=None,
        emit_images=True,
        image_format='PNG',
        logger=None
    ):
        super().__init__()
        self.cell_size = int(cell_size)
        self.padding = int(padding)
        self.background = background
        self.grid = grid
        self.wall = wall
        self.border = border
        self.trace_width = int(trace_width)
        self.capture_frames = bool(capture_frames)
        self.on_frame = on_frame
        self.emit_images = bool(emit_images)
        self.image_format = image_format
        self.logger = logger

        self.width = 0
        self.height = 0
        self.walls = []
        self.pieces = {}
        self.frames = []
        self.last_image = None
        self._frame_index = 0
        self._positions = {}
        self._directions = {}
        self._traces = []
        self._sprite_cache = {}
        self._font = ImageFont.load_default()

    def set_logger(self, logger):
        self.logger = logger

    def draw(self, width, height, pieces, walls):
        self.width = int(width)
        self.height = int(height)
        self.pieces = dict(pieces)
        self.walls = list(walls)
        self._positions = {
            pid: (piece.position.x, piece.position.y) for pid, piece in self.pieces.items()
        }
        self._directions = {
            pid: (piece.direction.to_char() if hasattr(piece, 'direction') else 'r')
            for pid, piece in self.pieces.items()
        }
        self._emit_frame('draw')

    def on_add(self, piece, interaction=False):
        if piece is None:
            return
        self.pieces[piece.id] = piece
        self._positions[piece.id] = (piece.position.x, piece.position.y)
        if hasattr(piece, 'direction'):
            self._directions[piece.id] = piece.direction.to_char()
        self._emit_frame('add', interaction=interaction, piece_id=piece.id)

    def on_remove(self, piece_id, interaction=False):
        if piece_id in self.pieces:
            del self.pieces[piece_id]
        if piece_id in self._positions:
            del self._positions[piece_id]
        if piece_id in self._directions:
            del self._directions[piece_id]
        self._emit_frame('remove', interaction=interaction, piece_id=piece_id)

    def on_move(self, piece, interaction=False):
        if piece is None:
            return
        before = self._positions.get(piece.id)
        after = (piece.position.x, piece.position.y)
        if before and before != after:
            self._add_move_trace(piece, before, after)
        self._positions[piece.id] = after
        self._emit_frame('move', interaction=interaction, piece_id=piece.id)

    def on_rotate(self, piece, interaction=False):
        if piece is None or not hasattr(piece, 'direction'):
            return
        before = self._directions.get(piece.id)
        after = piece.direction.to_char()
        if before and before != after:
            self._add_rotate_trace(piece, before, after)
        self._directions[piece.id] = after
        self._emit_frame('rotate', interaction=interaction, piece_id=piece.id)

    def _emit_frame(self, reason, interaction=False, **payload):
        image = self.render_image()
        self.last_image = image
        frame_bytes = None
        if image is not None:
            frame_bytes = self._encode(image)
            if self.capture_frames:
                self.frames.append(frame_bytes)
        if self.on_frame:
            self.on_frame(frame_bytes, {'index': self._frame_index, 'reason': reason, **payload})
        if self.emit_images and frame_bytes and interaction:
            emit_image(frame_bytes, self._mime_type())
        if self.logger:
            self.logger.log_state('frame', index=self._frame_index, reason=reason, **payload)
        self._frame_index += 1

    def _mime_type(self):
        fmt = (self.image_format or 'PNG').strip().lower()
        if fmt in ('jpg', 'jpeg'):
            return 'image/jpeg'
        if fmt == 'webp':
            return 'image/webp'
        return 'image/png'

    def _encode(self, image):
        buf = io.BytesIO()
        image.save(buf, format=self.image_format)
        return buf.getvalue()

    def render_image(self):
        if self.width <= 0 or self.height <= 0:
            return None
        image = Image.new('RGBA', self._image_size(), self.background)
        draw = ImageDraw.Draw(image)
        self._draw_grid(draw)
        self._draw_walls(draw)
        self._draw_traces(draw)
        self._draw_markers(image, draw)
        self._draw_agents(image, draw)
        self._draw_border(draw)
        return image

    def _image_size(self):
        return (
            self.padding * 2 + self.width * self.cell_size,
            self.padding * 2 + self.height * self.cell_size
        )

    def _cell_top_left(self, x, y):
        return (
            self.padding + x * self.cell_size,
            self.padding + (self.height - y - 1) * self.cell_size
        )

    def _cell_center(self, x, y):
        tlx, tly = self._cell_top_left(x, y)
        return (tlx + self.cell_size / 2, tly + self.cell_size / 2)

    def _draw_border(self, draw):
        left = self.padding
        top = self.padding
        right = left + self.width * self.cell_size
        bottom = top + self.height * self.cell_size
        draw.rectangle([left, top, right, bottom], outline=self.border, width=4)

    def _draw_grid(self, draw):
        left = self.padding
        top = self.padding
        right = left + self.width * self.cell_size
        bottom = top + self.height * self.cell_size
        for x in range(self.width + 1):
            x_pos = left + x * self.cell_size
            draw.line([(x_pos, top), (x_pos, bottom)], fill=self.grid, width=1)
        for y in range(self.height + 1):
            y_pos = top + y * self.cell_size
            draw.line([(left, y_pos), (right, y_pos)], fill=self.grid, width=1)

    def _draw_walls(self, draw):
        thickness = 4
        for wall in self.walls:
            x1 = wall.position_1.x
            y1 = wall.position_1.y
            x2 = wall.position_2.x
            y2 = wall.position_2.y
            if x1 == x2 and abs(y1 - y2) == 1:
                x = x1
                y = max(y1, y2)
                start_x = self.padding + x * self.cell_size
                start_y = self.padding + (self.height - y) * self.cell_size
                draw.rectangle(
                    [start_x, start_y - thickness / 2,
                     start_x + self.cell_size, start_y + thickness / 2],
                    fill=self.wall
                )
            elif y1 == y2 and abs(x1 - x2) == 1:
                x = max(x1, x2)
                y = y1
                start_x = self.padding + x * self.cell_size
                start_y = self.padding + (self.height - y - 1) * self.cell_size
                draw.rectangle(
                    [start_x - thickness / 2, start_y,
                     start_x + thickness / 2, start_y + self.cell_size],
                    fill=self.wall
                )

    def _add_move_trace(self, piece, before, after):
        color = getattr(piece, 'trace_color', None) or '#000000'
        self._traces.append({'type': 'move', 'from': before, 'to': after, 'color': color})

    def _add_rotate_trace(self, piece, before, after):
        color = getattr(piece, 'trace_color', None) or '#000000'
        self._traces.append({'type': 'rotate', 'pos': (piece.position.x, piece.position.y), 'color': color})

    def _draw_traces(self, draw):
        for trace in self._traces:
            if trace['type'] == 'move':
                fx, fy = trace['from']
                tx, ty = trace['to']
                start = self._cell_center(fx, fy)
                end = self._cell_center(tx, ty)
                draw.line([start, end], fill=trace['color'], width=self.trace_width)
            elif trace['type'] == 'rotate':
                cx, cy = self._cell_center(*trace['pos'])
                r = self.cell_size * 0.15
                draw.ellipse(
                    [cx - r, cy - r, cx + r, cy + r],
                    outline=trace['color'],
                    width=max(1, self.trace_width - 1)
                )

    def _draw_markers(self, image, draw):
        counts = {}
        for piece in self.pieces.values():
            if getattr(piece, 'piece_type', '') != 'marker':
                continue
            key = (piece.position.x, piece.position.y)
            counts[key] = counts.get(key, 0) + 1

        if not counts:
            return

        sprite = self._get_sprite('beeper', None)
        for (x, y), count in counts.items():
            center = self._cell_center(x, y)
            self._paste_sprite(image, sprite, center)
            if count > 1:
                self._draw_label(draw, str(count), center)

    def _draw_agents(self, image, draw):
        for piece in self.pieces.values():
            if getattr(piece, 'piece_type', '') != 'agent':
                continue
            agent_type = getattr(piece, 'agent_type', 'agent')
            x, y = piece.position.x, piece.position.y
            center = self._cell_center(x, y)
            if agent_type == 'robot':
                direction = piece.direction.to_char() if hasattr(piece, 'direction') else 'r'
                sprite = self._get_sprite('robot', direction)
                self._paste_sprite(image, sprite, center)
            else:
                r = self.cell_size * 0.25
                draw.ellipse(
                    [center[0] - r, center[1] - r, center[0] + r, center[1] + r],
                    fill='#888888',
                    outline='#444444',
                    width=2
                )

    def _draw_label(self, draw, text, center):
        try:
            bbox = draw.textbbox((0, 0), text, font=self._font)
            width = bbox[2] - bbox[0]
            height = bbox[3] - bbox[1]
        except Exception:
            width, height = draw.textsize(text, font=self._font)
        x = center[0] - width / 2
        y = center[1] - height / 2
        draw.text((x, y), text, fill='#000000', font=self._font)

    def _get_sprite(self, kind, direction):
        key = (kind, direction, self.cell_size)
        if key in self._sprite_cache:
            return self._sprite_cache[key]

        if kind == 'robot':
            base = get_robot_image(direction or 'r')
            size = (int(self.cell_size * 0.5), int(self.cell_size * 0.7))
        else:
            base = get_beeper_image()
            size = (int(self.cell_size * 0.7), int(self.cell_size * 0.7))

        sprite = base.resize(size, RESAMPLE)
        self._sprite_cache[key] = sprite
        return sprite

    def _paste_sprite(self, image, sprite, center):
        if sprite is None:
            return
        w, h = sprite.size
        x = int(center[0] - w / 2)
        y = int(center[1] - h / 2)
        image.alpha_composite(sprite, (x, y))

    def get_last_frame(self):
        if self.last_image is None:
            return None
        return self._encode(self.last_image)

    def get_frames(self):
        return list(self.frames)
