
/**
 * ISO8601 duration 파서
 * 예: PT1M30S -> 90
 */
export const parseYtDurationSeconds = (isoDur: string | null): number | null => {
  if (!isoDur) return null;
  const regex = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
  const matches = isoDur.match(regex);
  if (!matches) return null;

  const days = parseInt(matches[1] || '0', 10);
  const hours = parseInt(matches[2] || '0', 10);
  const mins = parseInt(matches[3] || '0', 10);
  const secs = parseInt(matches[4] || '0', 10);

  return days * 86400 + hours * 3600 + mins * 60 + secs;
};

/**
 * 쇼츠 판별 로직 (사용자 제공 로직 이식)
 */
export const isYouTubeShort = async (
  videoId: string,
  durationSeconds: number | null,
  enableHead: boolean = false, // 브라우저에서는 CORS 문제로 기본 false
  headOnlyOnBoundary: boolean = true
): Promise<boolean> => {
  // 1순위: duration ≤ 180 → Shorts
  if (durationSeconds !== null && durationSeconds <= 180) {
    return true;
  }

  // HEAD 보조 비활성화면 롱폼 처리
  if (!enableHead) {
    return false;
  }

  // 경계 케이스만 HEAD 보조(예: 181~200초)
  if (headOnlyOnBoundary && durationSeconds !== null && durationSeconds > 200) {
    return false;
  }

  /**
   * 브라우저 환경에서 youtube.com/shorts/{id} 에 대한 HEAD 요청은 
   * 일반적으로 CORS에 의해 차단됩니다. 
   * 따라서 브라우저 클라이언트 사이드에서는 180초 규칙에 의존하는 것이 가장 안전합니다.
   */
  try {
    const url = `https://www.youtube.com/shorts/${videoId}`;
    const resp = await fetch(url, { method: 'HEAD', mode: 'no-cors' });
    // no-cors 모드에서는 status 확인이 불가능하므로, 
    // 실제 서비스에서는 프록시 서버를 통해 체크해야 합니다.
    return true; 
  } catch {
    return false;
  }
};
