"""위험 탐지 사진 갤러리 엔드포인트.

VLM 서버가 저장한 위험 스냅샷 폴더를 읽기 전용으로 노출한다.
  * ``GET /danger-frames``               — 사진 목록(파싱된 공정/위반/시각) JSON
  * ``GET /danger-frames/file/{name}``   — 개별 이미지 파일(JPEG/PNG 등)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.api.deps import get_danger_service
from app.schemas.danger import DangerFramesResponse
from app.services.danger_service import DangerFrameService

router = APIRouter(prefix="/danger-frames", tags=["danger-frames"])


class DangerClearResponse(BaseModel):
    deleted: int
    dir: str


@router.get("", response_model=DangerFramesResponse, summary="위험 탐지 사진 목록")
async def list_frames(
    service: DangerFrameService = Depends(get_danger_service),
) -> DangerFramesResponse:
    # 시연 감시항목은 고정되어 있으므로 VLM에 이름을 재조회하지 않는다. VLM이 꺼져도
    # 저장된 위험 사진은 즉시 실제 감시항목명으로 표시된다.
    frames = service.list_frames()
    return DangerFramesResponse(dir=service.dir_str, count=len(frames), frames=frames)


@router.delete("", response_model=DangerClearResponse, summary="위험 탐지 사진 전체 삭제")
async def clear_frames(
    service: DangerFrameService = Depends(get_danger_service),
) -> DangerClearResponse:
    """폴더의 위험 스냅샷을 모두 삭제(신호등 [초기화]와 연동)."""
    deleted = service.clear_frames()
    return DangerClearResponse(deleted=deleted, dir=service.dir_str)


@router.get(
    "/file/{filename}",
    summary="위험 탐지 사진 파일",
    responses={200: {"content": {"image/*": {}}}},
)
async def get_frame(
    filename: str,
    service: DangerFrameService = Depends(get_danger_service),
) -> FileResponse:
    path = service.frame_path(filename)
    if path is None:
        raise HTTPException(status_code=404, detail=f"사진을 찾을 수 없습니다: {filename}")
    return FileResponse(path, headers={"Cache-Control": "no-store"})
