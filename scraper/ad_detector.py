"""
광고 감지 모듈 (youtubeService.ts 로직을 Python으로 포팅)
undetected-chromedriver로 실제 페이지를 로드해 ytInitialPlayerResponse에서
paidPromotion 플래그를 추출하고, NLP 텍스트 분석을 결합한다.
"""
import json
import re
import time
from typing import Optional

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC

from browser import wait


# ──────────────────────────────────────────────
# ytInitialPlayerResponse 추출
# ──────────────────────────────────────────────

def _extract_player_response(driver) -> Optional[dict]:
    """페이지 소스에서 ytInitialPlayerResponse JSON 추출"""
    src = driver.page_source
    patterns = [
        r'var ytInitialPlayerResponse\s*=\s*(\{.*?\});\s*(?:</script>|var |\n)',
        r'ytInitialPlayerResponse\s*=\s*(\{.*?\});',
    ]
    for pattern in patterns:
        m = re.search(pattern, src, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                continue
    return None


def _extract_yt_initial_data(driver) -> Optional[dict]:
    """페이지 소스에서 ytInitialData JSON 추출"""
    src = driver.page_source
    m = re.search(r'var ytInitialData\s*=\s*(\{.*?\});\s*(?:</script>|var )', src, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    return None


# ──────────────────────────────────────────────
# 1단계: Paid Promotion 플래그 감지
# ──────────────────────────────────────────────

def detect_paid_flag(player_response: Optional[dict], page_source: str = "") -> dict:
    """
    ytInitialPlayerResponse 및 페이지 소스에서 paidPromotion 관련 키를 탐색.
    """
    paid_promotion = "unknown"
    evidence = []
    found_raw = []

    ad_keys = ["paidPromotion", "isPaidPromotion", "paidProductPlacement", "productPlacement"]

    # JSON 객체 우선 탐색
    if player_response:
        player_str = json.dumps(player_response)
    else:
        player_str = ""

    all_data = player_str + "\n" + page_source

    for key in ad_keys:
        pattern = rf'"{key}"\s*:\s*(true|false|1|0|"true"|"false")'
        for m in re.finditer(pattern, all_data, re.IGNORECASE):
            val_str = m.group(1).lower().replace('"', '')
            is_true = val_str in ("true", "1")
            found_raw.append({"key": key, "value": val_str})

            if is_true and paid_promotion != True:
                paid_promotion = True
                evidence.append({
                    "source": "ytInitialPlayerResponse",
                    "key": key,
                    "value": val_str,
                    "note": "Paid promotion flag detected",
                })
            elif not is_true and paid_promotion == "unknown":
                paid_promotion = False

    confidence = 0.8 if paid_promotion is True else (0.6 if paid_promotion is False else 0.2)

    return {
        "paid_promotion": paid_promotion,
        "confidence": confidence,
        "evidence": evidence[:3],
        "raw_flags": found_raw[:5],
    }


# ──────────────────────────────────────────────
# 2단계: NLP 텍스트 분석
# ──────────────────────────────────────────────

WEIGHTS = {
    "high": [
        "유료 광고", "유료광고", "광고 포함", "paid promotion",
        "includes paid promotion", "sponsored by", "ad:", "광고입니다",
    ],
    "mid": [
        "협찬", "스폰", "sponsor", "sponsorship",
        "제공받아", "지원받아", "파트너십", "원고료", "제작비",
    ],
    "low": [
        "affiliate", "제휴 링크", "수수료", "커미션",
        "gifted", "PR", "#ad", "#sponsored", "#협찬", "#광고",
    ],
    "negative": ["광고 아님", "내돈내산", "not sponsored", "no sponsorship"],
}

WEIGHT_VALUES = {"high": 3, "mid": 2, "low": 1, "negative": -2}


def detect_nlp(video_id: str, title: str, description: str, pinned_comment: str = "") -> dict:
    """제목 + 설명 + 고정 댓글 텍스트에서 광고 키워드 점수 산출"""
    combined = f"{title}\n{description}\n---PINNED---\n{pinned_comment}"
    # URL/이메일 마스킹
    cleaned = re.sub(r"https?://\S+", "<URL>", combined)
    cleaned = re.sub(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", "<CONTACT>", cleaned)
    lower = cleaned.lower()

    score = 0
    matched = []

    for level, phrases in WEIGHTS.items():
        for phrase in phrases:
            if phrase.lower() in lower:
                score += WEIGHT_VALUES[level]
                matched.append({"phrase": phrase, "weight": level, "source": "text"})

    if score >= 3:
        ad_disclosure = True
    elif score == 2:
        ad_disclosure = "unknown"
    else:
        ad_disclosure = False

    # 광고 유형 분류
    ad_type = "unknown"
    if ad_disclosure is True:
        if "수수료" in lower or "affiliate" in lower:
            ad_type = "affiliate"
        elif "제공받아" in lower:
            ad_type = "gifted"
        elif score >= 5:
            ad_type = "paid_promotion"
        else:
            ad_type = "sponsorship"

    confidence = 0.75 if ad_disclosure is True else (0.55 if ad_disclosure is False else 0.3)

    if ad_disclosure is True:
        reasoning = f"텍스트 분석 결과 '{matched[0]['phrase']}' 등 강한 광고 신호가 포착되었습니다."
    elif ad_disclosure is False:
        reasoning = "광고를 암시하는 키워드가 발견되지 않았습니다."
    else:
        reasoning = "광고 여부가 불분명합니다."

    return {
        "video_id": video_id,
        "ad_disclosure": ad_disclosure,
        "ad_type": ad_type,
        "confidence": confidence,
        "matched_phrases": matched[:5],
        "reasoning": reasoning,
    }


# ──────────────────────────────────────────────
# 3단계: DOM 직접 감지 (가장 신뢰도 높은 신호)
# ──────────────────────────────────────────────

_SKIP_SELECTORS = [
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button",
    "button.ytp-ad-skip-button",
    ".ytp-ad-skip-button-container button",
]

_AD_PLAYING_SELECTORS = [
    ".ytp-ad-text",
    ".ytp-ad-preview-container",
    ".ytp-ad-player-overlay",
]


def _skip_ads(driver, max_wait: int = 35) -> None:
    """
    프리롤 광고 스킵 버튼을 클릭하거나, 광고가 자연 종료될 때까지 대기.
    """
    deadline = time.time() + max_wait
    while time.time() < deadline:
        # 스킵 버튼 있으면 클릭
        for sel in _SKIP_SELECTORS:
            try:
                btn = driver.find_element(By.CSS_SELECTOR, sel)
                if btn.is_displayed():
                    btn.click()
                    time.sleep(1.5)
                    # 클릭 후 광고가 또 있을 수 있으므로 루프 계속
                    break
            except Exception:
                pass

        # 광고 재생 중인지 확인
        ad_playing = False
        for sel in _AD_PLAYING_SELECTORS:
            try:
                el = driver.find_element(By.CSS_SELECTOR, sel)
                if el.is_displayed():
                    ad_playing = True
                    break
            except Exception:
                pass

        if not ad_playing:
            return  # 광고 없음 또는 종료됨

        time.sleep(1)


def _detect_paid_overlay(driver, wait_sec: int = 8) -> bool:
    """
    'ytp-paid-content-overlay-text' DOM 요소에서 '유료 광고 포함' 확인.
    광고 스킵 직후 오버레이가 나타날 때까지 최대 wait_sec 초 대기.
    페이지 소스 문자열도 병행 탐색.
    """
    PAID_TEXTS = ["유료 광고 포함", "includes paid promotion", "paid promotion"]
    deadline = time.time() + wait_sec

    while time.time() < deadline:
        # DOM 요소 탐색
        try:
            els = driver.find_elements(By.CSS_SELECTOR, ".ytp-paid-content-overlay-text")
            for el in els:
                txt = el.text.strip().lower()
                if any(p in txt for p in PAID_TEXTS):
                    return True
        except Exception:
            pass

        # 현재 렌더링된 HTML 탐색 (execute_script로 live DOM 획득)
        try:
            html = driver.execute_script("return document.documentElement.outerHTML") or ""
            if "ytp-paid-content-overlay-text" in html:
                lower_html = html.lower()
                if any(p in lower_html for p in PAID_TEXTS):
                    return True
        except Exception:
            pass

        time.sleep(1)

    return False


# ──────────────────────────────────────────────
# 결합 판정
# ──────────────────────────────────────────────

def combine_results(paid_flag: dict, nlp: dict, dom_paid: bool = False) -> dict:
    """
    DOM 오버레이(최우선) + paid_flag + nlp 결과를 결합해 최종 광고 판정.
    dom_paid=True 이면 신뢰도 0.97로 즉시 광고 확정.
    """
    is_paid = paid_flag["paid_promotion"] is True
    is_nlp = nlp["ad_disclosure"] is True

    # DOM 오버레이 감지 — 가장 신뢰도 높은 신호
    if dom_paid:
        evidence = ["DOM 오버레이 감지 (유료 광고 포함 배너)"]
        if is_nlp and nlp["matched_phrases"]:
            evidence.append(f"설명란 키워드 확인 ({nlp['matched_phrases'][0]['phrase']})")
        return {
            "is_ad": True,
            "confidence": 0.97,
            "method": "dom_overlay",
            "evidence": evidence[:2],
            "score": 10,
            "paid_flag": paid_flag,
            "nlp": nlp,
        }

    if is_paid and is_nlp:
        is_ad, method = True, "both"
    elif is_paid:
        is_ad, method = True, "paid_flag"
    elif is_nlp:
        is_ad, method = True, "nlp"
    else:
        is_ad, method = False, "none"

    if is_ad:
        final_conf = max(paid_flag["confidence"], nlp["confidence"]) if method == "both" else (
            paid_flag["confidence"] if is_paid else nlp["confidence"]
        )
    else:
        final_conf = min(0.6, (paid_flag["confidence"] + nlp["confidence"]) / 2)

    evidence = []
    if is_paid:
        evidence.append("시스템 플래그 감지 (Paid Promotion)")
    if is_nlp and nlp["matched_phrases"]:
        evidence.append(f"설명란 키워드 감지 ({nlp['matched_phrases'][0]['phrase']})")
    if not is_ad:
        evidence.append("광고 신호 없음/불충분")

    return {
        "is_ad": is_ad,
        "confidence": round(final_conf, 3),
        "method": method,
        "evidence": evidence[:2],
        "score": (5 if is_paid else 0) + (3 if is_nlp else 0),
        "paid_flag": paid_flag,
        "nlp": nlp,
    }


# ──────────────────────────────────────────────
# 공개 API: 영상 페이지에서 광고 분석
# ──────────────────────────────────────────────

def analyze_video_for_ad(driver, video_id: str) -> dict:
    """
    영상 페이지를 직접 로드해 광고 여부를 분석.
    우선순위: DOM 오버레이 > ytInitialPlayerResponse 플래그 > NLP 텍스트 분석
    """
    url = f"https://www.youtube.com/watch?v={video_id}"
    print(f"  [광고분석] {video_id}")
    driver.get(url)

    try:
        wait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "ytd-watch-flexy, ytd-app"))
        )
    except Exception:
        pass
    time.sleep(2)

    # ── 프리롤 광고 스킵 ──────────────────────────────────────────────────────
    _skip_ads(driver)
    time.sleep(1.5)

    # ── DOM 오버레이 감지 (신뢰도 최우선) ────────────────────────────────────
    dom_paid = _detect_paid_overlay(driver)
    if dom_paid:
        print(f"    → DOM 오버레이 감지: 유료 광고 포함 확정")

    page_source = driver.page_source

    # ytInitialPlayerResponse
    player_response = _extract_player_response(driver)
    paid_flag = detect_paid_flag(player_response, page_source)

    # 설명란 및 제목 추출 (ytInitialData 또는 DOM)
    title = ""
    description = ""
    pinned_comment = ""

    yt_data = _extract_yt_initial_data(driver)
    if yt_data:
        try:
            vp = yt_data["contents"]["twoColumnWatchNextResults"]["results"]["results"]
            for content in vp.get("contents", []):
                primary = content.get("videoPrimaryInfoRenderer", {})
                if primary:
                    title_runs = primary.get("title", {}).get("runs", [])
                    title = "".join(r.get("text", "") for r in title_runs)

                secondary = content.get("videoSecondaryInfoRenderer", {})
                if secondary:
                    desc_runs = (
                        secondary.get("description", {}).get("runs", [])
                    )
                    description = "".join(r.get("text", "") for r in desc_runs)
        except Exception:
            pass

    # DOM 폴백
    if not title:
        try:
            title_el = driver.find_element(By.CSS_SELECTOR, "h1.ytd-video-primary-info-renderer")
            title = title_el.text.strip()
        except Exception:
            pass

    if not description:
        try:
            desc_el = driver.find_element(By.CSS_SELECTOR, "#description-inline-expander, #description")
            description = desc_el.text.strip()
        except Exception:
            pass

    # 고정 댓글 (옵션)
    try:
        pinned_els = driver.find_elements(By.CSS_SELECTOR, "#pinned-comment-badge-container")
        if pinned_els:
            comment_el = pinned_els[0].find_element(By.XPATH, "../..//yt-formatted-string#content-text")
            pinned_comment = comment_el.text.strip()
    except Exception:
        pass

    nlp = detect_nlp(video_id, title, description, pinned_comment)
    return combine_results(paid_flag, nlp)
