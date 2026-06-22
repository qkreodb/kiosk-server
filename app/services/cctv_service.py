"""Business logic for GET /cctv/frame — serve the latest Shared Dir frame."""

from __future__ import annotations

from app.integrations.shared_dir import FrameResult, SharedDirReader


class CctvService:
    def __init__(self, reader: SharedDirReader) -> None:
        self._reader = reader

    def latest_frame(self) -> FrameResult:
        return self._reader.latest_frame()
