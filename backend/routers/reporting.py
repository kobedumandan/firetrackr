"""Reporter location sessions: the SMS link, the public page it opens, and
the position that page posts back to dispatch."""
import html as _html
import json
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, HTMLResponse

from config import PUBLIC_BASE_URL, SEND_SMS
from models import Users
from schemas import ReporterLocationBody, ReporterSmsBody
from security import require_admin
from services.sms import _normalize_ph_number, _send_philsms
from state import manager, report_session_phones, report_sessions


router = APIRouter(tags=["reporting"])


@router.post("/api/report-sessions/{token}/location", status_code=204)
async def submit_reporter_location(token: str, body: ReporterLocationBody):
    """Called by the reporter page — no auth required."""
    phone = report_session_phones.get(token)
    report_sessions[token] = {
        "lat": body.lat,
        "lng": body.lng,
        "accuracy": body.accuracy,
        "phone": phone,
        "received_at": datetime.now(timezone.utc).isoformat(),
    }
    await manager.broadcast({
        "type": "reporter_location",
        "data": {
            "token":    token,
            "lat":      body.lat,
            "lng":      body.lng,
            "accuracy": body.accuracy,
            "phone":    phone,
        },
    })


@router.get("/api/report-sessions")
def list_report_sessions(_auth: Users = Depends(require_admin)):
    """All reporter sessions with a received location — used to rehydrate map
    pins after a dashboard reload (WS only pushes new events)."""
    out = []
    for token, loc in report_sessions.items():
        if not loc:
            continue
        out.append({
            "token":       token,
            "coords":      [loc["lat"], loc["lng"]],
            "accuracy":    loc.get("accuracy"),
            "phone":       loc.get("phone"),
            "received_at": loc.get("received_at"),
        })
    return out


@router.get("/api/report-sessions/{token}")
def get_report_session(token: str, _auth: Users = Depends(require_admin)):
    """Dispatch can poll this as a fallback if WS is unavailable."""
    if token not in report_sessions:
        raise HTTPException(status_code=404, detail="Session not found.")
    loc = report_sessions[token]
    return {
        "coords":      [loc["lat"], loc["lng"]] if loc else None,
        "accuracy":    loc["accuracy"] if loc else None,
        "received_at": loc["received_at"] if loc else None,
    }


@router.post("/api/report-sessions/{token}/send-sms")
async def send_reporter_sms(
    token: str,
    body: ReporterSmsBody,
    _auth: Users = Depends(require_admin),
):
    """Text the reporter a link to the backend-served location page.

    The link points at PUBLIC_BASE_URL (the public origin of this backend), so it
    opens on the reporter's phone. When SEND_SMS is false the SMS is not sent and
    the generated link is returned for manual sharing.
    """
    try:
        recipient = _normalize_ph_number(body.phone_number)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    link = f"{PUBLIC_BASE_URL}/report/{token}"
    message = (
        "BFP FireTrackr: Please share your location to help emergency responders "
        f"reach you. Tap: {link}"
    )

    # Mark the session pending so the dispatcher poll-fallback doesn't 404,
    # and remember the phone so it can prefill the incident form later.
    report_sessions.setdefault(token, None)
    report_session_phones[token] = recipient

    if not SEND_SMS:
        return {"status": "not_sent", "sms_sent": False, "link": link,
                "phone_number": recipient, "detail": "SEND_SMS is disabled."}

    try:
        await _send_philsms(recipient, message)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return {"status": "sent", "sms_sent": True, "link": link, "phone_number": recipient}


@router.get("/report/{token}", response_class=HTMLResponse)
def reporter_page(token: str):
    """Self-contained reporter location page served by the public backend.

    The reporter opens this on their phone, taps to share GPS, and the page
    POSTs to /api/report-sessions/{token}/location (same origin), which
    broadcasts the position to the dispatch dashboard over WebSocket.
    """
    return (
        _REPORTER_PAGE
        .replace("__TOKEN_JS__", json.dumps(token).replace("<", "\\u003c"))
        .replace("__TOKEN_SAFE__", _html.escape(token))
    )


# The dashboard's Axiforma faces, served so the reporter page matches it. Only
# these four weights are exposed; if the frontend isn't deployed alongside the
# backend they 404 and the page falls back to DM Sans.
_FONT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "fonts", "Axiforma")
_REPORT_FONTS = {
    "400": "Axiforma Regular.otf",
    "500": "Axiforma Medium.otf",
    "600": "Axiforma Semi Bold.otf",
    "700": "Axiforma Bold.otf",
}


@router.get("/report-assets/axiforma-{weight}.otf", include_in_schema=False)
def reporter_font(weight: str):
    path = os.path.join(_FONT_DIR, _REPORT_FONTS.get(weight, ""))
    if weight not in _REPORT_FONTS or not os.path.isfile(path):
        raise HTTPException(status_code=404)
    return FileResponse(path, media_type="font/otf",
                        headers={"Cache-Control": "public, max-age=604800"})


# Plain template (not an f-string) so the CSS/JS braces need no escaping.
# Tokens and component shapes mirror the web dashboard (frontend/src/index.css,
# styles/AppModal.css) so the page reads as part of FireTrackr, scaled up for
# phone legibility.
_REPORTER_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#101011" media="(prefers-color-scheme: dark)" />
  <meta name="theme-color" content="#f0f3f7" media="(prefers-color-scheme: light)" />
  <meta name="robots" content="noindex" />
  <title>Share Location · FireTrackr</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400..700&display=swap" rel="stylesheet" />
  <style>
    @font-face { font-family: "Axiforma"; src: url("/report-assets/axiforma-400.otf") format("opentype"); font-weight: 400; font-display: swap; }
    @font-face { font-family: "Axiforma"; src: url("/report-assets/axiforma-500.otf") format("opentype"); font-weight: 500; font-display: swap; }
    @font-face { font-family: "Axiforma"; src: url("/report-assets/axiforma-600.otf") format("opentype"); font-weight: 600; font-display: swap; }
    @font-face { font-family: "Axiforma"; src: url("/report-assets/axiforma-700.otf") format("opentype"); font-weight: 700; font-display: swap; }

    /* Dashboard tokens (index.css) — dark is the default, as on the console. */
    :root {
      --bg-base: #101011; --panel: #090909; --bg-hover: #1f1f1f;
      --border: #2e2e2e; --border-dim: #222222;
      --text-primary: #e8edf2; --text-secondary: #8a8b8a; --text-muted: #3d5468;
      --accent-fire: #ff4d1a; --accent-fire-hover: #ff6633; --accent-fire-focus: rgba(255, 77, 26, .6);
      --accent-fire-rgb: 255, 77, 26; --accent-amber-rgb: 255, 176, 32; --accent-green-rgb: 0, 230, 118;
      --accent-amber: #ffb020; --accent-green: #00e676;
      --chip-muted-bg: rgba(61, 84, 104, .2);
      --surface-raise: rgba(255, 255, 255, .05);
      --on-accent: #ffffff;
      --shadow-lg: 0 24px 60px rgba(0, 0, 0, .6);
      --font-ui: "Axiforma", "DM Sans", system-ui, sans-serif;
      --font-span: "DM Sans", system-ui, sans-serif;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg-base: #f0f3f7; --panel: #ffffff; --bg-hover: #e6edf5;
        --border: #d0dce8; --border-dim: #dfe6ee;
        --text-primary: #0d1520; --text-secondary: #3d5a72; --text-muted: #7a95ab;
        --accent-fire: #e8390d; --accent-fire-hover: #c22e08; --accent-fire-focus: rgba(232, 57, 13, .55);
        --accent-fire-rgb: 232, 57, 13; --accent-amber-rgb: 192, 120, 0; --accent-green-rgb: 0, 122, 61;
        --accent-amber: #c07800; --accent-green: #007a3d;
        --chip-muted-bg: rgba(61, 90, 114, .12);
        --surface-raise: rgba(13, 21, 32, .04);
        --shadow-lg: 0 24px 48px rgba(13, 21, 32, .16);
      }
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--bg-base); color: var(--text-primary); font-family: var(--font-ui);
      font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased;
      min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column;
      padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom);
    }
    svg { display: block; flex-shrink: 0; }
    html :focus-visible { outline: 2px solid var(--accent-fire-focus); outline-offset: 2px; }

    .wrap { width: 100%; max-width: 480px; margin: 0 auto; padding: 0 16px; }

    /* ── Top bar: dashboard wordmark ── */
    .bar { display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding-top: 18px; padding-bottom: 16px; }
    .brand { display: flex; align-items: center; gap: 9px; }
    .logo-icon {
      width: 26px; height: 26px; background: var(--accent-fire); flex-shrink: 0;
      clip-path: polygon(50% 0%, 80% 30%, 100% 60%, 70% 80%, 50% 100%, 30% 80%, 0% 60%, 20% 30%);
      animation: flamePulse 2s ease-in-out infinite;
    }
    .logo-text { font-size: 17px; font-weight: 700; letter-spacing: 2px; line-height: 1; padding-top: 3px; }
    .logo-text span { color: var(--accent-fire); }
    .live {
      display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-span);
      font-size: 11px; font-weight: 600; padding: 5px 10px 4px; border-radius: 10px;
      color: var(--accent-fire); background: rgba(var(--accent-fire-rgb), .12);
    }
    .live i { width: 6px; height: 6px; border-radius: 50%; background: currentColor;
      animation: blink 1.4s ease-in-out infinite; }

    /* ── Panel (apm-panel / eim-header) ── */
    .panel {
      background: var(--panel); border: 1px solid var(--border); border-radius: 14px; overflow: hidden;
      box-shadow: var(--shadow-lg), 0 0 0 1px rgba(var(--accent-fire-rgb), .1);
    }
    .head { padding: 20px 20px 16px; border-bottom: 1px solid var(--border-dim); }
    .eyebrow { font-size: 11.5px; color: var(--accent-fire); letter-spacing: .2px; }
    .title { font-size: 21px; font-weight: 600; letter-spacing: -.3px; margin-top: 4px; line-height: 1.25; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .chip { font-family: var(--font-span); font-size: 11px; font-weight: 600; padding: 4px 9px 3px;
      border-radius: 10px; color: var(--text-secondary); background: var(--chip-muted-bg);
      max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chip.code { font-family: var(--font-ui); color: var(--text-primary); }

    .body { padding: 4px 20px 6px; }
    .section { padding: 18px 0 8px; }
    .section + .section { border-top: 1px solid var(--border-dim); }
    .section h3 { font-size: 13.5px; font-weight: 600; margin-bottom: 12px;
      display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .section h3 small { font-size: 12px; font-weight: 400; color: var(--text-secondary); }

    /* ── Result card (adm-result) ── */
    .result {
      --tone-rgb: var(--accent-fire-rgb);
      display: flex; align-items: center; gap: 14px; padding: 14px 16px 12px; border-radius: 10px;
      background: rgba(var(--tone-rgb), .08); border: 1px solid rgba(var(--tone-rgb), .22);
    }
    .result.amber { --tone-rgb: var(--accent-amber-rgb); }
    .result.green { --tone-rgb: var(--accent-green-rgb); }
    .result-icon {
      position: relative; width: 44px; height: 44px; border-radius: 11px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      color: rgb(var(--tone-rgb)); background: rgba(var(--tone-rgb), .14);
    }
    .result-icon.pulse::after {
      content: ""; position: absolute; inset: 0; border-radius: inherit;
      border: 2px solid rgb(var(--tone-rgb)); animation: ring 1.8s cubic-bezier(0, 0, .2, 1) infinite;
    }
    .result-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .result-title { font-size: 15.5px; font-weight: 600; }
    .result.amber .result-title { color: rgb(var(--tone-rgb)); }
    .result-desc { font-size: 13px; line-height: 1.5; color: var(--text-secondary); text-wrap: pretty; }
    .eta { display: flex; flex-direction: column; align-items: flex-end; flex-shrink: 0;
      padding-left: 14px; border-left: 1px solid rgba(var(--tone-rgb), .22); }
    .eta-val { font-size: 20px; font-weight: 600; line-height: 1; letter-spacing: -.3px;
      color: rgb(var(--tone-rgb)); }
    .eta-lbl { font-size: 10.5px; font-weight: 500; text-transform: uppercase; margin-top: 5px;
      color: var(--text-secondary); }

    /* ── Row list (adm-funnel) ── */
    .rows { list-style: none; border: 1px solid var(--border-dim); border-radius: 10px;
      background: var(--surface-raise); overflow: hidden; }
    .row { display: flex; align-items: center; gap: 12px; padding: 12px 14px 10px; font-size: 13.5px; }
    .row + .row { border-top: 1px solid var(--border-dim); }
    .rank { width: 24px; height: 24px; border-radius: 7px; flex-shrink: 0; display: flex;
      align-items: center; justify-content: center; font-size: 11.5px; font-weight: 600;
      background: var(--chip-muted-bg); color: var(--text-secondary); padding-top: 2px; }
    .row-text { flex: 1; min-width: 0; color: var(--text-secondary); line-height: 1.45; }
    .row-text b { color: var(--text-primary); font-weight: 600; }
    .row-lbl { flex: 1; color: var(--text-secondary); }
    .row-val { font-weight: 600; text-align: right; }
    .row-val.good { color: var(--accent-green); }
    .row-val.fair { color: var(--accent-amber); }

    .bar-track { height: 4px; border-radius: 2px; background: var(--chip-muted-bg); overflow: hidden; margin-top: 14px; }
    .bar-track i { display: block; height: 100%; width: 38%; border-radius: inherit;
      background: rgb(var(--accent-amber-rgb)); animation: slide 1.3s ease-in-out infinite; }

    /* ── Callout (eim-callout) ── */
    .callout { display: flex; gap: 10px; align-items: flex-start; margin-top: 12px;
      font-size: 13px; line-height: 1.5; color: var(--accent-amber);
      background: rgba(var(--accent-amber-rgb), .12); border-radius: 8px; padding: 11px 13px 9px; }
    .callout svg { margin-top: 2px; }
    .callout ol { margin: 4px 0 0 18px; }

    /* ── Footer + buttons (eim-footer / apm-btn-*) ── */
    .foot { display: flex; flex-direction: column; gap: 12px; padding: 14px 20px 18px;
      border-top: 1px solid var(--border-dim); }
    .note { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-secondary); }
    .btn {
      width: 100%; min-height: 50px; padding: 15px 18px 12px; border-radius: 6px; cursor: pointer;
      font-family: var(--font-ui); font-size: 13.5px; font-weight: 600; letter-spacing: .2px;
      text-transform: uppercase; display: inline-flex; align-items: center; justify-content: center;
      gap: 9px; transition: background .15s, box-shadow .15s, color .15s;
    }
    .btn:active { scale: .98; }
    .btn-primary { background: var(--accent-fire); border: 0; color: var(--on-accent); }
    .btn-primary:hover { background: var(--accent-fire-hover); box-shadow: 0 0 16px rgba(var(--accent-fire-rgb), .4); }
    .btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--text-secondary); }
    .btn-ghost:hover { background: var(--bg-hover); color: var(--text-primary); }

    .copyright { font-size: 11.5px; color: var(--text-secondary); text-align: center;
      padding-top: 18px; padding-bottom: 22px; }
    .hidden { display: none !important; }

    @keyframes flamePulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .8; transform: scale(.92); } }
    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
    @keyframes ring { 0% { transform: scale(1); opacity: .7; } 100% { transform: scale(1.55); opacity: 0; } }
    @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(270%); } }
    @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
    .state { animation: pop .22s cubic-bezier(.2, .9, .3, 1.2); }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important;
        transition-duration: .01ms !important; }
    }
  </style>
</head>
<body>
  <header class="wrap bar">
    <div class="brand">
      <div class="logo-icon" aria-hidden="true"></div>
      <div class="logo-text">FIRE<span>TRACKR</span></div>
    </div>
    <span class="live"><i></i>BFP Dispatch</span>
  </header>

  <main class="wrap">
    <div class="panel" aria-live="polite">
      <div class="head">
        <div class="eyebrow">Location request</div>
        <div class="title" id="title">Share your location</div>
        <div class="chips">
          <span class="chip">Bureau of Fire Protection</span>
          <span class="chip code">__TOKEN_SAFE__</span>
        </div>
      </div>

      <div class="body">
        <!-- idle -->
        <div id="idle" class="state">
          <div class="section">
            <div class="result">
              <div class="result-icon pulse" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7.5 7.5 0 0 0-7.5 7.5C4.5 15.1 12 22 12 22s7.5-6.9 7.5-12.5A7.5 7.5 0 0 0 12 2Zm0 10.25a2.75 2.75 0 1 1 0-5.5 2.75 2.75 0 0 1 0 5.5Z"/></svg>
              </div>
              <div class="result-text">
                <div class="result-title">Dispatch needs your location</div>
                <div class="result-desc">Sharing your position puts a pin on the dispatcher’s map so fire crews can reach you faster.</div>
              </div>
            </div>
          </div>
          <div class="section">
            <h3>How it works</h3>
            <ol class="rows">
              <li class="row"><span class="rank">1</span><span class="row-text">Tap <b>Share my location</b> below.</span></li>
              <li class="row"><span class="rank">2</span><span class="row-text">Choose <b>Allow</b> when your browser asks.</span></li>
              <li class="row"><span class="rank">3</span><span class="row-text">Your pin appears on the dispatcher’s map instantly.</span></li>
            </ol>
          </div>
        </div>

        <!-- requesting -->
        <div id="requesting" class="state hidden">
          <div class="section">
            <div class="result amber">
              <div class="result-icon pulse" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/></svg>
              </div>
              <div class="result-text">
                <div class="result-title">Finding your location…</div>
                <div class="result-desc" id="reqMsg"></div>
              </div>
            </div>
            <div class="bar-track" aria-hidden="true"><i></i></div>
          </div>
        </div>

        <!-- success -->
        <div id="success" class="state hidden">
          <div class="section">
            <div class="result green">
              <div class="result-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19 7"/></svg>
              </div>
              <div class="result-text">
                <div class="result-title">Location sent</div>
                <div class="result-desc">Dispatch can see you. Stay safe and keep your phone nearby.</div>
              </div>
              <div class="eta">
                <span class="eta-val" id="accVal">—</span>
                <span class="eta-lbl">Accuracy</span>
              </div>
            </div>
          </div>
          <div class="section">
            <h3>Shared position <small id="sentAt"></small></h3>
            <ul class="rows">
              <li class="row"><span class="row-lbl">Signal quality</span><span class="row-val" id="quality"></span></li>
              <li class="row"><span class="row-lbl">Latitude</span><span class="row-val" id="lat"></span></li>
              <li class="row"><span class="row-lbl">Longitude</span><span class="row-val" id="lng"></span></li>
            </ul>
            <div class="callout hidden" id="accHint">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5h.01"/></svg>
              <span>This pin is approximate. If it’s safe, step outside or near a window and tap <b>Update location</b>.</span>
            </div>
          </div>
        </div>

        <!-- error -->
        <div id="error" class="state hidden">
          <div class="section">
            <div class="result amber">
              <div class="result-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>
              </div>
              <div class="result-text">
                <div class="result-title" id="errTitle"></div>
                <div class="result-desc" id="errMsg"></div>
              </div>
            </div>
            <div class="callout hidden" id="denyHint">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5h.01"/></svg>
              <div>
                <b>Turn location back on</b>
                <ol>
                  <li>Tap the icon beside the web address.</li>
                  <li>Open <b>Permissions</b> / <b>Site settings</b> and set Location to <b>Allow</b>.</li>
                  <li>Make sure your phone’s GPS is on, then try again.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="foot">
        <button class="btn btn-primary" id="actionBtn" type="button">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>
          <span id="actionLbl">Share my location</span>
        </button>
        <div class="note">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          Shared only with BFP dispatch · not stored permanently
        </div>
      </div>
    </div>

    <div class="copyright">© 2026 FireTrackr &nbsp;|&nbsp; Bureau of Fire Protection</div>
  </main>

  <script>
    const token = __TOKEN_JS__;
    const $ = (id) => document.getElementById(id);
    const TITLES = { idle: 'Share your location', requesting: 'Locating…', success: 'Thank you', error: 'Something went wrong' };
    const ACTIONS = { idle: 'Share my location', success: 'Update location', error: 'Try again' };

    function show(state) {
      for (const s of ['idle', 'requesting', 'success', 'error'])
        $(s).classList.toggle('hidden', s !== state);
      $('title').textContent = TITLES[state];
      $('actionBtn').className = 'btn ' + (state === 'success' ? 'btn-ghost' : 'btn-primary') + (state === 'requesting' ? ' hidden' : '');
      if (ACTIONS[state]) $('actionLbl').textContent = ACTIONS[state];
    }

    function fail(title, msg, denied) {
      $('errTitle').textContent = title;
      $('errMsg').textContent = msg;
      $('denyHint').classList.toggle('hidden', !denied);
      show('error');
    }

    function getPosition(opts) {
      return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, opts));
    }

    async function locate() {
      try {
        return await getPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
      } catch (err) {
        if (err.code === 1) throw err;           // denied — retrying won't help
        $('reqMsg').textContent = 'GPS is slow here — trying a quicker, approximate fix…';
        return getPosition({ enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 });
      }
    }

    async function send(body) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch('/api/report-sessions/' + encodeURIComponent(token) + '/location', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify(body),
          });
          if (res.ok) return;
          if (res.status < 500) throw new Error('rejected');
        } catch (e) {
          if (e.message === 'rejected') throw e;
        }
        await new Promise((r) => setTimeout(r, 1200));
      }
      throw new Error('network');
    }

    function renderResult(lat, lng, accuracy) {
      const m = Math.round(accuracy);
      const good = m <= 50;
      const q = $('quality');
      q.textContent = m <= 20 ? 'Excellent' : good ? 'Good' : 'Approximate';
      q.className = 'row-val ' + (good ? 'good' : 'fair');
      $('accVal').textContent = '±' + m + ' m';
      $('lat').textContent = lat.toFixed(6);
      $('lng').textContent = lng.toFixed(6);
      $('sentAt').textContent = 'Sent ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      $('accHint').classList.toggle('hidden', good);
    }

    async function shareLocation() {
      if (!('geolocation' in navigator)) {
        return fail('Location not supported', 'This browser can’t share your location. Try opening the link in Chrome or Safari.', false);
      }
      $('reqMsg').textContent = 'If your phone asks, tap Allow. This usually takes a few seconds.';
      show('requesting');

      let pos;
      try {
        pos = await locate();
      } catch (err) {
        if (err.code === 1)
          return fail('Location access is off', 'Your browser blocked location access for this page.', true);
        if (err.code === 2)
          return fail('Can’t find your location', 'Your phone couldn’t get a location fix. Check that Location / GPS is switched on.', false);
        return fail('Location timed out', 'Getting your location took too long. Move to an open area and try again.', false);
      }

      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      try {
        await send({ lat, lng, accuracy });
      } catch (e) {
        return fail('Couldn’t reach dispatch',
          'We found your location but couldn’t send it. Check your mobile data or Wi-Fi and try again.', false);
      }
      renderResult(lat, lng, accuracy);
      show('success');
      if (navigator.vibrate) navigator.vibrate(60);
    }

    $('actionBtn').addEventListener('click', shareLocation);
    show('idle');
  </script>
</body>
</html>"""
