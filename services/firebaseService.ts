import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  setDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  limit,
  onSnapshot,
  Firestore,
  Unsubscribe,
  serverTimestamp,
} from 'firebase/firestore';
import type { Creator } from '../types';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogCategory = 'connection' | 'analysis' | 'error' | 'system';

export interface SystemLogEntry {
  id?: string;
  timestamp: string;
  serverTs?: unknown;
  level: LogLevel;
  category: LogCategory;
  message: string;
  details?: Record<string, unknown>;
  clientOS?: string;
  userAgent?: string;
}

// ── Firebase config (Vercel env vars) ────────────────────────────────────────
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const LOG_COLLECTION     = 'system-logs';
const CREATOR_COLLECTION = 'creators';
const LOG_LIMIT          = 200;

let app: FirebaseApp | null = null;
let db:  Firestore  | null  = null;

function isConfigured(): boolean {
  return !!(firebaseConfig.projectId && firebaseConfig.apiKey);
}

function getDb(): Firestore | null {
  if (!isConfigured()) return null;
  if (!db) {
    app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    db  = getFirestore(app);
  }
  return db;
}

// ── 공통 클라이언트 정보 ──────────────────────────────────────────────────────
function clientMeta() {
  return {
    clientOS:  navigator.platform ?? 'unknown',
    userAgent: navigator.userAgent,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// System Log
// ════════════════════════════════════════════════════════════════════════════

export async function addSystemLog(
  level: LogLevel,
  category: LogCategory,
  message: string,
  details?: Record<string, unknown>,
): Promise<void> {
  const entry: SystemLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    details,
    ...clientMeta(),
  };

  const store = getDb();
  if (store) {
    try {
      await addDoc(collection(store, LOG_COLLECTION), {
        ...entry,
        serverTs: serverTimestamp(),
      });
    } catch {
      // Firebase 실패 시 localStorage 폴백
    }
  }

  try {
    const key  = 'tubemetric-syslog';
    const raw  = localStorage.getItem(key);
    const list: SystemLogEntry[] = raw ? JSON.parse(raw) : [];
    list.unshift({ ...entry, id: crypto.randomUUID() });
    if (list.length > LOG_LIMIT) list.splice(LOG_LIMIT);
    localStorage.setItem(key, JSON.stringify(list));
  } catch { /* 무시 */ }
}

export function subscribeSystemLogs(
  onData: (entries: SystemLogEntry[]) => void,
): Unsubscribe {
  const store = getDb();

  if (store) {
    const q = query(
      collection(store, LOG_COLLECTION),
      orderBy('serverTs', 'desc'),
      limit(LOG_LIMIT),
    );
    return onSnapshot(q, snap => {
      onData(snap.docs.map(d => ({
        id: d.id,
        ...d.data() as Omit<SystemLogEntry, 'id'>,
        timestamp: (d.data().timestamp as string) ?? new Date().toISOString(),
      })));
    });
  }

  // localStorage fallback
  const load = () => {
    try {
      const raw = localStorage.getItem('tubemetric-syslog');
      onData(raw ? JSON.parse(raw) : []);
    } catch { onData([]); }
  };
  load();
  const iv = setInterval(load, 5000);
  return () => clearInterval(iv);
}

// ════════════════════════════════════════════════════════════════════════════
// Creator CRUD — 실시간 양방향 동기화
//
// 설계 원칙:
//   Firestore    = 유일한 진실 원천 (Single Source of Truth)
//   localStorage = 오프라인 캐시 + 초기 로드 시 즉시 표시용
//
// 흐름:
//   1) 저장/삭제 → Firestore에 즉시 쓰기 (낙관적으로 localStorage도 업데이트)
//   2) onSnapshot 리스너가 Firestore 변경을 실시간 감지
//   3) 스냅샷 수신 시 localStorage와 state를 Firestore 데이터로 완전히 교체
//   → 어느 기기에서 변경하든 모든 기기에 즉시 반영 (추가·수정·삭제 포함)
// ════════════════════════════════════════════════════════════════════════════

const LS_CREATORS = 'tubemetric-creators';
const LS_SYNC_FLAG = 'tubemetric-creators-synced';  // 초기 마이그레이션 플래그

function lsLoadCreators(): Creator[] {
  try { return JSON.parse(localStorage.getItem(LS_CREATORS) ?? '[]'); } catch { return []; }
}
function lsSaveCreators(list: Creator[]) {
  localStorage.setItem(LS_CREATORS, JSON.stringify(list));
}

/** Firestore는 undefined 값을 허용하지 않으므로 제거 (빈 배열/빈 문자열은 유지) */
function stripUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

/** Creator를 저장합니다. Firestore에 즉시 쓰고 localStorage도 낙관적 업데이트. */
export async function saveCreator(creator: Creator): Promise<void> {
  // 1) localStorage — 즉시 낙관적 업데이트 (UI 즉시 반응)
  const list = lsLoadCreators();
  const idx  = list.findIndex(c => c.id === creator.id);
  if (idx >= 0) list[idx] = creator; else list.push(creator);
  lsSaveCreators(list);

  // 2) Firestore — 즉시 쓰기 (onSnapshot이 모든 기기에 전파)
  const store = getDb();
  if (!store) {
    console.warn('[Firebase] 연결 없음 — localStorage만 저장됨');
    return;
  }
  try {
    await setDoc(doc(store, CREATOR_COLLECTION, creator.id), {
      ...stripUndefined(creator),
      updatedAt: serverTimestamp(),
    });
    console.log('[Firebase] Creator 저장 완료:', creator.name);
  } catch (e) {
    console.error('[Firebase] Creator 저장 실패:', e);
    throw e;
  }
}

/** Creator를 삭제합니다. Firestore에 즉시 삭제 요청하고 localStorage도 업데이트. */
export async function deleteCreatorById(id: string): Promise<void> {
  // 1) localStorage — 즉시 낙관적 업데이트
  lsSaveCreators(lsLoadCreators().filter(c => c.id !== id));

  // 2) Firestore — 즉시 삭제
  const store = getDb();
  if (!store) return;
  try {
    await deleteDoc(doc(store, CREATOR_COLLECTION, id));
    console.log('[Firebase] Creator 삭제 완료:', id);
  } catch (e) {
    console.error('[Firebase] Creator 삭제 실패:', e);
    throw e;
  }
}

/** Creator 목록을 실시간 구독합니다. Firestore = 진실 원천. */
export function subscribeCreators(
  onData: (creators: Creator[]) => void,
): Unsubscribe {
  // 1) localStorage 데이터를 먼저 표시 (즉각적인 UI 응답)
  const localData = lsLoadCreators();
  if (localData.length > 0) onData(localData);

  const store = getDb();
  if (!store) {
    console.warn('[Firebase] Firestore 연결 없음 — localStorage만 사용');
    return () => {};
  }

  const q = query(collection(store, CREATOR_COLLECTION), orderBy('name'));

  return onSnapshot(q, snap => {
    const firestoreData: Creator[] = snap.docs.map(d => {
      const data = d.data() as any;
      // Firestore 전용 필드(updatedAt serverTimestamp 등) 제외
      const { updatedAt, _updatedAt, ...rest } = data;
      return { ...rest, id: d.id } as Creator;
    });

    const hasSyncedBefore = localStorage.getItem(LS_SYNC_FLAG) === '1';
    const currentLocal = lsLoadCreators();

    // ★ 초기 마이그레이션: 이전에 한 번도 동기화된 적 없고 Firestore가 비어있고 로컬에 데이터가 있으면
    //    로컬 데이터를 Firestore에 업로드 (기존 localStorage 데이터 보존)
    if (!hasSyncedBefore && firestoreData.length === 0 && currentLocal.length > 0) {
      console.log(`[Firebase] 초기 마이그레이션: localStorage ${currentLocal.length}개 → Firestore`);
      currentLocal.forEach(c => {
        setDoc(doc(store, CREATOR_COLLECTION, c.id), {
          ...stripUndefined(c),
          updatedAt: serverTimestamp(),
        }).catch(e => console.error('[Firebase] 마이그레이션 실패:', c.name, e));
      });
      localStorage.setItem(LS_SYNC_FLAG, '1');
      onData(currentLocal);
      // 다음 onSnapshot에서 Firestore 데이터가 반영됨
      return;
    }

    // ★ Firestore = 진실 원천. localStorage와 state를 완전히 교체.
    //    (추가·수정은 물론 삭제도 자동으로 전파됨)
    localStorage.setItem(LS_SYNC_FLAG, '1');
    lsSaveCreators(firestoreData);
    onData(firestoreData);
    console.log(`[Firebase] 실시간 동기화: ${firestoreData.length}명`);
  }, (err) => {
    console.error('[Firebase] Creator 구독 오류 (localStorage 사용):', err);
  });
}

export { isConfigured };
