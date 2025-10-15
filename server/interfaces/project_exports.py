"""API endpoints for exporting project archives."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from common.exports import ProjectExportError, build_clip_project_export
from library import DEFAULT_ACCOUNT_PLACEHOLDER


logger = logging.getLogger(__name__)


router = APIRouter(prefix="/accounts", tags=["exports"])


def _normalise_account(account_id: str) -> Optional[str]:
    return None if account_id == DEFAULT_ACCOUNT_PLACEHOLDER else account_id


@router.post("/{account_id}/clips/{clip_id}/export")
async def export_clip_project(account_id: str, clip_id: str) -> FileResponse:
    """Generate and return a zipped project export for ``clip_id``."""

    normalised_account = _normalise_account(account_id)
    logger.info(
        "Received project export request", extra={
            "account_id": normalised_account or DEFAULT_ACCOUNT_PLACEHOLDER,
            "clip_id": clip_id,
        }
    )
    try:
        export = await asyncio.to_thread(
            build_clip_project_export, normalised_account, clip_id
        )
    except ProjectExportError as exc:
        logger.warning(
            "Project export failed",
            exc_info=True,
            extra={
                "account_id": normalised_account or DEFAULT_ACCOUNT_PLACEHOLDER,
                "clip_id": clip_id,
            },
        )
        status_code_override = getattr(exc, "status_code", None)
        http_status = status_code_override or status.HTTP_404_NOT_FOUND
        raise HTTPException(
            status_code=http_status,
            detail=str(exc) or "Clip could not be exported.",
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive guard
        logger.exception(
            "Unexpected error while building project export",
            extra={
                "account_id": normalised_account or DEFAULT_ACCOUNT_PLACEHOLDER,
                "clip_id": clip_id,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "Failed to build the project export. See server logs for more details."
            ),
        ) from exc

    return FileResponse(
        path=export.archive_path,
        filename=export.archive_path.name,
        media_type="application/zip",
    )


__all__ = ["router"]
