"""
메모리 로그 핸들러 — 최근 N개의 로그 줄을 메모리에 보관.

Render.com은 파일시스템이 에피머럴(재시작 시 초기화)이므로
로그를 메모리에 쌓고 필요 시 GitHub로 push하는 방식을 사용한다.
"""
import collections
import logging

LOG_FORMAT = "%(asctime)s %(levelname)-8s %(name)s — %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


class MemoryLogHandler(logging.Handler):
    """로그 레코드를 메모리 deque에 보관 (최대 maxlen개)."""

    def __init__(self, maxlen: int = 1000):
        super().__init__()
        self.buffer: collections.deque[str] = collections.deque(maxlen=maxlen)
        self.setFormatter(logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT))

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self.buffer.append(self.format(record))
        except Exception:
            self.handleError(record)

    def get_lines(self) -> list[str]:
        return list(self.buffer)

    def clear(self) -> None:
        self.buffer.clear()


# 모듈 로드 시 싱글톤 생성 — main.py와 routers 양쪽에서 동일 객체 참조
memory_handler = MemoryLogHandler(maxlen=1000)


def setup_logging() -> None:
    """루트 로거에 콘솔 + 메모리 핸들러를 설정한다. main.py에서 한 번만 호출."""
    formatter = logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT)

    console = logging.StreamHandler()
    console.setFormatter(formatter)

    root = logging.getLogger()
    root.setLevel(logging.INFO)

    # 중복 핸들러 방지
    if not any(isinstance(h, MemoryLogHandler) for h in root.handlers):
        root.addHandler(memory_handler)
    if not any(isinstance(h, logging.StreamHandler) and not isinstance(h, MemoryLogHandler)
               for h in root.handlers):
        root.addHandler(console)
