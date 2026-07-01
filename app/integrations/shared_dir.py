"""Reads the latest 30fps frame from the Shared Dir.

The Hardware Server (PORT 8081) writes a 30fps JPEG stream into the Shared Dir
using atomic temp-file-then-rename with consistent naming (``frame_*.jpg``).
This reader returns the newest *fully written* frame and ignores partial writes
(temp files, zero-byte files). If no frame exists yet, it synthesizes a small
placeholder JPEG so the kiosk's /cctv/frame never breaks.
"""

from __future__ import annotations

from pathlib import Path

from app.core.config import Settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# Minimal valid 1x1 JPEG (used when the Shared Dir has no frame yet).
_PLACEHOLDER_JPEG = bytes.fromhex(
    "ffd8ffe000104a46494600010100000100010000ffdb004300"
    "080606070605080707070909080a0c140d0c0b0b0c1912130f14"
    "1d1a1f1e1d1a1c1c20242e2720222c231c1c28372f2c30313434"
    "341f27393d38323c2e333432ffc0000b080001000101011100ff"
    "c4001f0000010501010101010100000000000000000102030405"
    "060708090a0bffc400b5100002010303020403050504040000017d"
    "01020300041105122131410613516107227114328191a1082342b1"
    "c11552d1f02433627282090a161718191a25262728292a3435363738"
    "393a434445464748494a535455565758595a636465666768696a73"
    "7475767778797a838485868788898a92939495969798999aa2a3a4a5"
    "a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6"
    "d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008"
    "01010000003f00fbfeff00ffd9"
)


class FrameResult:
    """A frame plus metadata about where it came from."""

    def __init__(self, data: bytes, content_type: str, source: str, name: str | None):
        self.data = data
        self.content_type = content_type
        self.source = source  # "shared_dir" / "placeholder"
        self.name = name


class SharedDirReader:
    def __init__(self, settings: Settings) -> None:
        self._dir = settings.shared_dir
        self._camera_dirs = {
            "CAM-1": settings.shared_dir_cam1,
            "CAM-2": settings.shared_dir_cam2,
        }
        self._glob = settings.frame_glob

    def _dir_for(self, camera_id: str | None) -> Path:
        if not camera_id:
            return self._dir
        return self._camera_dirs.get(camera_id.strip().upper(), self._dir)

    def _is_valid(self, path: Path) -> bool:
        try:
            return path.is_file() and path.stat().st_size > 0
        except OSError:
            return False

    def latest_frame(self, camera_id: str | None = None) -> FrameResult:
        """Return the newest valid frame, or a placeholder if none exists."""
        frame_dir = self._dir_for(camera_id)
        try:
            candidates = [p for p in frame_dir.glob(self._glob) if self._is_valid(p)]
        except OSError as exc:
            logger.warning("Shared Dir not readable (%s); serving placeholder.", exc)
            candidates = []

        if not candidates:
            return FrameResult(_PLACEHOLDER_JPEG, "image/jpeg", "placeholder", None)

        # Newest by modification time; robust against partial writes (size>0).
        newest = max(candidates, key=lambda p: p.stat().st_mtime)
        try:
            data = newest.read_bytes()
        except OSError as exc:
            logger.warning("Failed to read frame %s (%s); placeholder.", newest, exc)
            return FrameResult(_PLACEHOLDER_JPEG, "image/jpeg", "placeholder", None)

        if not data:
            return FrameResult(_PLACEHOLDER_JPEG, "image/jpeg", "placeholder", None)

        return FrameResult(data, "image/jpeg", "shared_dir", newest.name)
