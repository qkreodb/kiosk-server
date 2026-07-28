"""위험 탐지 사진 갤러리 엔드포인트.

VLM 서버가 저장한 위험 스냅샷 폴더를 읽기 전용으로 노출한다.
  * ``GET /danger-frames``               — 사진 목록(파싱된 공정/위반/시각) JSON
  * ``GET /danger-frames/file/{name}``   — 개별 이미지 파일(JPEG/PNG 등)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.api.deps import get_danger_service, get_vlm_client
from app.integrations.vlm_client import VlmClient
from app.schemas.danger import DangerFramesResponse
from app.services.danger_service import DangerFrameService

router = APIRouter(prefix="/danger-frames", tags=["danger-frames"])


class DangerClearResponse(BaseModel):
    deleted: int
    dir: str


@router.get("", response_model=DangerFramesResponse, summary="위험 탐지 사진 목록")
async def list_frames(
    service: DangerFrameService = Depends(get_danger_service),
    vlm: VlmClient = Depends(get_vlm_client),
) -> DangerFramesResponse:
    # 스냅샷 파일명은 안정적인 slot 키를 유지하므로, 표시명은 현재 VLM 규칙에서
    # 읽는다. VLM 장애 시 DangerFrameService가 기존 내장 라벨로 폴백한다.
    rule_labels: dict[str, str] = {}
    status, data = await vlm.rules_request("GET", "/rules")
    if 200 <= status < 300 and isinstance(data, dict):
        for rule in data.get("rules", []):
            if not isinstance(rule, dict):
                continue
            key = str(rule.get("key", "")).strip()
            display_name = str(rule.get("display_name", "")).strip()
            if key and display_name:
                rule_labels[key] = display_name
    frames = service.list_frames(rule_labels)
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
