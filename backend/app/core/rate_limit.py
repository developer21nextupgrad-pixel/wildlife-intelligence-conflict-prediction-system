from collections import defaultdict, deque
import time
from threading import Lock

from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response


class SlidingWindowRateLimiter:
    """Thread-safe in-memory sliding-window rate limiter keyed by client IP / bucket.

    Note: In-memory sliding windows operate per worker process. Run Render web service with
    1 Uvicorn worker (default for single-instance Standard/Starter) or set RATE_LIMIT_REDIS_URL
    if scaling across multiple processes/replicas.
    """

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._buckets: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(
        self,
        key: str,
        *,
        max_requests: int | None = None,
        window_seconds: int | None = None,
    ) -> tuple[bool, int, int]:
        limit = max_requests or self.max_requests
        window = window_seconds or self.window_seconds
        now = time.monotonic()
        cutoff = now - window

        with self._lock:
            if len(self._buckets) > 10_000 and key not in self._buckets:
                # Prune stale buckets to bound memory under high-cardinality IP scans
                stale_keys = [
                    k for k, dq in self._buckets.items() if not dq or dq[-1] <= cutoff
                ]
                for stale in stale_keys:
                    del self._buckets[stale]

            bucket = self._buckets[key]
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()

            if len(bucket) >= limit:
                retry_after = max(1, int(window - (now - bucket[0])) + 1)
                return False, 0, retry_after

            bucket.append(now)
            remaining = max(0, limit - len(bucket))
            return True, remaining, 0

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        limiter: SlidingWindowRateLimiter,
        exempt_paths: set[str] | None = None,
        strict_route_limits: dict[str, tuple[int, int]] | None = None,
    ):
        super().__init__(app)
        self.limiter = limiter
        self.exempt_paths = exempt_paths or set()
        self.strict_route_limits = strict_route_limits or {}

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if request.method == "OPTIONS" or request.url.path in self.exempt_paths:
            return await call_next(request)

        forwarded_for = request.headers.get("x-forwarded-for")
        client_ip = (
            forwarded_for.split(",")[0].strip()
            if forwarded_for
            else (request.client.host if request.client else "unknown")
        )

        strict = self.strict_route_limits.get(request.url.path)
        if strict is not None:
            limit_val, window_val = strict
            bucket_key = f"strict:{request.url.path}:{client_ip}"
        else:
            limit_val, window_val = self.limiter.max_requests, self.limiter.window_seconds
            bucket_key = client_ip

        allowed, remaining, retry_after = self.limiter.check(
            bucket_key, max_requests=limit_val, window_seconds=window_val
        )
        if not allowed:
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "error": "rate_limit_exceeded",
                    "detail": f"Rate limit exceeded ({limit_val} requests per {window_val}s).",
                },
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(limit_val),
                    "X-RateLimit-Remaining": "0",
                },
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit_val)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response
