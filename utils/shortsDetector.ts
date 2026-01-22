
/**
 * ISO8601 duration parser (e.g., PT1M30S -> 90)
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
 * YouTube Shorts detection logic based on provided Python reference.
 */
export const isYouTubeShort = async (
  videoId: string,
  durationSeconds: number | null,
  enableHead: boolean = false
): Promise<boolean> => {
  // 1st Priority: duration <= 180s -> Shorts
  if (durationSeconds !== null && durationSeconds <= 180) {
    return true;
  }

  // If HEAD check is disabled, anything above 180 is not a short
  if (!enableHead) {
    return false;
  }

  // Boundary case: Only check if duration is under 200s
  if (durationSeconds !== null && durationSeconds > 200) {
    return false;
  }

  /**
   * Note: Browser-side HEAD requests to youtube.com/shorts/{id} are blocked by CORS.
   * In a real production environment with a proxy, you would check the 200 status code here.
   * For this client-side app, we rely on the 180s rule as the primary filter.
   */
  return false; 
};
