"""
GitHub Actions에서 실행되는 Firebase 동기화 스크립트.
results/ 폴더의 JSON 파일들을 Firebase Firestore에 업로드한다.

환경변수:
  FIREBASE_CREDENTIALS - Firebase 서비스 계정 JSON 문자열 (GitHub Secret)
"""
import glob
import json
import os
import sys
from datetime import datetime

import firebase_admin
from firebase_admin import credentials, firestore


def init_firebase():
    creds_raw = os.environ.get("FIREBASE_CREDENTIALS", "")
    if not creds_raw:
        print("[오류] FIREBASE_CREDENTIALS 환경변수가 설정되지 않았습니다.", file=sys.stderr)
        sys.exit(1)
    try:
        creds_dict = json.loads(creds_raw)
    except json.JSONDecodeError as e:
        print(f"[오류] FIREBASE_CREDENTIALS JSON 파싱 실패: {e}", file=sys.stderr)
        sys.exit(1)

    cred = credentials.Certificate(creds_dict)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def sync_collection(db, pattern: str, collection_name: str, id_field: str):
    """glob 패턴에 맞는 JSON 파일을 Firestore 컬렉션에 동기화"""
    files = sorted(glob.glob(pattern))
    if not files:
        print(f"[{collection_name}] 동기화할 파일 없음")
        return

    # 같은 ID의 파일이 여러 개면 최신 파일만 사용 (타임스탬프 기준)
    latest: dict[str, str] = {}
    for filepath in files:
        with open(filepath, encoding="utf-8") as f:
            try:
                data = json.load(f)
            except json.JSONDecodeError:
                print(f"  [스킵] JSON 파싱 실패: {filepath}")
                continue
        doc_id = data.get(id_field)
        if not doc_id:
            print(f"  [스킵] '{id_field}' 필드 없음: {filepath}")
            continue
        # 더 최신 파일로 덮어쓰기
        if doc_id not in latest or filepath > latest[doc_id]:
            latest[doc_id] = filepath

    for doc_id, filepath in latest.items():
        with open(filepath, encoding="utf-8") as f:
            data = json.load(f)
        data["syncedAt"] = datetime.utcnow().isoformat() + "Z"
        db.collection(collection_name).document(doc_id).set(data, merge=True)
        print(f"  [{collection_name}] 업로드: {doc_id}")

    print(f"[{collection_name}] 완료: {len(latest)}개 문서")


def main():
    print("Firebase 동기화 시작...")
    db = init_firebase()

    sync_collection(db, "results/channels/*.json", "channels", "channelId")
    sync_collection(db, "results/videos/*.json", "videos", "videoId")
    sync_collection(db, "results/ads/*.json", "ads", "channelId")

    print("Firebase 동기화 완료!")


if __name__ == "__main__":
    main()
