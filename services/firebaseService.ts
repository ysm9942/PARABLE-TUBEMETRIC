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
  timestamp: string;        // ISO string (set locally)
  serverTs?: unknown;       // Firestore serverTimestamp
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
      return;
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
// ════════════════════════════════════════════════════════════════════════════

const LS_CREATORS = 'tubemetric-creators';

function lsLoadCreators(): Creator[] {
  try { return JSON.parse(localStorage.getItem(LS_CREATORS) ?? '[]'); } catch { return []; }
}
function lsSaveCreators(list: Creator[]) {
  localStorage.setItem(LS_CREATORS, JSON.stringify(list));
}

/** Creator를 저장(추가/수정)합니다. */
export async function saveCreator(creator: Creator): Promise<void> {
  const store = getDb();
  if (store) {
    try {
      await setDoc(doc(store, CREATOR_COLLECTION, creator.id), {
        ...creator,
        updatedAt: serverTimestamp(),
      });
      return;
    } catch { /* fallback */ }
  }
  // localStorage fallback
  const list = lsLoadCreators();
  const idx  = list.findIndex(c => c.id === creator.id);
  if (idx >= 0) list[idx] = creator; else list.push(creator);
  lsSaveCreators(list);
}

/** Creator를 삭제합니다. */
export async function deleteCreatorById(id: string): Promise<void> {
  const store = getDb();
  if (store) {
    try {
      await deleteDoc(doc(store, CREATOR_COLLECTION, id));
      return;
    } catch { /* fallback */ }
  }
  lsSaveCreators(lsLoadCreators().filter(c => c.id !== id));
}

/** Creator 목록을 실시간 구독합니다. */
export function subscribeCreators(
  onData: (creators: Creator[]) => void,
): Unsubscribe {
  const store = getDb();

  if (store) {
    const q = query(
      collection(store, CREATOR_COLLECTION),
      orderBy('name'),
    );
    return onSnapshot(q, snap => {
      onData(snap.docs.map(d => ({ ...d.data() as Creator, id: d.id })));
    }, () => {
      // Firestore 권한 오류 등 → fallback
      onData(lsLoadCreators());
    });
  }

  // localStorage fallback
  onData(lsLoadCreators());
  return () => { /* no-op */ };
}

export { isConfigured };
