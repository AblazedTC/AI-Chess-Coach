import time
from collections import OrderedDict
from collections.abc import Callable


class Cache[K, V]:
    """Bounded monotonic TTL/LRU cache; callers own mutable values."""

    def __init__(
        self, capacity: int, ttl: float, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.capacity = capacity
        self.ttl = ttl
        self.clock = clock
        self._values: OrderedDict[K, tuple[float, V]] = OrderedDict()

    def get(self, key: K) -> V | None:
        item = self._values.get(key)
        if item is None:
            return None
        expires, value = item
        if self.clock() >= expires:
            del self._values[key]
            return None
        self._values.move_to_end(key)
        return value

    def put(self, key: K, value: V) -> None:
        now = self.clock()
        for old in [k for k, (expires, _) in self._values.items() if expires <= now]:
            del self._values[old]
        self._values[key] = (now + self.ttl, value)
        self._values.move_to_end(key)
        while len(self._values) > self.capacity:
            self._values.popitem(last=False)

    def __len__(self) -> int:
        return len(self._values)
