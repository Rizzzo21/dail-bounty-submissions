#!/usr/bin/env bash
# build-near-passport-video.sh -- rebuild the PASSPORT demo video end to end.
#
# WHY A SCRIPT: the first cut of this video had two defects that a reviewer
# found, and both came from the build being a pile of ad-hoc steps:
#
#   * the scene durations came from a HAND-WRITTEN pdurations.json, so the
#     video ended up 2:13 -- past the 2-minute length the bounty asks for, and
#     a reviewer cutting to 2:00 never saw the scenes at the tail;
#   * the audio was concatenated from a HAND-WRITTEN list, in a hand-chosen
#     order, while the pictures were rendered from a hand-chosen scene list.
#     The two could drift apart, and then the words do not match the pictures.
#
# So this script derives EVERYTHING from one source of truth:
#     tools/earning/near-demo-narration-passport.json
# The TTS, the scene durations, the audio concatenation order and the scene
# list of the renderer all come from it, and the scene list is CHECKED
# against it before a frame is rendered.
#
# usage:  bash tools/earning/build-near-passport-video.sh
set -euo pipefail
ROOT=/home/node/.openclaw/workspace
VID=/tmp/vid
NARR=$ROOT/tools/earning/near-demo-narration-passport.json
FFMPEG=/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v9.0.2
VOICE="${VOICE:-en-US-AriaNeural}"
RATE="${RATE:-+12%}"

mkdir -p "$VID/ptts" "$VID/pframes"

# ---- 1. the TTS, one file per scene, in the narration's order --------------
echo "[1/5] TTS from $NARR"
python3 - "$NARR" "$VID/ptts" "$VOICE" "$RATE" <<'PY'
import json, os, subprocess, sys
narr, out, voice, rate = sys.argv[1:5]
scenes = json.load(open(narr))
names = []
for i, sc in enumerate(scenes):
    key = sc["scene"]
    txt = os.path.join(out, "%02d_%s.txt" % (i, key))
    mp3 = os.path.join(out, "%02d_%s.mp3" % (i, key))
    wav = os.path.join(out, "%02d_%s.wav" % (i, key))
    names.append((key, txt, wav))
    # The cache is keyed on the TEXT, not on the file names: if the
    # narration is edited the audio has to be re-spoken, otherwise the build
    # silently reuses the old words and the durations do not change.
    changed = (not os.path.exists(txt)
               or open(txt).read() != sc["text"]
               or not (os.path.exists(wav) and os.path.getsize(wav) > 1000))
    if changed:
        open(txt, "w").write(sc["text"])
        subprocess.run([sys.executable, "-m", "edge_tts", "--voice", voice,
                        "--rate", rate, "--text", sc["text"],
                        "--write-media", mp3], check=True)
        # edge-tts writes mp3; the rest of the pipeline wants mono 24 kHz wav
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp3,
                        "-ac", "1", "-ar", "24000", wav], check=True)
json.dump(names, open(os.path.join(out, "..", "pvoice_map.json"), "w"))
print("   %d scenes spoken" % len(names))
PY

# ---- 2. the durations, MEASURED from the audio (not hand-written) ---------
echo "[2/5] measuring the scene durations from the audio"
python3 - "$VID" "$NARR" <<'PY'
import json, os, sys, wave
vid, narr = sys.argv[1:3]
names = json.load(open(os.path.join(vid, "pvoice_map.json")))
scenes = json.load(open(narr))
assert len(names) == len(scenes), "narration/scene count mismatch"
durs = {}
for (key, txt, wav), sc in zip(names, scenes):
    assert key == sc["scene"], "narration order drift: %s vs %s" % (key, sc["scene"])
    w = wave.open(wav)
    d = w.getnframes() / float(w.getframerate())
    durs[key] = round(d, 2)
json.dump(durs, open(os.path.join(vid, "pdurations.json"), "w"), indent=1)
total = sum(durs.values())
print("   total %.1f s (%.2f min)" % (total, total / 60.0))
for k, v in durs.items():
    print("     %-18s %6.2f" % (k, v))
if total > 120.0:
    raise SystemExit("REFUSING TO BUILD: the narration is %.1f s, past the "
                     "2-minute (120 s) length the bounty asks for." % total)
PY

# ---- 3. the audio, concatenated in the narration's order ------------------
echo "[3/5] concatenating the audio"
python3 - "$VID" <<'PY'
import json, os, subprocess, sys, wave
vid = sys.argv[1]
names = json.load(open(os.path.join(vid, "pvoice_map.json")))
out = os.path.join(vid, "pnarr.m4a")
raw = os.path.join(vid, "pnarr.wav")
with wave.open(raw, "w") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000)
    for key, txt, wav in names:
        src = wave.open(wav)
        assert src.getnchannels() == 1 and src.getframerate() == 24000, \
            "unexpected wav format for %s" % wav
        w.writeframes(src.readframes(src.getnframes()))
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw,
                "-c:a", "aac", "-b:a", "128k", out], check=True)
print("   %s" % out)
PY

# ---- 4. the frames ---------------------------------------------------------
echo "[4/5] rendering the frames"
python3 "$ROOT/tools/earning/make-near-passport-video.py" --vid "$VID" --frames "$VID/pframes"

# ---- 5. mux ----------------------------------------------------------------
echo "[5/5] muxing"
"$FFMPEG" -y -loglevel error -framerate 20 -i "$VID/pframes/%05d.png" \
  -i "$VID/pnarr.m4a" -c:v libx264 -preset medium -crf 22 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -shortest /tmp/near_passport_demo.mp4
DUR=$("$FFMPEG" -i /tmp/near_passport_demo.mp4 2>&1 | grep -o "Duration: [0-9:.]*" | head -1)
echo "   /tmp/near_passport_demo.mp4  $DUR"
sha256sum /tmp/near_passport_demo.mp4
ls -la /tmp/near_passport_demo.mp4
