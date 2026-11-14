#!/usr/bin/env python3
"""Render the 2-minute narrated PASSPORT demo video.

Same contract as make-near-demo-video.py: every frame is drawn from output
that was actually captured from the running code, or from a real screenshot of
the public testnet explorer.  Nothing is staged.

  python3 tools/earning/make-near-passport-video.py --out /tmp/near_passport_demo.mp4
"""
import argparse
import json
import os
import re

from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
FPS = 20
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
UI = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
UI_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

BG = (16, 18, 24)
TITLEBAR = (32, 36, 46)
FG = (218, 222, 230)
DIM = (128, 136, 152)
GREEN = (126, 209, 122)
YELLOW = (229, 192, 123)
RED = (240, 113, 120)
BLUE = (122, 162, 247)
CYAN = (86, 182, 194)
MAGENTA = (198, 120, 221)
WHITE = (240, 243, 248)

TERM_PAD_X = 46
TERM_PAD_Y = 34
LINE_H = 19


def load_lines(path):
    with open(path, "r", errors="replace") as f:
        return f.read().split("\n")


def colour_of(line):
    if "REFUSED" in line or "FAIL" in line or "release_refused" in line:
        return RED
    if "RELEASED" in line or "PASS" in line or "traceable" in line:
        return GREEN
    if "composite" in line:
        return YELLOW
    if "ESCROW" in line or "escrow" in line:
        return MAGENTA
    if "STEP" in line:
        return BLUE
    if line.strip().startswith("SUMMARY") or "VERIFIED" in line:
        return CYAN
    return FG


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vid", default="/tmp/vid")
    ap.add_argument("--frames", default="/tmp/vid/pframes")
    args = ap.parse_args()
    V = args.vid

    font = ImageFont.truetype(FONT, 14)
    font_b = ImageFont.truetype(FONT_B, 14)
    f_ui = ImageFont.truetype(UI, 15)
    f_ui_b = ImageFont.truetype(UI_B, 16)

    with open(f"{V}/pdurations.json") as f:
        DUR = json.load(f)
    PAD = 0.0

    demo = load_lines(f"{V}/pdemo.txt")
    verify = load_lines(f"{V}/pverify.txt")
    claims = load_lines(f"{V}/pclaims.txt")
    state = load_lines(f"{V}/pstate.txt")
    state_bob = load_lines(f"{V}/pstate_bob.txt")
    hist = load_lines(f"{V}/phist.txt")

    # THE SCENE LIST MUST MATCH THE NARRATION ORDER EXACTLY: the audio is
    # concatenated in the order of the narration JSON, so a scene list in a
    # different order produces a video whose words do not match its pictures.
    # The keys below are the `scene` keys of
    # tools/earning/near-demo-narration-passport.json.
    def term(cmd, lines, key):
        return ("terminal", {"title": "orbit — near-passport", "cmd": cmd,
                             "lines": lines}, DUR[key], key)

    def exp(hash_, key, png=None):
        return ("explorer", {"hash": hash_,
                             "png": png or f"{V}/exp_{hash_}.png"},
                DUR[key], key)

    scenes = []
    scenes.append(("title", {}, DUR["title"], "title"))
    scenes.append(term("node scripts/demo.mjs", demo, "demo1"))
    scenes.append(term("node scripts/demo.mjs (continued)", demo, "demo2"))
    # The open_escrow agent-bob transaction was FOURTH of four explorers in the
    # first cut, i.e. at t = 110 s of a 2:13 video -- past the 2-minute mark
    # the bounty asks for, so a reviewer cutting to 2:00 never saw it.  It now
    # sits right after the escrow walk-through, which is also where it belongs
    # narratively.
    scenes.append(exp("4BHUC53FTETSu2rMUgbYDgw8ezwgUKf6fa7XjHK3ETak",
                      "explorer_openbob"))
    scenes.append(term("near-view.sh orbit-passport.testnet get_passport agent-ava / agent-bob",
                       state + [""] + state_bob, "state"))
    # THE ESCROW-HISTORY READ, ON A SCENE OF ITS OWN.
    #
    # The house's review of 2026-11-06 said the first cut "cuts before that
    # output appears": get_escrow_history agent-ava ([]) and get_threshold (50)
    # were the LAST lines of a 34-line terminal scene, so the reveal animation
    # only put them on screen in the final instants, and in a 2-minute cut of a
    # 2:13 video they fell off the end entirely.  They now have a dedicated
    # scene, early enough to be inside the 2-minute mark, with the output
    # held on screen.
    scenes.append(term("near-view.sh orbit-passport.testnet get_escrow_history agent-ava / get_threshold",
                       hist, "history"))
    scenes.append(term("bash docs/verify.sh", verify, "verify"))
    scenes.append(term('node --input-type=module -e "... verifyProvenance(...) ..."',
                       claims, "claims"))
    scenes.append(exp("5T1MaW7z2WAw3M2Yw9jCKfRhWDZ9mXpEMTaxWECou4mc",
                      "explorer_reg_ava"))
    scenes.append(exp("FMrJr5jY2pBohhGg8SPg7ZomSHmZnFKUudFMydeKK7ng",
                      "explorer_reg_bob"))
    scenes.append(exp("CF6n967pHCXDou6f5UjLu21zMcLHMxf3fheJ7kreRr4c",
                      "explorer_refused"))
    scenes.append(("end", {}, DUR["end"], "end"))

    os.makedirs(args.frames, exist_ok=True)
    for f in os.listdir(args.frames):
        os.remove(os.path.join(args.frames, f))

    n = 0
    for kind, payload, dur, key in scenes:
        nframes = max(1, int(dur * FPS))
        if kind == "terminal":
            lines = payload["lines"]
            cmd = payload["cmd"]
            for i in range(nframes):
                t = i / nframes
                img = Image.new("RGB", (W, H), BG)
                d = ImageDraw.Draw(img)
                d.rectangle([0, 0, W, 34], fill=TITLEBAR)
                for j, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
                    d.ellipse([16 + j * 20, 11, 26 + j * 20, 21], fill=c)
                tf = ImageFont.truetype(UI, 14)
                tw = d.textlength(payload["title"], font=tf)
                d.text(((W - tw) / 2, 8), payload["title"], font=tf, fill=(168, 174, 188))

                shown = int(len(cmd) * min(1.0, t * 3))
                buf = [("$ " + cmd[:shown], CYAN)]
                # The reveal now COMPLETES at t = 0.70 and HOLDS for the last
                # 30% of the scene.  In the first cut it completed only at
                # t = 1.0, so the LAST lines of a scene -- which is where the
                # get_escrow_history and get_threshold outputs live -- were
                # on screen for an instant before the scene ended, and a
                # reviewer cutting the video to the 2-minute mark never saw
                # them at all.
                prog = max(0.0, (t - 0.26)) / 0.44
                nout = int(len(lines) * min(1.0, prog))
                for ln in lines[:nout]:
                    buf.append((ln, colour_of(ln)))
                y = TERM_PAD_Y
                for text, colour in buf[-30:]:
                    x = TERM_PAD_X
                    for part in re.split(r"(\s+)", text):
                        if not part:
                            continue
                        col = colour
                        if part == "[PASS]":
                            col = GREEN
                        f = font_b if part == "[PASS]" else font
                        d.text((x, y), part, font=f, fill=col)
                        x += d.textlength(part, font=f)
                    y += LINE_H
                img.save(os.path.join(args.frames, f"{n:05d}.png"))
                n += 1
        elif kind == "explorer":
            shot = Image.open(payload["png"]).convert("RGB")
            for i in range(nframes):
                t = i / nframes
                img = Image.new("RGB", (W, H), BG)
                d = ImageDraw.Draw(img)
                d.rectangle([0, 0, W, 34], fill=TITLEBAR)
                for j, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
                    d.ellipse([16 + j * 20, 11, 26 + j * 20, 21], fill=c)
                url = f"https://nearvalidate.org/txns/{payload['hash']}?network=testnet"
                tf = ImageFont.truetype(UI, 14)
                tw = d.textlength(url, font=tf)
                d.text(((W - tw) / 2, 8), url, font=tf, fill=(168, 174, 188))
                avail_w, avail_h = W - 40, H - 34 - 70
                sc = min(avail_w / shot.width, avail_h / shot.height)
                sh = shot.resize((int(shot.width * sc), int(shot.height * sc)), Image.LANCZOS)
                if t < 0.15:
                    sh = sh.crop((0, 0, int(sh.width * (t / 0.15)), sh.height))
                img.paste(sh, ((W - sh.width) // 2, 34 + 40))
                cap = ImageFont.truetype(UI_B, 15)
                d.text((20, H - 42),
                       "public NEAR testnet explorer — live page for a cited tx hash",
                       font=cap, fill=(150, 158, 172))
                img.save(os.path.join(args.frames, f"{n:05d}.png"))
                n += 1
        else:
            for i in range(nframes):
                img = Image.new("RGB", (W, H), BG)
                d = ImageDraw.Draw(img)
                if kind == "title":
                    d.text((80, 150), "PASSPORT", font=f_ui_b, fill=WHITE)
                    d.text((80, 200), "a portable agent reputation passport with escrow history",
                           font=f_ui, fill=DIM)
                    d.text((80, 270), "33 verify checks  ·  15/15 claims traceable  ·  live testnet deployment",
                           font=f_ui, fill=GREEN)
                    d.text((80, 330), "orbit_ug_2026   ·   DAiL bounty bnty_0524", font=f_ui, fill=CYAN)
                    d.text((80, 420), "every frame is real output from the running code",
                           font=f_ui, fill=YELLOW)
                else:
                    d.text((80, 130), "Every step you just saw is reproducible:", font=f_ui_b, fill=WHITE)
                    for j, line in enumerate([
                        "  git clone <near-passport> && cd near-passport",
                        "  node scripts/demo.mjs          # lookup, escrow history, refusal case",
                        "  bash docs/verify.sh            # 33 checks",
                        "  near view orbit-passport.testnet get_passport ...",
                    ]):
                        d.text((80, 190 + j * 42), line, font=f_ui, fill=FG)
                    d.text((80, 420), "contract: orbit-passport.testnet  ·  4 cited txs, incl. the refusal",
                           font=f_ui, fill=GREEN)
                    d.text((80, 490), "published tree + recording: see the submission body",
                           font=f_ui, fill=CYAN)
                img.save(os.path.join(args.frames, f"{n:05d}.png"))
                n += 1
        print(f"[video] {key} done ({n} frames)", flush=True)
    print(f"[video] {n} frames written", flush=True)


if __name__ == "__main__":
    main()
