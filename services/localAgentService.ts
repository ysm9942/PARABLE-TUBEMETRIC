/**
 * TubeMetric Local Agent 감지 및 통신 서비스
 *
 * 로컬 에이전트(localhost:8001)가 실행 중이면 Render 서버 대신 사용.
 * → 로컬 IP/VPN으로 요청하므로 Vercel Security Checkpoint 우회 가능.
 */
import axios from 'axios';

export const LOCAL_AGENT_URL      = 'http://localhost:8001';
export const SOFTC_AGENT_URL      = 'http://localhost:8002';
export const INSTAGRAM_AGENT_URL  = 'http://localhost:8003';

const GITHUB_RELEASE_BASE =
  'https://github.com/ysm9942/PARABLE-TUBEMETRIC/releases/latest/download';

export const INSTALLER_URLS = {
  windows: `${GITHUB_RELEASE_BASE}/TubeMetric-Agent-Setup-Windows.exe`,
  macos: `${GITHUB_RELEASE_BASE}/TubeMetric-Agent-Setup-macOS.pkg`,
};

export const SOFTC_INSTALLER_URLS = {
  windows: `${GITHUB_RELEASE_BASE}/TubeMetric-SoftC-Scraper-Setup-Windows.exe`,
  macos: `${GITHUB_RELEASE_BASE}/TubeMetric-SoftC-Scraper-Setup-macOS.pkg`,
};

export const INSTAGRAM_INSTALLER_URLS = {
  windows: `${GITHUB_RELEASE_BASE}/TubeMetric-Instagram-Agent-Setup-Windows.exe`,
  macos: `${GITHUB_RELEASE_BASE}/TubeMetric-Instagram-Agent-Setup-macOS.pkg`,
};

/** 현재 OS 감지 */
export const detectOS = (): 'windows' | 'macos' | 'other' => {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'macos';
  return 'other';
};

/** 로컬 에이전트(8001)가 실행 중인지 확인 (타임아웃 1.5초) */
export const checkLocalAgent = async (): Promise<boolean> => {
  try {
    const res = await axios.get(`${LOCAL_AGENT_URL}/api/health`, { timeout: 1500 });
    return res.data?.status === 'ok';
  } catch {
    return false;
  }
};

/** SoftC 로컬 에이전트(8002)가 실행 중인지 확인 (타임아웃 1.5초) */
export const checkSoftcAgent = async (): Promise<boolean> => {
  try {
    const res = await axios.get(`${SOFTC_AGENT_URL}/api/health`, { timeout: 1500 });
    return res.data?.status === 'ok';
  } catch {
    return false;
  }
};

/** 주기적으로 에이전트 감지 (설치 후 자동 연결) */
export const waitForLocalAgent = (
  onConnected: () => void,
  intervalMs = 3000,
  maxAttempts = 20
): () => void => {
  let attempts = 0;
  const timer = setInterval(async () => {
    attempts++;
    const ok = await checkLocalAgent();
    if (ok) {
      clearInterval(timer);
      onConnected();
    } else if (attempts >= maxAttempts) {
      clearInterval(timer);
    }
  }, intervalMs);
  return () => clearInterval(timer);
};

/** Instagram 로컬 에이전트(8003)가 실행 중인지 확인 (타임아웃 1.5초) */
export const checkInstagramAgent = async (): Promise<boolean> => {
  try {
    const res = await axios.get(`${INSTAGRAM_AGENT_URL}/api/health`, { timeout: 1500 });
    return res.data?.status === 'ok';
  } catch {
    return false;
  }
};

/** 주기적으로 Instagram 에이전트 감지 (설치 후 자동 연결) */
export const waitForInstagramAgent = (
  onConnected: () => void,
  intervalMs = 3000,
  maxAttempts = 20
): () => void => {
  let attempts = 0;
  const timer = setInterval(async () => {
    attempts++;
    const ok = await checkInstagramAgent();
    if (ok) {
      clearInterval(timer);
      onConnected();
    } else if (attempts >= maxAttempts) {
      clearInterval(timer);
    }
  }, intervalMs);
  return () => clearInterval(timer);
};

/** 주기적으로 SoftC 에이전트 감지 (설치 후 자동 연결) */
export const waitForSoftcAgent = (
  onConnected: () => void,
  intervalMs = 3000,
  maxAttempts = 20
): () => void => {
  let attempts = 0;
  const timer = setInterval(async () => {
    attempts++;
    const ok = await checkSoftcAgent();
    if (ok) {
      clearInterval(timer);
      onConnected();
    } else if (attempts >= maxAttempts) {
      clearInterval(timer);
    }
  }, intervalMs);
  return () => clearInterval(timer);
};
