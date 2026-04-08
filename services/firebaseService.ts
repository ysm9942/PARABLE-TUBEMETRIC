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

/** id 기준으로 두 배열을 병합 (합집합). 같은 id면 primary 우선. */
function mergeCreators(primary: Creator[], secondary: Creator[]): Creator[] {
  const map = new Map<string, Creator>();
  for (const c of secondary) map.set(c.id, c);
  for (const c of primary)   map.set(c.id, c);   // primary가 덮어씀
  return Array.from(map.values());
}

/** Creator를 저장합니다. localStorage(즉시) + Firestore(비동기). */
export async function saveCreator(creator: Creator): Promise<void> {
  // 1) localStorage — 즉시, 절대 실패 안 함
  const list = lsLoadCreators();
  const idx  = list.findIndex(c => c.id === creator.id);
  if (idx >= 0) list[idx] = creator; else list.push(creator);
  lsSaveCreators(list);

  // 2) Firestore — 보조 (실패해도 localStorage에 이미 저장됨)
  const store = getDb();
  if (store) {
    try {
      await setDoc(doc(store, CREATOR_COLLECTION, creator.id), {
        ...creator,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('[Firebase] Creator Firestore 저장 실패 (localStorage에는 저장됨):', e);
    }
  }
}

/** Creator를 삭제합니다. localStorage(즉시) + Firestore(비동기). */
export async function deleteCreatorById(id: string): Promise<void> {
  // 1) localStorage — 즉시
  lsSaveCreators(lsLoadCreators().filter(c => c.id !== id));

  // 2) Firestore — 보조
  const store = getDb();
  if (store) {
    try {
      await deleteDoc(doc(store, CREATOR_COLLECTION, id));
    } catch (e) {
      console.error('[Firebase] Creator Firestore 삭제 실패 (localStorage에서는 삭제됨):', e);
    }
  }
}

/** Creator 목록을 구독합니다.
 *
 *  localStorage를 주 저장소로 사용하고,
 *  Firestore 데이터가 오면 localStorage와 병합(합집합)합니다.
 *  → Firestore가 비어있거나 에러가 나도 localStorage 데이터는 절대 사라지지 않습니다.
 */
export function subscribeCreators(
  onData: (creators: Creator[]) => void,
): Unsubscribe {
  // 항상 localStorage 데이터를 먼저 전달 (즉시 표시)
  const localData = lsLoadCreators();
  onData(localData);

  const store = getDb();
  if (!store) return () => {};

  const q = query(collection(store, CREATOR_COLLECTION), orderBy('name'));

  return onSnapshot(q, snap => {
    const firestoreData = snap.docs.map(d => ({ ...d.data() as Creator, id: d.id }));
    const currentLocal  = lsLoadCreators();

    // Firestore에 데이터가 있으면 localStorage와 병합
    if (firestoreData.length > 0) {
      const merged = mergeCreators(firestoreData, currentLocal);
      lsSaveCreators(merged);
      onData(merged);
    } else if (currentLocal.length > 0) {
      // Firestore 비어있지만 localStorage에 있음 → localStorage 유지, Firestore에 푸시 시도
      onData(currentLocal);
      currentLocal.forEach(c => {
        setDoc(doc(store, CREATOR_COLLECTION, c.id), { ...c, updatedAt: serverTimestamp() }).catch(() => {});
      });
    }
    // 둘 다 비어있으면 아무것도 안 함 (이미 위에서 onData(localData) 호출함)
  }, (err) => {
    console.error('[Firebase] Creator 구독 오류 (localStorage 사용):', err);
    // 에러 시에도 localStorage 데이터 유지 — onData 호출 안 함 (이미 위에서 했으므로)
  });
}

export { isConfigured };
