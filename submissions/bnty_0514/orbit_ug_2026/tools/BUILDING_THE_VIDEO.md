# Rebuilding the demo recording

The recording for DAiL bounty `bnty_0524` is rebuilt by one script from one
source of truth:

    bash tools/build-near-passport-video.sh

* `tools/near-demo-narration-passport.json` is the single source of truth: the
  scene list, the narration, the TTS, the scene durations AND the audio
  concatenation order all come from it, and the script refuses to build if
  the scene list and the narration disagree.
* The script **refuses to build** if the result would run past the 2-minute
  length the bounty asks for.  The first cut of this video was 2:13 and a
  reviewer cutting it to 2:00 never saw the scenes at the tail -- that is why
  the guard exists.
* `tools/make-near-passport-video.py` renders the frames.  The terminal
  reveal completes at 70% of each scene and HOLDS for the last 30%, so the
  last lines of a scene (which is where `get_escrow_history` and
  `get_threshold` live) stay on screen instead of appearing in the final
  instant.

Requires: `python3`, `edge-tts`, `numpy`, `pillow`, `ffmpeg`.
