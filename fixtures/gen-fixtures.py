#!/usr/bin/env python3
"""
Fixture-image generator for the seed script.

Reads OPENROUTER_API_KEY from env. Writes JPEG fixtures next to this file
(./fixtures/seed-*.jpg) matching the filenames seed.ts references. Skips any
destination that already exists, so re-runs only fill in misses; pass --force
to overwrite.

Run from the repo root:
    OPENROUTER_API_KEY=sk-or-... python3 fixtures/gen-fixtures.py
    OPENROUTER_API_KEY=... python3 fixtures/gen-fixtures.py --only fridge,kotatsu
    OPENROUTER_API_KEY=... python3 fixtures/gen-fixtures.py --only jacket --force

Gemini returns PNG bytes; the script post-processes each file with `sips`
(built-in on macOS) to re-encode as JPEG in place, so the bytes match the
.jpg extension and the seed's image/jpeg content-type. On a host without
sips, the file is left as PNG-in-jpg and a warning is printed.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "google/gemini-2.5-flash-image"

# Shared style anchor prepended to every prompt. Phone-photo aesthetic, used
# goods in a Sendai apartment, no studio polish, no on-image text or people.
STYLE = (
    "Photo shot on a modern phone camera, mild natural light from a window, "
    "plain Japanese apartment interior (light wood floor, off-white wall, "
    "occasional tatami edge). Slightly imperfect — gentle shadows, no studio "
    "polish. Single subject sharply in focus, modest depth of field. No "
    "watermarks, no on-image text, no people, no logos beyond what is named. "
    "Landscape 4:3 framing. Neutral color, not over-saturated. "
)

# (group, filename, prompt body). Group key is used by --only.
JOBS: list[tuple[str, str, str]] = [
    # ---------- 1. Sharp mini fridge (4) ----------
    (
        "fridge",
        "seed-mini-fridge-1.jpg",
        "Closed two-door white compact fridge about 120 cm tall, front-on at "
        "chest height, slightly off-center, sitting on light wood floor against "
        "an off-white wall. Small freezer door on top, larger fridge door below. "
        "A subtle 'SHARP' badge visible on the front. Clean exterior with very "
        "faint scuff marks near the handle so it reads as four years old, "
        "lightly used.",
    ),
    (
        "fridge",
        "seed-mini-fridge-2.jpg",
        "Same compact two-door white fridge with both doors open. Interior is "
        "empty but clean: three white plastic shelves in the lower compartment, "
        "two clear drawers in the upper freezer, a small egg tray on a shelf. "
        "Internal LED is on. Camera at door height, slight three-quarter angle.",
    ),
    (
        "fridge",
        "seed-mini-fridge-3.jpg",
        "Top-down close-up of the freezer compartment of a small white fridge, "
        "doors open, showing the two clear plastic drawers pulled half-out. "
        "Frost-free, dry interior. Crisp detail on the plastic texture, slight "
        "highlight from a ceiling light.",
    ),
    (
        "fridge",
        "seed-mini-fridge-4.jpg",
        "Detail shot of a model badge embossed on the inside of a fridge door, "
        "reading 'SJ-D14F-W', shot at an angle so the embossed plastic catches "
        "light. Tightly framed; the rest of the fridge is softly out of focus.",
    ),
    # ---------- 2. Kotatsu (3) ----------
    (
        "kotatsu",
        "seed-kotatsu-1.jpg",
        "A 75 cm-square low kotatsu table with a dark walnut wood top, set up "
        "with its quilted futon draped underneath and folded back over the top "
        "edge, sitting on tatami matting. Slightly angled overhead view, warm "
        "afternoon light coming from frame-left.",
    ),
    (
        "kotatsu",
        "seed-kotatsu-2.jpg",
        "Underside view of a kotatsu table: tilted to show the electric heater "
        "unit mounted to the underside of the wooden table, exposed wood frame, "
        "power cord coiled neatly beside it. Plain wood floor background.",
    ),
    (
        "kotatsu",
        "seed-kotatsu-3.jpg",
        "Folded quilted kotatsu futon stacked neatly next to a bare wooden "
        "kotatsu table top, showing the quilt pattern — a muted brown and cream "
        "geometric print, classic Japanese style. The heater control dial on "
        "the power cord is visible in the foreground.",
    ),
    # ---------- 3. Mama-chari bicycle (2) ----------
    (
        "bicycle",
        "seed-bicycle-1.jpg",
        "Japanese mama-chari city bicycle, photographed side-on, parked on its "
        "kickstand against a low concrete wall. Step-through frame, wicker-"
        "style front basket, rear child seat mounted behind the saddle. Faded "
        "mint-green frame with light surface scratches. Soft overcast daylight, "
        "outdoor setting.",
    ),
    (
        "bicycle",
        "seed-bicycle-2.jpg",
        "Three-quarter rear angle of the same mama-chari bicycle, showing the "
        "rear child seat — blue plastic with visible seatbelt straps — and the "
        "three-speed shifter on the right handlebar. Tires look fresh and "
        "black, new last year.",
    ),
    # ---------- 4. Paperback bundle (2) ----------
    (
        "paperbacks",
        "seed-paperbacks-1.jpg",
        "Ten mixed paperback novels stacked in two short towers of five on a "
        "light wood table. Spines facing the camera, varied colors and worn "
        "edges. Titles and author names on the spines should be intentionally "
        "blurred or unreadable to avoid identifying real published works. Soft "
        "window light from the side.",
    ),
    (
        "paperbacks",
        "seed-paperbacks-2.jpg",
        "The same ten paperback novels fanned out flat on a light wood table, "
        "front covers facing up, slightly overlapping. Covers should be "
        "generic-looking abstract design — color blocks, simple typography "
        "stand-ins, no recognizable real titles, no recognizable author "
        "photos, no legible English words.",
    ),
    # ---------- 5. Zojirushi rice cooker (5) ----------
    (
        "rice-cooker",
        "seed-rice-cooker-1.jpg",
        "A small white-and-champagne-colored 3-cup electric rice cooker, "
        "front-on, sitting on a clean kitchen counter. Brushed-metal LCD panel "
        "and four control buttons visible on the front. Power cord coiled "
        "beside it. A subtle 'ZOJIRUSHI' wordmark on the body.",
    ),
    (
        "rice-cooker",
        "seed-rice-cooker-2.jpg",
        "Same rice cooker with the lid open, camera looking down into the inner "
        "cooking pot. The non-stick pot is clean but shows very faint linear "
        "scratches from a rice paddle, so it reads as gently used. Steam vent "
        "visible on the underside of the lid.",
    ),
    (
        "rice-cooker",
        "seed-rice-cooker-3.jpg",
        "The rice cooker's inner non-stick pot removed from the body and set "
        "down on the counter next to the cooker. Both visible in frame, showing "
        "that the inner pot is the standard removable type.",
    ),
    (
        "rice-cooker",
        "seed-rice-cooker-4.jpg",
        "Tight close-up of the rice cooker's front control panel: LCD display "
        "off, button labels in Japanese kanji and hiragana — 白米, 玄米, おかゆ, "
        "予約. Sharp text legibility on the buttons.",
    ),
    (
        "rice-cooker",
        "seed-rice-cooker-5.jpg",
        "Rice cooker accessories laid out neatly on the kitchen counter beside "
        "the cooker body: a white plastic rice paddle, a clear plastic "
        "measuring cup with rice-cup gradations, and a small removable steam "
        "vent cap. Slight overhead angle.",
    ),
    # ---------- 6. IKEA Malm desk — DRAFT (1) ----------
    (
        "desk",
        "seed-malm-desk-1.jpg",
        "Simple white flat-pack desk, about 140 cm by 65 cm, partially "
        "assembled — the top placed on its legs but with one drawer pulled out "
        "sitting on the desk surface and a small clear bag of screws plus an "
        "Allen key next to it. Reads as a mid-assembly photo, work in "
        "progress. Plain apartment room background.",
    ),
    # ---------- 7. Uniqlo winter jacket (2) ----------
    (
        "jacket",
        "seed-jacket-1.jpg",
        "Navy blue puffer down jacket, lightweight 'ultra light down' style, "
        "laid flat on a light bedspread, fully zipped, sleeves arranged "
        "naturally. Slight overhead angle, soft window light from frame-right.",
    ),
    (
        "jacket",
        "seed-jacket-2.jpg",
        "The same navy puffer jacket hung on a wooden hanger on a closet door, "
        "front-on. Shows the collar shape and overall silhouette. One sleeve "
        "cuff has a barely-visible faint mark, reading as lightly worn one "
        "winter.",
    ),
]

FIXTURES_DIR = Path(__file__).resolve().parent


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--only",
        help="comma-separated group keys (e.g. fridge,kotatsu) to limit which jobs run",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="regenerate even if the destination file already exists",
    )
    return p.parse_args()


def call_openrouter(api_key: str, prompt: str) -> bytes:
    """Returns raw image bytes. Raises on any failure."""
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": STYLE + prompt}],
        "modalities": ["image", "text"],
    }
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = json.loads(resp.read())

    choices = body.get("choices") or []
    if not choices:
        raise RuntimeError(f"no choices in response: {body}")
    images = choices[0].get("message", {}).get("images") or []
    if not images:
        raise RuntimeError(f"no images in message: {choices[0]['message']}")
    data_url = images[0]["image_url"]["url"]
    # Expect: data:image/png;base64,XXXX
    if "," not in data_url:
        raise RuntimeError(f"unexpected image_url shape: {data_url[:80]}")
    return base64.b64decode(data_url.split(",", 1)[1])


def main() -> int:
    args = parse_args()
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("OPENROUTER_API_KEY not set", file=sys.stderr)
        return 1

    only = set((args.only or "").split(",")) if args.only else None
    if only:
        only.discard("")

    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    sips = shutil.which("sips")
    if not sips:
        print("warning: `sips` not on PATH — output will be PNG bytes in .jpg files")

    todo = [j for j in JOBS if not only or j[0] in only]
    print(f"Generating {len(todo)} image(s) into {FIXTURES_DIR} via {MODEL}")
    failures: list[tuple[str, str]] = []

    for group, filename, prompt in todo:
        dest = FIXTURES_DIR / filename
        if dest.exists() and not args.force:
            print(f"  skip   {filename} (exists)")
            continue
        print(f"  gen    {filename} ... ", end="", flush=True)
        try:
            t0 = time.time()
            blob = call_openrouter(api_key, prompt)
            dest.write_bytes(blob)
            if sips:
                subprocess.run(
                    [sips, "-s", "format", "jpeg", str(dest), "--out", str(dest)],
                    check=True,
                    capture_output=True,
                )
            size_kb = dest.stat().st_size // 1024
            print(f"ok ({size_kb} KB, {time.time() - t0:.1f}s)")
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")[:200]
            print(f"HTTP {e.code}: {err_body}")
            failures.append((filename, f"HTTP {e.code}"))
        except Exception as e:
            print(f"fail: {e}")
            failures.append((filename, str(e)))

    if failures:
        print(f"\n{len(failures)} failure(s):")
        for name, why in failures:
            print(f"  {name}: {why}")
        return 2
    print("\nAll requested images generated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
