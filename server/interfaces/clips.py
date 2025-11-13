"""Clip library endpoints exposed via FastAPI routers."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, FastAPI, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field

from library import paginate_account_clips


DEFAULT_PAGE_SIZE = 20


class ProjectSummaryResponse(BaseModel):
    """Summary payload describing clips grouped by project/video."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    title: str
    total_clips: int = Field(alias="totalClips")
    latest_created_at: str = Field(alias="latestCreatedAt")


class PaginatedClipsResponse(BaseModel):
    """Response body describing a page of account clips."""

    model_config = ConfigDict(populate_by_name=True)

    clips: list[dict[str, object]]
    next_cursor: Optional[str] = Field(default=None, alias="nextCursor")
    total_clips: int = Field(default=0, alias="totalClips")
    projects: list[ProjectSummaryResponse] = Field(default_factory=list)


class ClipCountResponse(BaseModel):
    """Response payload describing the total number of clips for an account."""

    model_config = ConfigDict(populate_by_name=True)

    account_id: str = Field(alias="accountId")
    total_clips: int = Field(alias="totalClips")


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
        clips, next_cursor, total_clips, project_summaries = await paginate_account_clips(
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
    projects = [ProjectSummaryResponse.model_validate(summary) for summary in project_summaries]
    return PaginatedClipsResponse(
        clips=payload,
        nextCursor=next_cursor,
        totalClips=total_clips,
        projects=projects,
    )


@router.get("/clips/count", response_model=ClipCountResponse)
async def get_clip_count(account_id: str = Query(alias="accountId", min_length=1)) -> ClipCountResponse:
    """Return the total clip count for the provided account without fetching clip data."""

    try:
        _, _, total_clips, _ = await paginate_account_clips(account_id, limit=1, cursor=None)
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive guard
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to load clip count",
        ) from exc

    return ClipCountResponse(accountId=account_id, totalClips=total_clips)


def register_legacy_routes(app: FastAPI) -> None:
    """Expose backwards-compatible clip routes without the /api prefix."""

    app.add_api_route(
        "/clips",
        list_paginated_clips,
        methods=["GET"],
        response_model=PaginatedClipsResponse,
        include_in_schema=False,
    )
