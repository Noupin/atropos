"""API endpoints for exporting project archives."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from common.exports import ProjectExportError, build_clip_project_export
from library import DEFAULT_ACCOUNT_PLACEHOLDER


router = APIRouter(prefix="/accounts", tags=["exports"])


def _normalise_account(account_id: str) -> Optional[str]:
    return None if account_id == DEFAULT_ACCOUNT_PLACEHOLDER else account_id


@router.post("/{account_id}/clips/{clip_id}/export")
async def export_clip_project(account_id: str, clip_id: str) -> FileResponse:
    """Generate and return a zipped project export for ``clip_id``."""

    normalised_account = _normalise_account(account_id)
    try:
        export = await asyncio.to_thread(
            build_clip_project_export, normalised_account, clip_id
        )
    except ProjectExportError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc) or "Clip could not be exported.",
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive guard
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to build the project export.",
        ) from exc

    return FileResponse(
        path=export.archive_path,
        filename=export.archive_path.name,
        media_type="application/zip",
    )


__all__ = ["router"]
