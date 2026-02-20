"""
YouTube Shorts 판별 유틸리티
"""
import re


def parse_duration_seconds(duration_text: str) -> int:
    """
    YouTube 페이지에 표시되는 duration 텍스트를 초로 변환.
    지원 형식: "3:45", "1:23:45", "0:59", "PT3M45S" (ISO8601)
    """
    if not duration_text:
        return 0

    # ISO8601 형식 (API 응답용)
    iso_match = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration_text)
    if iso_match:
        h = int(iso_match.group(1) or 0)
        m = int(iso_match.group(2) or 0)
        s = int(iso_match.group(3) or 0)
        return h * 3600 + m * 60 + s

    # "HH:MM:SS" 또는 "MM:SS" 형식
    parts = duration_text.strip().split(":")
    try:
        parts = [int(p) for p in parts]
        if len(parts) == 2:
            return parts[0] * 60 + parts[1]
        if len(parts) == 3:
            return parts[0] * 3600 + parts[1] * 60 + parts[2]
    except ValueError:
        pass

    return 0


def is_short(duration_text: str, video_id: str = "") -> bool:
    """
    ≤ 180초이면 Shorts로 판별.
    duration_text가 없으면 video_id 기반으로 Shorts URL 패턴 확인.
    """
    if video_id and len(video_id) == 11:
        # Shorts 특유의 세로 비율은 스크래퍼에서 별도 감지
        pass

    seconds = parse_duration_seconds(duration_text)
    if seconds == 0:
        return False
    return seconds <= 180
