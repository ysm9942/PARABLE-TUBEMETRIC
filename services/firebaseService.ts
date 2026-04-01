import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  Firestore,
  Unsubscribe,
  serverTimestamp,
} from 'firebase/firestore';

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

const COLLECTION = 'system-logs';
const LOG_LIMIT  = 200;

let app: FirebaseApp | null  = null;
let db:  Firestore  | null   = null;

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

// ── 로그 추가 ────────────────────────────────────────────────────────────────
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
      await addDoc(collection(store, COLLECTION), {
        ...entry,
        serverTs: serverTimestamp(),
      });
      return;
    } catch {
      // Firebase 실패 시 localStorage 폴백
    }
  }

  // ── localStorage fallback ────────────────────────────────────────────────
  try {
    const key  = 'tubemetric-syslog';
    const raw  = localStorage.getItem(key);
    const list: SystemLogEntry[] = raw ? JSON.parse(raw) : [];
    list.unshift({ ...entry, id: crypto.randomUUID() });
    if (list.length > LOG_LIMIT) list.splice(LOG_LIMIT);
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // 무시
  }
}

// ── 로그 구독 (실시간) ────────────────────────────────────────────────────────
export function subscribeSystemLogs(
  onData: (entries: SystemLogEntry[]) => void,
): Unsubscribe {
  const store = getDb();

  if (store) {
    const q = query(
      collection(store, COLLECTION),
      orderBy('serverTs', 'desc'),
      limit(LOG_LIMIT),
    );
    return onSnapshot(q, snap => {
      const entries: SystemLogEntry[] = snap.docs.map(d => ({
        id: d.id,
        ...d.data() as Omit<SystemLogEntry, 'id'>,
        // serverTimestamp → ISO string for display
        timestamp: d.data().timestamp ?? new Date().toISOString(),
      }));
      onData(entries);
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

  // 폴링 (로컬 fallback)
  const iv = setInterval(load, 5000);
  return () => clearInterval(iv);
}

export { isConfigured };
