#!/usr/bin/env python3
import argparse
import base64
import json
import os
import sys
import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError


ROOT = "/Users/veso/Documents/verso/skills/xiaohongshu"
STATE_DIR = os.path.join(ROOT, ".state")
STORAGE_PATH = os.path.join(STATE_DIR, "storage.json")
QRCODE_PATH = os.path.join(STATE_DIR, "qrcode.png")
DEFAULT_UPLOAD_WAIT = 360
DEFAULT_PUBLISH_WAIT = 360
DEFAULT_BUTTON_WAIT = 1200
DEFAULT_TAG_WAIT = 60

URL_EXPLORE = "https://www.xiaohongshu.com/explore"
URL_PUBLISH = "https://creator.xiaohongshu.com/publish/publish?source=official"

SELECTOR_LOGIN_OK = ".main-container .user .link-wrapper .channel"
SELECTOR_QRCODE = ".login-container .qrcode-img"

SELECTOR_PUBLISH_TAB = "div.creator-tab"
SELECTOR_UPLOAD_INPUT = ".upload-input"
SELECTOR_FILE_INPUT = "input[type='file']"
SELECTOR_PUBLISH_BUTTON = ".publish-page-publish-btn button.bg-red"
SELECTOR_PUBLISH_FALLBACKS = [
    ".publish-page-publish-btn button",
    "div.footer-container button",
    "div.footer-container button:has-text(\"发布\")",
    "div.publish-footer button",
    "div.publish-footer button:has-text(\"发布\")",
    "button:has(span:has-text(\"发布\"))",
    "button:has-text(\"发布\")",
    "button:has-text(\"发布笔记\")",
]
SELECTOR_TITLE_INPUT = "div.d-input input"
SELECTOR_CONTENT_EDITOR = "div.ql-editor"
SELECTOR_CONTENT_PLACEHOLDER = "p[data-placeholder]"
SELECTOR_TOPIC_CONTAINER = "#creator-editor-topic-container"
SELECTOR_TITLE_MAX_SUFFIX = "div.title-container div.max_suffix"
SELECTOR_CONTENT_LENGTH_ERROR = "div.edit-container div.length-error"

SELECTOR_COMMENT_INPUT_CLICK = "div.input-box div.content-edit span"
SELECTOR_COMMENT_INPUT = "div.input-box div.content-edit p.content-input"
SELECTOR_COMMENT_SUBMIT = "div.bottom button.submit"
SELECTOR_ACCESS_WRAPPER = ".access-wrapper, .error-wrapper, .not-found-wrapper, .blocked-wrapper"
SELECTOR_END_CONTAINER = ".end-container"
SELECTOR_COMMENT_ITEM = ".parent-comment"
SELECTOR_SHOW_MORE = ".show-more"

SELECTOR_LIKE_BUTTON = ".interact-container .left .like-lottie"
SELECTOR_COLLECT_BUTTON = ".interact-container .left .reds-icon.collect-icon"


def _ensure_state_dir() -> None:
    os.makedirs(STATE_DIR, exist_ok=True)


def _json_out(payload: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")


def _err(msg: str, extra: Optional[Dict[str, Any]] = None, code: int = 1) -> None:
    payload = {"status": "error", "error": msg}
    if extra:
        payload["extra"] = extra
    _json_out(payload)
    sys.exit(code)


@contextmanager
def _browser_context(headless: bool):
    _ensure_state_dir()
    with sync_playwright() as p:
        env_headless = os.environ.get("XHS_HEADLESS")
        if env_headless is not None:
            headless = env_headless not in ("0", "false", "False")
        geo_mode = os.environ.get("XHS_GEO", "deny").lower()
        launch_args = []
        if geo_mode == "deny":
            launch_args.extend([
                "--deny-permission-prompts",
                "--disable-geolocation",
            ])
        browser = p.chromium.launch(headless=headless, args=launch_args)
        context_kwargs = {}
        if os.path.exists(STORAGE_PATH):
            context_kwargs["storage_state"] = STORAGE_PATH
        # Pre-grant geolocation to avoid browser permission prompt blocking clicks.
        if geo_mode != "deny":
            context_kwargs["geolocation"] = {"latitude": 0.0, "longitude": 0.0}
        context = browser.new_context(**context_kwargs)
        try:
            if geo_mode != "deny":
                context.grant_permissions(["geolocation"], origin="https://www.xiaohongshu.com")
        except Exception:
            pass
        try:
            yield context
        finally:
            try:
                context.storage_state(path=STORAGE_PATH)
            except Exception:
                pass
            context.close()
            browser.close()


def _is_logged_in(page) -> bool:
    try:
        return page.locator(SELECTOR_LOGIN_OK).count() > 0
    except Exception:
        return False


def _wait_dom_stable(page, timeout_ms: int = 60000) -> None:
    page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)
    try:
        page.wait_for_load_state("networkidle", timeout=timeout_ms)
    except Exception:
        pass
    try:
        page.wait_for_selector("#app *", timeout=timeout_ms)
    except Exception:
        pass
    time.sleep(1)


def _navigate(page, url: str) -> None:
    page.goto(url, wait_until="domcontentloaded")
    _wait_dom_stable(page)


def _check_page_accessible(page) -> None:
    try:
        if page.locator(SELECTOR_ACCESS_WRAPPER).count() == 0:
            return
        text = page.locator(SELECTOR_ACCESS_WRAPPER).first.inner_text().strip()
        if not text:
            return
        keywords = [
            "当前笔记暂时无法浏览",
            "该内容因违规已被删除",
            "该笔记已被删除",
            "内容不存在",
            "笔记不存在",
            "已失效",
            "私密笔记",
            "仅作者可见",
            "因用户设置，你无法查看",
            "因违规无法查看",
        ]
        for kw in keywords:
            if kw in text:
                _err(f"feed not accessible: {kw}")
        _err(f"feed not accessible: {text}")
    except Exception:
        return


def _get_initial_state_json(page, path: str) -> Optional[str]:
    script = f"""
    () => {{
      try {{
        const state = window.__INITIAL_STATE__;
        if (!state) return "";
        const value = {path};
        if (!value) return "";
        const data = value.value !== undefined ? value.value : value._value;
        return JSON.stringify(data ?? value);
      }} catch (e) {{
        return "";
      }}
    }}
    """
    return page.evaluate(script)


def check_login() -> None:
    with _browser_context(headless=True) as context:
        page = context.new_page()
        _navigate(page, URL_EXPLORE)
        logged_in = _is_logged_in(page)
        _json_out({"status": "ok", "logged_in": logged_in})


def get_login_qrcode(wait: int) -> None:
    with _browser_context(headless=False) as context:
        page = context.new_page()
        _navigate(page, URL_EXPLORE)
        if _is_logged_in(page):
            _json_out({"status": "ok", "logged_in": True})
            return
        try:
            page.wait_for_selector(SELECTOR_QRCODE, timeout=30000)
        except PlaywrightTimeoutError:
            _err("qrcode not found")
        src = page.locator(SELECTOR_QRCODE).get_attribute("src")
        if not src:
            _err("qrcode src empty")
        if src.startswith("data:image"):
            data = src.split(",", 1)[-1]
            try:
                png = base64.b64decode(data)
                with open(QRCODE_PATH, "wb") as f:
                    f.write(png)
            except Exception:
                pass
        _json_out({"status": "ok", "logged_in": False, "qrcode_src": src, "qrcode_path": QRCODE_PATH})
        if wait > 0:
            deadline = time.time() + wait
            while time.time() < deadline:
                if _is_logged_in(page):
                    _json_out({"status": "ok", "logged_in": True})
                    return
                time.sleep(0.5)


def wait_for_login(timeout: int) -> None:
    with _browser_context(headless=False) as context:
        page = context.new_page()
        _navigate(page, URL_EXPLORE)
        deadline = time.time() + timeout
        while time.time() < deadline:
            if _is_logged_in(page):
                _json_out({"status": "ok", "logged_in": True})
                return
            time.sleep(0.5)
        _err("login timeout")


def delete_cookies() -> None:
    if os.path.exists(STORAGE_PATH):
        os.remove(STORAGE_PATH)
    _json_out({"status": "ok", "deleted": True, "storage_path": STORAGE_PATH})


def _click_publish_tab(page, tab_text: str) -> None:
    page.wait_for_selector(SELECTOR_PUBLISH_TAB, timeout=30000)
    tabs = page.locator(SELECTOR_PUBLISH_TAB).all()
    for tab in tabs:
        try:
            text = tab.inner_text().strip()
            if text == tab_text:
                tab.click()
                return
        except Exception:
            continue
    _err(f"publish tab not found: {tab_text}")

def _remove_popover(page) -> None:
    try:
        if page.locator("div.d-popover").count() > 0:
            page.locator("div.d-popover").first.evaluate("el => el.remove()")
            time.sleep(0.2)
    except Exception:
        pass
    try:
        page.mouse.move(420, 40)
        page.mouse.click(420, 40)
    except Exception:
        pass


def _upload_images(page, image_paths: List[str]) -> None:
    valid_paths = [p for p in image_paths if os.path.exists(p)]
    if not valid_paths:
        _err("no valid image paths")
    for idx, path in enumerate(valid_paths):
        selector = SELECTOR_UPLOAD_INPUT if idx == 0 else SELECTOR_FILE_INPUT
        _remove_popover(page)
        page.set_input_files(selector, path)
        _wait_for_image_upload(page, idx + 1)
        time.sleep(1)


def _wait_for_image_upload(page, expected_count: int) -> None:
    timeout = int(os.environ.get("XHS_UPLOAD_WAIT", DEFAULT_UPLOAD_WAIT))
    deadline = time.time() + timeout
    while time.time() < deadline:
        count = page.locator(".img-preview-area .pr").count()
        if count >= expected_count:
            return
        time.sleep(0.5)
    _err(f"image upload timeout at {expected_count}", extra={"timeout": timeout})


def _content_element(page):
    if page.locator(SELECTOR_CONTENT_EDITOR).count() > 0:
        return page.locator(SELECTOR_CONTENT_EDITOR).first
    if page.locator("[contenteditable='true']").count() > 0:
        return page.locator("[contenteditable='true']").first
    # placeholder fallback
    elems = page.locator(SELECTOR_CONTENT_PLACEHOLDER).all()
    for el in elems:
        placeholder = el.get_attribute("data-placeholder")
        if placeholder and "输入正文描述" in placeholder:
            # walk up to role=textbox
            current = el
            for _ in range(5):
                parent = current.locator("..")
                role = parent.get_attribute("role")
                if role == "textbox":
                    return parent
                current = parent
    return None

def _check_title_length(page) -> None:
    if page.locator(SELECTOR_TITLE_MAX_SUFFIX).count() == 0:
        return
    text = page.locator(SELECTOR_TITLE_MAX_SUFFIX).first.inner_text().strip()
    if text:
        _err(f"title length exceeded: {text}")


def _check_content_length(page) -> None:
    if page.locator(SELECTOR_CONTENT_LENGTH_ERROR).count() == 0:
        return
    text = page.locator(SELECTOR_CONTENT_LENGTH_ERROR).first.inner_text().strip()
    if text:
        _err(f"content length exceeded: {text}")


def _input_tags(content_locator, tags: List[str]) -> None:
    if not tags:
        return
    if os.environ.get("XHS_SKIP_TAGS") in ("1", "true", "True"):
        return
    # Move cursor into editor
    tag_wait = int(os.environ.get("XHS_TAG_WAIT", DEFAULT_TAG_WAIT))
    try:
        content_locator.scroll_into_view_if_needed()
    except Exception:
        pass
    try:
        content_locator.wait_for(state="visible", timeout=tag_wait * 1000)
        content_locator.click(timeout=tag_wait * 1000, force=True)
    except Exception:
        try:
            content_locator.evaluate("el => el.focus()")
        except Exception:
            return
    for tag in tags[:10]:
        tag = tag.lstrip("#")
        try:
            content_locator.type("#" + tag, delay=50)
        except Exception:
            return
        time.sleep(0.8)
        # try suggestion
        items = content_locator.page.locator(SELECTOR_TOPIC_CONTAINER + " .item")
        if items.count() > 0:
            try:
                items.first.click(timeout=3000)
            except Exception:
                # fallback: dismiss autocomplete and keep tag as plain text
                try:
                    content_locator.press("Escape")
                except Exception:
                    pass
                content_locator.type(" ", delay=20)
        else:
            content_locator.type(" ", delay=20)
        time.sleep(0.3)


def _set_schedule_publish(page, schedule: str) -> None:
    page.locator(".post-time-wrapper .d-switch").click()
    time.sleep(0.8)
    input_box = page.locator(".date-picker-container input").first
    input_box.fill(schedule)


def publish_content(title: str, content: str, images: List[str], tags: List[str], schedule: Optional[str]) -> None:
    if len(title) > 20:
        _err("title length exceeds 20 characters", extra={"length": len(title)})
    tags = [t.strip() for t in (tags or []) if t and t.strip()]
    with _browser_context(headless=True) as context:
        page = context.new_page()
        _navigate(page, URL_PUBLISH)
        _click_publish_tab(page, "上传图文")
        _upload_images(page, images)
        page.locator(SELECTOR_TITLE_INPUT).fill(title)
        time.sleep(0.5)
        _check_title_length(page)
        content_el = _content_element(page)
        if content_el is None:
            _err("content editor not found")
        content_el.fill("")
        content_el.type(content, delay=10)
        _input_tags(content_el, tags)
        _check_content_length(page)
        if schedule:
            _set_schedule_publish(page, schedule)
        time.sleep(10)
        _scroll_to_publish_area(page)
        _wait_for_publish_button_clickable(page)
        _click_publish_button_with_retry(page)
        _wait_for_publish_result(page)
        _json_out({"status": "ok", "published": True})


def publish_video(title: str, content: str, video: str, tags: List[str], schedule: Optional[str]) -> None:
    if len(title) > 20:
        _err("title length exceeds 20 characters", extra={"length": len(title)})
    if not os.path.exists(video):
        _err("video path not found")
    tags = [t.strip() for t in (tags or []) if t and t.strip()]
    with _browser_context(headless=True) as context:
        page = context.new_page()
        _navigate(page, URL_PUBLISH)
        _click_publish_tab(page, "上传视频")
        if page.locator(SELECTOR_UPLOAD_INPUT).count() > 0:
            page.set_input_files(SELECTOR_UPLOAD_INPUT, video)
        else:
            page.set_input_files(SELECTOR_FILE_INPUT, video)
        _wait_for_publish_button(page, timeout=600)
        page.locator(SELECTOR_TITLE_INPUT).fill(title)
        _check_title_length(page)
        content_el = _content_element(page)
        if content_el is None:
            _err("content editor not found")
        content_el.fill("")
        content_el.type(content, delay=10)
        _input_tags(content_el, tags)
        _check_content_length(page)
        if schedule:
            _set_schedule_publish(page, schedule)
        time.sleep(10)
        _scroll_to_publish_area(page)
        _wait_for_publish_button_clickable(page)
        _click_publish_button_with_retry(page)
        _wait_for_publish_result(page)
        _json_out({"status": "ok", "published": True})


def _wait_for_publish_button(page, timeout: int) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        # Prefer the exact "发布" button structure.
        exact = page.locator("button:has(span.d-text:has-text(\"发布\"))")
        if exact.count() > 0:
            btn = exact.nth(exact.count() - 1)
            try:
                btn.scroll_into_view_if_needed()
            except Exception:
                pass
            disabled = btn.get_attribute("disabled")
            aria_disabled = btn.get_attribute("aria-disabled")
            cls = btn.get_attribute("class") or ""
            if disabled is None and aria_disabled not in ("true", "1") and "disabled" not in cls:
                return
        btn = page.locator(SELECTOR_PUBLISH_BUTTON)
        if btn.count() == 0:
            for sel in SELECTOR_PUBLISH_FALLBACKS:
                if page.locator(sel).count() > 0:
                    btn = page.locator(sel)
                    break
        if btn.count() > 0:
            disabled = btn.first.get_attribute("disabled")
            aria_disabled = btn.first.get_attribute("aria-disabled")
            cls = btn.first.get_attribute("class") or ""
            if disabled is None and aria_disabled not in ("true", "1") and "disabled" not in cls:
                return
        time.sleep(1)
    _err("publish button not clickable (timeout)")


def _wait_for_publish_button_clickable(page) -> None:
    timeout = int(os.environ.get("XHS_BUTTON_WAIT", DEFAULT_BUTTON_WAIT))
    deadline = time.time() + timeout
    selector = SELECTOR_PUBLISH_BUTTON
    while time.time() < deadline:
        btn = page.locator(selector)
        if btn.count() > 0:
            try:
                if btn.first.is_visible():
                    disabled = btn.first.get_attribute("disabled")
                    aria_disabled = btn.first.get_attribute("aria-disabled")
                    cls = btn.first.get_attribute("class") or ""
                    if disabled is None and aria_disabled not in ("true", "1") and "disabled" not in cls:
                        return
            except Exception:
                pass
        time.sleep(1)
    _err("publish button not clickable (timeout)", extra={"timeout": timeout, "publish_button": _publish_button_state(page)})


def _click_publish_button(page) -> bool:
    selectors = [SELECTOR_PUBLISH_BUTTON] + SELECTOR_PUBLISH_FALLBACKS
    for sel in selectors:
        loc = page.locator(sel)
        if loc.count() == 0:
            continue
        # Prefer the last visible button (usually the bottom publish button).
        for idx in range(loc.count() - 1, -1, -1):
            candidate = loc.nth(idx)
            try:
                candidate.scroll_into_view_if_needed()
            except Exception:
                pass
            try:
                if candidate.get_attribute("disabled") is not None:
                    continue
                if candidate.get_attribute("aria-disabled") in ("true", "1"):
                    continue
            except Exception:
                pass
            try:
                candidate.click(timeout=2000, force=True)
                return True
            except Exception:
                # Fallback to coordinate click.
                try:
                    box = candidate.bounding_box()
                    if box:
                        page.mouse.click(
                            box["x"] + box["width"] / 2,
                            box["y"] + box["height"] / 2,
                        )
                        return True
                except Exception:
                    continue
    # Role-based fallback.
    try:
        role_btns = page.get_by_role("button", name="发布")
        if role_btns.count() > 0:
            btn = role_btns.nth(role_btns.count() - 1)
            btn.scroll_into_view_if_needed()
            btn.click(timeout=2000, force=True)
            return True
    except Exception:
        pass
    # JS fallback: click the bottom-most visible enabled button containing "发布".
    try:
        clicked = page.evaluate(
            """() => {
                const bySpan = Array.from(document.querySelectorAll('span.d-text'))
                  .filter(s => (s.innerText || '').trim() === '发布')
                  .map(s => s.closest('button'))
                  .filter(Boolean);
                if (bySpan.length) {
                  bySpan.sort((a,b) => {
                    const ra = a.getBoundingClientRect();
                    const rb = b.getBoundingClientRect();
                    return (rb.y + rb.height) - (ra.y + ra.height);
                  });
                  const target = bySpan[0];
                  const disabled = target.getAttribute('disabled') || target.getAttribute('aria-disabled');
                  if (!disabled) {
                    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    return true;
                  }
                }
                const btns = Array.from(document.querySelectorAll('button')).filter(b => {
                  const t = (b.innerText || '').trim();
                  if (!t.includes('发布')) return false;
                  const style = window.getComputedStyle(b);
                  if (style.display === 'none' || style.visibility === 'hidden') return false;
                  const rect = b.getBoundingClientRect();
                  return rect.width > 40 && rect.height > 24;
                });
                if (!btns.length) return false;
                btns.sort((a,b) => {
                  const ra = a.getBoundingClientRect();
                  const rb = b.getBoundingClientRect();
                  const scoreA = (ra.y + ra.height) * 1000 + ra.width;
                  const scoreB = (rb.y + rb.height) * 1000 + rb.width;
                  return scoreB - scoreA;
                });
                const target = btns[0];
                const disabled = target.getAttribute('disabled') || target.getAttribute('aria-disabled');
                if (disabled) return false;
                target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                return true;
            }"""
        )
        if clicked:
            return True
    except Exception:
        pass
    return False


def _publish_button_state(page) -> Dict[str, Any]:
    try:
        return page.evaluate(
            """() => {
                const btns = Array.from(document.querySelectorAll('button'))
                  .filter(b => (b.innerText || '').trim().includes('发布'))
                  .map(b => {
                    const rect = b.getBoundingClientRect();
                    return {
                      text: (b.innerText || '').trim(),
                      disabled: !!(b.getAttribute('disabled') || b.getAttribute('aria-disabled')),
                      className: b.className || '',
                      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
                    };
                  })
                  .sort((a,b) => (b.rect.y + b.rect.h) - (a.rect.y + a.rect.h));
                return { found: btns.length > 0, candidates: btns.slice(0, 5) };
            }"""
        )
    except Exception:
        return {"found": False}


def _click_publish_button_with_retry(page, attempts: int = 5, wait_seconds: float = 2.0) -> None:
    for _ in range(attempts):
        try:
            page.mouse.wheel(0, 1200)
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        except Exception:
            pass
        if _click_publish_button(page):
            return
        time.sleep(wait_seconds)
    _err("failed to click publish button", extra={"publish_button": _publish_button_state(page)})


def _scroll_to_publish_area(page) -> None:
    # Aggressively scroll to bottom to expose the footer publish button.
    for _ in range(6):
        try:
            page.mouse.wheel(0, 1400)
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            time.sleep(0.5)
        except Exception:
            pass


def _wait_for_publish_result(page) -> None:
    timeout = int(os.environ.get("XHS_PUBLISH_WAIT", DEFAULT_PUBLISH_WAIT))
    deadline = time.time() + timeout
    last_url = page.url
    success_markers = ["发布成功", "审核中", "已发布", "发布完成", "发布中"]
    while time.time() < deadline:
        try:
            if page.url != last_url and "publish/publish" not in page.url:
                time.sleep(5)
                return
        except Exception:
            pass
        try:
            toast = page.locator("div:has-text(\"发布成功\"), div:has-text(\"审核中\"), div:has-text(\"已发布\"), div:has-text(\"发布完成\"), div:has-text(\"发布中\")")
            if toast.count() > 0:
                return
        except Exception:
            pass
        time.sleep(1)
    _err("publish result wait timeout", extra={"timeout": timeout})


def list_feeds() -> None:
    with _browser_context(headless=True) as context:
        page = context.new_page()
        _navigate(page, "https://www.xiaohongshu.com")
        data = _get_initial_state_json(page, "state.feed && state.feed.feeds")
        if not data:
            _err("no feeds")
        _json_out({"status": "ok", "feeds": json.loads(data)})


def search_feeds(keyword: str, filters: Optional[Dict[str, str]]) -> None:
    with _browser_context(headless=True) as context:
        page = context.new_page()
        url = f"https://www.xiaohongshu.com/search_result?keyword={keyword}&source=web_explore_feed"
        _navigate(page, url)
        # apply filters (best-effort)
        if filters:
            try:
                page.locator("div.filter").first.hover()
                page.wait_for_selector("div.filter-panel", timeout=10000)
                _apply_search_filters(page, filters)
            except Exception:
                pass
        data = _get_initial_state_json(page, "state.search && state.search.feeds")
        if not data:
            _err("no search feeds")
        _json_out({"status": "ok", "feeds": json.loads(data)})


FILTER_MAP = {
    "sort_by": ["综合", "最新", "最多点赞", "最多评论", "最多收藏"],
    "note_type": ["不限", "视频", "图文"],
    "publish_time": ["不限", "一天内", "一周内", "半年内"],
    "search_scope": ["不限", "已看过", "未看过", "已关注"],
    "location": ["不限", "同城", "附近"],
}


def _apply_search_filters(page, filters: Dict[str, str]) -> None:
    keys = ["sort_by", "note_type", "publish_time", "search_scope", "location"]
    for group_idx, key in enumerate(keys, start=1):
        if key not in filters:
            continue
        value = filters[key]
        options = FILTER_MAP.get(key, [])
        if value not in options:
            continue
        tag_idx = options.index(value) + 1
        selector = f"div.filter-panel div.filters:nth-child({group_idx}) div.tags:nth-child({tag_idx})"
        page.locator(selector).first.click()
    page.wait_for_load_state("networkidle")


def get_feed_detail(feed_id: str, xsec_token: Optional[str]) -> None:
    with _browser_context(headless=True) as context:
        page = context.new_page()
        if xsec_token:
            url = f"https://www.xiaohongshu.com/explore/{feed_id}?xsec_token={xsec_token}&xsec_source=pc_feed"
        else:
            url = f"https://www.xiaohongshu.com/explore/{feed_id}"
        _navigate(page, url)
        _check_page_accessible(page)
        data = _get_initial_state_json(page, "state.note && state.note.noteDetailMap")
        if not data:
            _err("no feed detail")
        detail_map = json.loads(data)
        detail = detail_map.get(feed_id, detail_map)
        # best-effort xsec_token if missing
        if isinstance(detail, dict):
            note = detail.get("note") or {}
            if note and not xsec_token:
                xsec_token = note.get("xsecToken")
        _json_out({"status": "ok", "detail": detail, "xsec_token": xsec_token})


def get_feed_detail_with_comments(
    feed_id: str,
    xsec_token: Optional[str],
    load_all: bool,
    click_more_replies: bool,
    max_replies_threshold: int,
    max_comment_items: int,
    scroll_speed: str,
) -> None:
    with _browser_context(headless=True) as context:
        page = context.new_page()
        if xsec_token:
            url = f"https://www.xiaohongshu.com/explore/{feed_id}?xsec_token={xsec_token}&xsec_source=pc_feed"
        else:
            url = f"https://www.xiaohongshu.com/explore/{feed_id}"
        _navigate(page, url)
        _check_page_accessible(page)
        if load_all:
            _load_all_comments(
                page,
                click_more_replies=click_more_replies,
                max_replies_threshold=max_replies_threshold,
                max_comment_items=max_comment_items,
                scroll_speed=scroll_speed,
            )
        data = _get_initial_state_json(page, "state.note && state.note.noteDetailMap")
        if not data:
            _err("no feed detail")
        detail_map = json.loads(data)
        detail = detail_map.get(feed_id, detail_map)
        if isinstance(detail, dict):
            note = detail.get("note") or {}
            if note and not xsec_token:
                xsec_token = note.get("xsecToken")
        _json_out({"status": "ok", "detail": detail, "xsec_token": xsec_token})


def user_profile(user_id: str, xsec_token: str) -> None:
    with _browser_context(headless=True) as context:
        page = context.new_page()
        url = f"https://www.xiaohongshu.com/user/profile/{user_id}?xsec_token={xsec_token}&xsec_source=pc_note"
        _navigate(page, url)
        data = _get_initial_state_json(page, "state.user && state.user.userPageData")
        if not data:
            _err("no user profile")
        _json_out({"status": "ok", "profile": json.loads(data)})


def post_comment(feed_id: str, xsec_token: str, content: str) -> None:
    with _browser_context(headless=True) as context:
        page = context.new_page()
        url = f"https://www.xiaohongshu.com/explore/{feed_id}?xsec_token={xsec_token}&xsec_source=pc_feed"
        _navigate(page, url)
        _check_page_accessible(page)
        page.locator(SELECTOR_COMMENT_INPUT_CLICK).first.click()
        page.locator(SELECTOR_COMMENT_INPUT).first.fill(content)
        time.sleep(0.5)
        page.locator(SELECTOR_COMMENT_SUBMIT).first.click()
        time.sleep(1)
        _json_out({"status": "ok", "commented": True})


def reply_comment(feed_id: str, xsec_token: str, comment_id: str, user_id: str, content: str) -> None:
    with _browser_context(headless=True) as context:
        page = context.new_page()
        url = f"https://www.xiaohongshu.com/explore/{feed_id}?xsec_token={xsec_token}&xsec_source=pc_feed"
        _navigate(page, url)
        _check_page_accessible(page)
        _load_all_comments(
            page,
            click_more_replies=False,
            max_replies_threshold=0,
            max_comment_items=0,
            scroll_speed="normal",
        )
        comment_el = _find_comment_element(page, comment_id, user_id)
        if comment_el is None:
            _err("comment not found")
        comment_el.scroll_into_view_if_needed()
        comment_el.locator(".right .interactions .reply").first.click()
        page.locator(SELECTOR_COMMENT_INPUT).first.fill(content)
        page.locator(SELECTOR_COMMENT_SUBMIT).first.click()
        time.sleep(1)
        _json_out({"status": "ok", "replied": True})


def _find_comment_element(page, comment_id: str, user_id: str):
    # scroll to comments area
    try:
        if page.locator(".comments-container").count() > 0:
            page.locator(".comments-container").first.scroll_into_view_if_needed()
            time.sleep(0.5)
    except Exception:
        pass
    stagnant = 0
    last_count = 0
    for _ in range(100):
        comments = page.locator(SELECTOR_COMMENT_ITEM).all()
        for el in comments:
            cid = el.get_attribute("data-id") or el.get_attribute("data-comment-id")
            uid = el.get_attribute("data-user-id") or el.get_attribute("data-uid")
            if cid == comment_id and (not user_id or uid == user_id):
                return el
        if page.locator(SELECTOR_END_CONTAINER).count() > 0:
            return None
        count = len(comments)
        if count == last_count:
            stagnant += 1
        else:
            stagnant = 0
        last_count = count
        if stagnant >= 10:
            return None
        page.mouse.wheel(0, 800)
        time.sleep(0.8)
    return None


def _load_all_comments(
    page,
    click_more_replies: bool,
    max_replies_threshold: int,
    max_comment_items: int,
    scroll_speed: str,
) -> None:
    def _sleep_by_speed():
        if scroll_speed == "slow":
            time.sleep(1.2)
        elif scroll_speed == "fast":
            time.sleep(0.4)
        else:
            time.sleep(0.7)

    stagnant = 0
    last_count = 0
    for _ in range(500):
        comments = page.locator(SELECTOR_COMMENT_ITEM).all()
        count = len(comments)
        if max_comment_items and count >= max_comment_items:
            return
        if count == last_count:
            stagnant += 1
        else:
            stagnant = 0
        last_count = count

        if page.locator(SELECTOR_END_CONTAINER).count() > 0:
            return
        if stagnant >= 20:
            return

        if click_more_replies and page.locator(SELECTOR_SHOW_MORE).count() > 0:
            for el in page.locator(SELECTOR_SHOW_MORE).all()[:3]:
                try:
                    text = el.inner_text().strip()
                    if max_replies_threshold > 0 and text:
                        # text like "展开 12 条回复"
                        nums = [int(s) for s in text.split() if s.isdigit()]
                        if nums and nums[0] > max_replies_threshold:
                            continue
                    el.click()
                    time.sleep(0.4)
                except Exception:
                    continue

        page.mouse.wheel(0, 800)
        _sleep_by_speed()


def _get_interact_state(page, feed_id: str) -> Tuple[bool, bool]:
    data = _get_initial_state_json(page, "state.note && state.note.noteDetailMap")
    if not data:
        return False, False
    detail_map = json.loads(data)
    detail = detail_map.get(feed_id, {})
    note = detail.get("note", {})
    interact = note.get("interactInfo", {})
    return bool(interact.get("liked")), bool(interact.get("collected"))


def like_feed(feed_id: str, xsec_token: str, target: bool) -> None:
    with _browser_context(headless=True) as context:
        page = context.new_page()
        url = f"https://www.xiaohongshu.com/explore/{feed_id}?xsec_token={xsec_token}&xsec_source=pc_feed"
        _navigate(page, url)
        _check_page_accessible(page)
        liked, _ = _get_interact_state(page, feed_id)
        if target and liked:
            _json_out({"status": "ok", "liked": True})
            return
        if not target and not liked:
            _json_out({"status": "ok", "liked": False})
            return
        page.locator(SELECTOR_LIKE_BUTTON).first.click()
        time.sleep(2)
        liked, _ = _get_interact_state(page, feed_id)
        _json_out({"status": "ok", "liked": liked})


def favorite_feed(feed_id: str, xsec_token: str, target: bool) -> None:
    with _browser_context(headless=True) as context:
        page = context.new_page()
        url = f"https://www.xiaohongshu.com/explore/{feed_id}?xsec_token={xsec_token}&xsec_source=pc_feed"
        _navigate(page, url)
        _check_page_accessible(page)
        _, collected = _get_interact_state(page, feed_id)
        if target and collected:
            _json_out({"status": "ok", "collected": True})
            return
        if not target and not collected:
            _json_out({"status": "ok", "collected": False})
            return
        page.locator(SELECTOR_COLLECT_BUTTON).first.click()
        time.sleep(2)
        _, collected = _get_interact_state(page, feed_id)
        _json_out({"status": "ok", "collected": collected})


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd")

    sub.add_parser("check_login")
    qr = sub.add_parser("get_login_qrcode")
    qr.add_argument("--wait", type=int, default=0)
    wait = sub.add_parser("wait_for_login")
    wait.add_argument("--timeout", type=int, default=120)

    sub.add_parser("delete_cookies")

    pub = sub.add_parser("publish_content")
    pub.add_argument("--title", required=True)
    pub.add_argument("--content", required=True)
    pub.add_argument("--images", nargs="+", required=True)
    pub.add_argument("--tags", nargs="*", default=[])
    pub.add_argument("--schedule", default=None)

    pubv = sub.add_parser("publish_video")
    pubv.add_argument("--title", required=True)
    pubv.add_argument("--content", required=True)
    pubv.add_argument("--video", required=True)
    pubv.add_argument("--tags", nargs="*", default=[])
    pubv.add_argument("--schedule", default=None)

    sub.add_parser("list_feeds")

    search = sub.add_parser("search_feeds")
    search.add_argument("--keyword", required=True)
    search.add_argument("--sort_by")
    search.add_argument("--note_type")
    search.add_argument("--publish_time")
    search.add_argument("--search_scope")
    search.add_argument("--location")

    detail = sub.add_parser("get_feed_detail")
    detail.add_argument("--feed_id", required=True)
    detail.add_argument("--xsec_token", required=False)
    detail.add_argument("--load_all_comments", action="store_true")
    detail.add_argument("--click_more_replies", action="store_true")
    detail.add_argument("--max_replies_threshold", type=int, default=0)
    detail.add_argument("--max_comment_items", type=int, default=0)
    detail.add_argument("--scroll_speed", choices=["slow", "normal", "fast"], default="normal")

    profile = sub.add_parser("user_profile")
    profile.add_argument("--user_id", required=True)
    profile.add_argument("--xsec_token", required=True)

    comment = sub.add_parser("post_comment")
    comment.add_argument("--feed_id", required=True)
    comment.add_argument("--xsec_token", required=True)
    comment.add_argument("--content", required=True)

    reply = sub.add_parser("reply_comment")
    reply.add_argument("--feed_id", required=True)
    reply.add_argument("--xsec_token", required=True)
    reply.add_argument("--comment_id", required=True)
    reply.add_argument("--user_id", required=True)
    reply.add_argument("--content", required=True)

    like = sub.add_parser("like_feed")
    like.add_argument("--feed_id", required=True)
    like.add_argument("--xsec_token", required=True)
    unlike = sub.add_parser("unlike_feed")
    unlike.add_argument("--feed_id", required=True)
    unlike.add_argument("--xsec_token", required=True)

    fav = sub.add_parser("favorite_feed")
    fav.add_argument("--feed_id", required=True)
    fav.add_argument("--xsec_token", required=True)
    unfav = sub.add_parser("unfavorite_feed")
    unfav.add_argument("--feed_id", required=True)
    unfav.add_argument("--xsec_token", required=True)

    args = parser.parse_args()

    if args.cmd == "check_login":
        check_login()
    elif args.cmd == "get_login_qrcode":
        get_login_qrcode(args.wait)
    elif args.cmd == "wait_for_login":
        wait_for_login(args.timeout)
    elif args.cmd == "delete_cookies":
        delete_cookies()
    elif args.cmd == "publish_content":
        publish_content(args.title, args.content, args.images, args.tags, args.schedule)
    elif args.cmd == "publish_video":
        publish_video(args.title, args.content, args.video, args.tags, args.schedule)
    elif args.cmd == "list_feeds":
        list_feeds()
    elif args.cmd == "search_feeds":
        filters = {k: v for k, v in {
            "sort_by": args.sort_by,
            "note_type": args.note_type,
            "publish_time": args.publish_time,
            "search_scope": args.search_scope,
            "location": args.location,
        }.items() if v}
        search_feeds(args.keyword, filters if filters else None)
    elif args.cmd == "get_feed_detail":
        if args.load_all_comments:
            get_feed_detail_with_comments(
                args.feed_id,
                args.xsec_token,
                True,
                args.click_more_replies,
                args.max_replies_threshold,
                args.max_comment_items,
                args.scroll_speed,
            )
        else:
            get_feed_detail(args.feed_id, args.xsec_token)
    elif args.cmd == "user_profile":
        user_profile(args.user_id, args.xsec_token)
    elif args.cmd == "post_comment":
        post_comment(args.feed_id, args.xsec_token, args.content)
    elif args.cmd == "reply_comment":
        reply_comment(args.feed_id, args.xsec_token, args.comment_id, args.user_id, args.content)
    elif args.cmd == "like_feed":
        like_feed(args.feed_id, args.xsec_token, True)
    elif args.cmd == "unlike_feed":
        like_feed(args.feed_id, args.xsec_token, False)
    elif args.cmd == "favorite_feed":
        favorite_feed(args.feed_id, args.xsec_token, True)
    elif args.cmd == "unfavorite_feed":
        favorite_feed(args.feed_id, args.xsec_token, False)
    else:
        parser.print_help()
        sys.exit(2)


if __name__ == "__main__":
    main()
