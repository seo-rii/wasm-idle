import json
import time


class ActionLogger:
    def __init__(self, realtime=False, printer=None):
        self.realtime = bool(realtime)
        self.printer = printer or print
        self.events = []

    def log(self, event_type, **payload):
        event = {
            'ts': int(time.time() * 1000),
            'type': event_type,
            **payload
        }
        self.events.append(event)
        if self.realtime and self.printer:
            self.printer(json.dumps(event, ensure_ascii=True))
        return event

    def log_action(self, action, status='ok', **payload):
        return self.log('action', action=action, status=status, **payload)

    def log_query(self, query, result=None, **payload):
        if result is not None:
            payload['result'] = result
        return self.log('query', query=query, **payload)

    def log_state(self, state, **payload):
        return self.log('state', state=state, **payload)

    def get_events(self):
        return list(self.events)

    def clear(self):
        self.events.clear()

    def set_realtime(self, value=True):
        self.realtime = bool(value)
