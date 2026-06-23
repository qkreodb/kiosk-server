"""DTOs for GET /space-name — process info for the selected work zone."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.common import CameraInfo
from app.schemas.sensor import TempHumidReading


class ProcessSummary(BaseModel):
    """Identity of one 공정 (work process)."""

    name: str = Field(examples=["정밀가공 공정"])
    code: str = Field(examples=["PRC-19"])
    label: str = Field(
        description="UI 표기용 합본 라벨", examples=["정밀가공 공정 · PRC-19"]
    )


class BehaviorCount(BaseModel):
    """One unsafe-behavior category and its accumulated count."""

    id: str = Field(examples=["helmet_off"])
    name: str = Field(examples=["모자(안전모) 벗는 행동"])
    grade: str = Field(description="정상 / 주의 / 위험", examples=["위험"])
    count: int = Field(description="누적 감지 횟수", examples=[3])


class BehaviorResetResponse(BaseModel):
    """POST /behavior/reset 응답."""

    reset: bool = True
    process_code: str = Field(examples=["PRC-19"])


class SpaceNameResponse(BaseModel):
    """Everything the 불안전행동 감시 신호등 card needs for one process."""

    process: ProcessSummary
    processes: list[ProcessSummary] = Field(
        description="공정 드롭다운에 채울 전체 공정 목록"
    )
    behaviors: list[BehaviorCount] = Field(
        description="4개 불안전행동 카테고리 + 누적 카운트"
    )
    temp_humid: TempHumidReading | None = Field(
        default=None, description="이 공정에 등록된 온습도 센서 대표값"
    )
    cameras: list[CameraInfo] = Field(
        default_factory=list, description="이 공정에 등록된 CCTV"
    )
