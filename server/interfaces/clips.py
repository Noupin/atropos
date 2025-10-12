"""Clip library endpoints exposed via FastAPI routers."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, FastAPI, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field

from library import paginate_account_clips


DEFAULT_PAGE_SIZE = 20


class PaginatedClipsResponse(BaseModel):
    """Response body describing a page of account clips."""

    model_config = ConfigDict(populate_by_name=True)

    clips: list[dict[str, object]]
    next_cursor: Optional[str] = Field(default=None, alias="nextCursor")


router = APIRouter(tags=["clips"])


@router.get("/clips", response_model=PaginatedClipsResponse)
async def list_paginated_clips(
    request: Request,
    account_id: str = Query(alias="accountId", min_length=1),
    limit: int = Query(DEFAULT_PAGE_SIZE, gt=0, le=100),
    cursor: Optional[str] = Query(default=None),
) -> PaginatedClipsResponse:
    """Return a paginated set of clips for the provided account."""

    try:
        clips, next_cursor = await paginate_account_clips(
            account_id, limit=limit, cursor=cursor
        )
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive guard
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to load clip library",
        ) from exc

    payload = [clip.to_payload(request) for clip in clips]
    return PaginatedClipsResponse(clips=payload, nextCursor=next_cursor)


def register_legacy_routes(app: FastAPI) -> None:
    """Expose backwards-compatible clip routes without the /api prefix."""

    app.add_api_route(
        "/clips",
        list_paginated_clips,
        methods=["GET"],
        response_model=PaginatedClipsResponse,
        include_in_schema=False,
    )
