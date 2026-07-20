"""DTOs for GET /api/heat (공정별 체감온도)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ProcessHeat(BaseModel):
    """한 공정의 최신 체감온도 스냅샷."""

    process_id: str = Field(examples=["3"])
    process_name: str = Field(examples=["도장 공정"])
    temperature: float | None = Field(default=None, description="섭씨 온도 (°C)", examples=[31.2])
    humidity: float | None = Field(default=None, description="상대 습도 (%)", examples=[65.0])
    heat_index: float | None = Field(default=None, description="체감 온도 (°C)", examples=[33.4])
    status: str = Field(
        description="관심/주의/경고/위험/정상/미수신(센서 값 없음·오래됨)",
        examples=["주의"],
    )
    updated_at: str | None = Field(
        default=None,
        description="마지막 측정 시각(ISO-8601). 수신 이력 자체가 없으면 null.",
    )


class HeatListResponse(BaseModel):
    count: int
    processes: list[ProcessHeat]
