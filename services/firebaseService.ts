/**
 * Firebase Firestore에서 스크래퍼 결과를 읽어오는 서비스.
 * 로컬 Python 스크래퍼가 results/ 에 저장 → GitHub push →
 * GitHub Actions → Firestore 순으로 데이터가 흐른다.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { ChannelResult, VideoResult, AdAnalysisResult } from '../types';

// ──────────────────────────────────────────────
// 채널 분석 결과
// ──────────────────────────────────────────────

export const getChannelResult = async (channelId: string): Promise<ChannelResult | null> => {
  const snap = await getDoc(doc(db, 'channels', channelId));
  return snap.exists() ? (snap.data() as ChannelResult) : null;
};

export const getAllChannelResults = async (): Promise<ChannelResult[]> => {
  const q = query(collection(db, 'channels'), orderBy('scrapedAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as ChannelResult);
};

// ──────────────────────────────────────────────
// 개별 영상 결과
// ──────────────────────────────────────────────

export const getVideoResult = async (videoId: string): Promise<VideoResult | null> => {
  const snap = await getDoc(doc(db, 'videos', videoId));
  return snap.exists() ? (snap.data() as VideoResult) : null;
};

export const getAllVideoResults = async (): Promise<VideoResult[]> => {
  const q = query(collection(db, 'videos'), orderBy('scrapedAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as VideoResult);
};

// ──────────────────────────────────────────────
// 광고 분석 결과
// ──────────────────────────────────────────────

export const getAdResult = async (channelId: string): Promise<AdAnalysisResult | null> => {
  const snap = await getDoc(doc(db, 'ads', channelId));
  return snap.exists() ? (snap.data() as AdAnalysisResult) : null;
};

export const getAllAdResults = async (): Promise<AdAnalysisResult[]> => {
  const q = query(collection(db, 'ads'), orderBy('scrapedAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as AdAnalysisResult);
};

// ──────────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────────

/** Firebase에서 채널을 검색 (이름 부분 일치는 Firestore가 지원 안 하므로 전체 로드 후 필터) */
export const searchChannelByName = async (name: string): Promise<ChannelResult[]> => {
  const all = await getAllChannelResults();
  const lower = name.toLowerCase();
  return all.filter(c => c.channelName?.toLowerCase().includes(lower));
};
