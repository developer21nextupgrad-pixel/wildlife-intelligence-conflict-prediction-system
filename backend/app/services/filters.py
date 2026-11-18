from datetime import datetime, timedelta, timezone
import math
from typing import Any

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

DIVISION_KEYWORDS: dict[str, list[str]] = {
    "hediyala range": ["hediyala", "kadambur", "solakarai", "sector 4b"],
    "gundlupet buffer": ["gundlupet", "mangala"],
    "maddur range": ["maddur", "berambadi"],
    "omkar range": ["omkar"],
    "gs betta range": ["gs betta", "gopalaswamy"],
}

DIRECTION_TO_BEARING: dict[str, int] = {
    "North": 0,
    "North-East": 45,
    "East": 90,
    "South-East": 135,
    "South": 180,
    "South-West": 225,
    "West": 270,
    "North-West": 315,
    "Stationary": 0,
}


def resolve_bearing(direction: str, explicit_bearing: int | None) -> int:
    if explicit_bearing is not None:
        return explicit_bearing
    return DIRECTION_TO_BEARING.get(direction, 0)


def apply_division_filter(
    stmt: Select[Any], division: str | None, columns: list[Any]
) -> Select[Any]:
    if not division:
        return stmt
    normalized = division.strip().lower()
    if not normalized or normalized in {"all", "bandipur division"}:
        return stmt

    keywords = DIVISION_KEYWORDS.get(normalized, [normalized])
    clauses = []
    for kw in keywords:
        for col in columns:
            clauses.append(col.ilike(f"%{kw}%"))

    if not clauses:
        return stmt
    return stmt.where(or_(*clauses))


def apply_date_window(
    stmt: Select[Any],
    dt_column: Any,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    date_range: str | None = None,
    now_utc: datetime | None = None,
) -> Select[Any]:
    if date_from is not None:
        stmt = stmt.where(dt_column >= date_from)
    if date_to is not None:
        stmt = stmt.where(dt_column <= date_to)

    if date_range:
        normalized = date_range.strip()
        ref = now_utc or datetime.now(timezone.utc)
        if normalized in {"Live (Last 24 Hours)", "Last 24 Hours"}:
            stmt = stmt.where(dt_column >= ref - timedelta(days=1))
        elif normalized == "Last 7 Days":
            stmt = stmt.where(dt_column >= ref - timedelta(days=7))
        elif normalized == "Last 30 Days":
            stmt = stmt.where(dt_column >= ref - timedelta(days=30))
        # 'Current Season' or 'All' does not bound by relative days.

    return stmt


def paginate_select(
    db: Session, stmt: Select[Any], page: int, page_size: int
) -> tuple[list[Any], int, int, int, int]:
    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = int(db.execute(count_stmt).scalar_one() or 0)
    total_pages = max(1, math.ceil(total / page_size)) if total > 0 else 1

    offset = (page - 1) * page_size
    rows = list(db.execute(stmt.offset(offset).limit(page_size)).scalars().all())
    return rows, total, page, page_size, total_pages
