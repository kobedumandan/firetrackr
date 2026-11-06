"""Bound automatic GPS routing without dropping accepted location history."""
import asyncio
from collections import OrderedDict
import logging
import time


logger = logging.getLogger(__name__)


class LocationRoutingQueue:
    """One calculation at a time, with only the latest waiting fix per responder.

    Scheduling runs on the event loop. Computation uses asyncio's executor,
    separate from the AnyIO worker pool used by synchronous HTTP endpoints.
    Waiting work owns neither a database session nor a worker thread.
    """

    def __init__(self, max_pending=128, max_age=30, clock=time.monotonic):
        self.max_pending = max_pending
        self.max_age = max_age
        self.clock = clock
        self.pending = OrderedDict()
        self.worker = None
        self.accepting = True

    def start(self):
        self.accepting = True

    async def enqueue(self, function, *args):
        if not self.accepting:
            return
        key = args[:2]  # dispatch_id, per_id; never store a request/session here.
        if key not in self.pending and len(self.pending) >= self.max_pending:
            self.pending.popitem(last=False)
            logger.warning('Automatic GPS routing backlog full; discard oldest waiting calculation.')
        # Replacing a fix keeps its place in line so busy responders cannot
        # continually push another responder behind their own updates.
        self.pending[key] = (self.clock(), function, args)
        if self.worker is None or self.worker.done():
            self.worker = asyncio.create_task(self._run())

    async def _run(self):
        while self.pending and self.accepting:
            _, (queued_at, function, args) = self.pending.popitem(last=False)
            if self.clock() - queued_at > self.max_age:
                continue  # A later GPS fix can request a current calculation.
            try:
                await asyncio.to_thread(function, *args)
            except Exception:
                logger.exception('Automatic GPS routing failed (dispatch=%s, personnel=%s).', *args[:2])

    async def close(self):
        self.accepting = False
        self.pending.clear()
        # Let the running calculation finish before lifespan frees the engine.
        if self.worker is not None:
            await self.worker
            self.worker = None


location_routing = LocationRoutingQueue()


async def schedule_location_routing(function, *args):
    await location_routing.enqueue(function, *args)
