"""DTOs for GET /danger-frames — the VLM danger-snapshot gallery.

VLM 서버가 위험행동 감지 시 저장한 사진(``공정_위반-위반_YYYYMMDD_HHMMSS.png``)을
키오스크가 폴더에서 읽어 보여주기 위한 응답 형태.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class DangerFrame(BaseModel):
    """One saved danger snapshot, with its filename parsed into fields."""

    filename: str = Field(examples=["A라인_slot_1-slot_4_20260702_143005.png"])
    process: str = Field(description="파일명에서 파싱한 공정명", examples=["A라인"])
    violations: list[str] = Field(
        description="위반 키 목록", examples=[["slot_1", "slot_4"]]
    )
    violation_labels: list[str] = Field(
        description="위반 키의 한글 라벨", examples=[["감시항목 1", "감시항목 4"]]
    )
    captured_at: str | None = Field(
        default=None, description="촬영 시각(표시용)", examples=["2026-07-02 14:30:05"]
    )
    url: str = Field(description="이미지 다운로드 경로", examples=["/danger-frames/file/..."])


class DangerFramesResponse(BaseModel):
    """List of saved danger snapshots, newest first."""

    dir: str = Field(description="사진 폴더 경로")
    count: int
    frames: list[DangerFrame]
