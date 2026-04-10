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
// Creator CRUD
//
// 설계 원칙:
//   localStorage = 주 저장소 (절대 데이터 유실 없음)
//   Firestore    = 보조 동기화 (다른 기기 동기화용, 실패해도 무방)
// ════════════════════════════════════════════════════════════════════════════

const LS_CREATORS = 'tubemetric-creators';

function lsLoadCreators(): Creator[] {
  try { return JSON.parse(localStorage.getItem(LS_CREATORS) ?? '[]'); } catch { return []; }
}
function lsSaveCreators(list: Creator[]) {
  localStorage.setItem(LS_CREATORS, JSON.stringify(list));
}

/** id 기준으로 두 배열을 병합 (합집합). 같은 id면 _updatedAt이 큰 쪽이 우선. */
function mergeCreators(localList: Creator[], firestoreList: Creator[]): Creator[] {
  const map = new Map<string, Creator>();
  for (const c of localList) map.set(c.id, c);
  for (const c of firestoreList) {
    const existing = map.get(c.id);
    if (!existing) {
      // Firestore에만 있음 (다른 기기에서 추가) → 추가
      map.set(c.id, c);
    } else {
      // 양쪽 다 있음 → _updatedAt 비교해서 최신 것 사용
      const localTs = (existing as any)._updatedAt ?? 0;
      const remoteTs = (c as any)._updatedAt ?? 0;
      if (remoteTs > localTs) map.set(c.id, c);
    }
  }
  return Array.from(map.values());
}

/** Creator를 저장합니다. localStorage(즉시) + Firestore(즉시, 비동기). */
export async function saveCreator(creator: Creator): Promise<void> {
  const now = Date.now();
  const creatorWithTs = { ...creator, _updatedAt: now };

  // 1) localStorage — 즉시
  const list = lsLoadCreators();
  const idx  = list.findIndex(c => c.id === creator.id);
  if (idx >= 0) list[idx] = creatorWithTs as any; else list.push(creatorWithTs as any);
  lsSaveCreators(list);

  // 2) Firestore — 즉시 (비동기, 실패해도 UI 차단 안 함)
  const store = getDb();
  if (store) {
    setDoc(doc(store, CREATOR_COLLECTION, creator.id), {
      ...creator,
      _updatedAt: now,
      updatedAt: serverTimestamp(),
    }).then(() => {
      console.log('[Firebase] Creator Firestore 동기화 완료:', creator.name);
    }).catch(e => {
      console.error('[Firebase] Creator Firestore 동기화 실패:', e);
    });
  }
}

/** Creator를 삭제합니다. localStorage(즉시) + Firestore(즉시, 비동기). */
export async function deleteCreatorById(id: string): Promise<void> {
  // 1) localStorage — 즉시
  lsSaveCreators(lsLoadCreators().filter(c => c.id !== id));

  // 2) Firestore — 즉시 (비동기)
  const store = getDb();
  if (store) {
    deleteDoc(doc(store, CREATOR_COLLECTION, id)).then(() => {
      console.log('[Firebase] Creator Firestore 삭제 동기화 완료:', id);
    }).catch(e => {
      console.error('[Firebase] Creator Firestore 삭제 동기화 실패:', e);
    });
  }
}

/** Creator 목록을 구독합니다.
 *
 *  양방향 동기화:
 *  1) 페이지 로드 시 localStorage → Firestore 푸시 (로컬 데이터 보존)
 *  2) Firestore 변경 감지 시 → localStorage와 _updatedAt 기반 병합
 *  → 어느 기기에서든 최신 변경이 양쪽에 반영됩니다.
 */
export function subscribeCreators(
  onData: (creators: Creator[]) => void,
): Unsubscribe {
  // 항상 localStorage 데이터를 먼저 전달 (즉시 표시)
  const localData = lsLoadCreators();
  onData(localData);

  const store = getDb();
  if (!store) return () => {};

  // ★ 페이지 로드 시 localStorage → Firestore 즉시 푸시
  if (localData.length > 0) {
    console.log(`[Firebase] 로컬 Creator ${localData.length}개 → Firestore 푸시 시작`);
    localData.forEach(c => {
      setDoc(doc(store, CREATOR_COLLECTION, c.id), {
        ...c,
        _updatedAt: (c as any)._updatedAt ?? Date.now(),
        updatedAt: serverTimestamp(),
      }).catch(e => console.error('[Firebase] 초기 푸시 실패:', c.name, e));
    });
  }

  const q = query(collection(store, CREATOR_COLLECTION), orderBy('name'));

  return onSnapshot(q, snap => {
    const firestoreData = snap.docs.map(d => ({ ...d.data() as Creator, id: d.id }));
    const currentLocal  = lsLoadCreators();

    if (firestoreData.length > 0 || currentLocal.length > 0) {
      const merged = mergeCreators(currentLocal, firestoreData);
      lsSaveCreators(merged);
      onData(merged);

      // Firestore에 없는 로컬 전용 항목 푸시
      const firestoreIds = new Set(firestoreData.map(c => c.id));
      merged.filter(c => !firestoreIds.has(c.id)).forEach(c => {
        setDoc(doc(store, CREATOR_COLLECTION, c.id), {
          ...c,
          _updatedAt: (c as any)._updatedAt ?? Date.now(),
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      });
    }
  }, (err) => {
    console.error('[Firebase] Creator 구독 오류 (localStorage 사용):', err);
  });
}

export { isConfigured };
