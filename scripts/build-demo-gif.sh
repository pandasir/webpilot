#!/usr/bin/env bash
# Assembles assets/demo.gif from the frames produced by capture-readme-demo.mjs.
#
# Usage: scripts/build-demo-gif.sh <frame-dir> [output.gif]
#
# Each frame fades in from the page background, holds on a caption, then the next
# frame cuts in. The whole sequence is encoded once with a shared palette. Output
# is 11 fps, 860px wide, looping forever, ~21s and ~1.6 MB so it autoplays
# readably on the README page. macOS only: it uses the system Arial faces.
set -euo pipefail

frames=${1:?frame directory required}
out=${2:-assets/demo.gif}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

font=/System/Library/Fonts/Supplemental/Arial.ttf
font_bold="/System/Library/Fonts/Supplemental/Arial Bold.ttf"
width=${WIDTH:-880}
fps=${FPS:-12}
colors=${COLORS:-128}
for f in "$font" "$font_bold"; do
  [ -f "$f" ] || { echo "missing font: $f" >&2; exit 1; }
done
font_path=${font//:/\\:}
bold_path=${font_bold//:/\\:}

# name|seconds|caption
plan=(
  "a-compare-live|4.8|Two runs, watched side by side while they execute"
  "c-live-detail|3.9|Live browser view with a step-by-step timeline"
  "d-steps|4.4|Every assertion keeps its expected and actual result"
  "e-coverage|3.5|Coverage list: what was selected, added, and left as gaps"
  "f-overview|3.8|All runs from every chat and project, in one place"
)

mkdir -p "$work/all"
index=0
for entry in "${plan[@]}"; do
  IFS='|' read -r name seconds caption <<<"$entry"
  src="$frames/$name.png"
  [ -f "$src" ] || { echo "missing frame: $src" >&2; exit 1; }

  escaped=${caption//\\/\\\\}
  escaped=${escaped//\:/\\:}
  escaped=${escaped//\'/}
  fade_in_end=0.35

  ffmpeg -v error -y -loop 1 -t "$seconds" -i "$src" \
    -vf "scale=${width}:-1:flags=lanczos,format=rgba,\
drawtext=fontfile='${bold_path}':text='${escaped}':x=26:y=h-56:fontsize=20:fontcolor=white@0.97:box=1:boxcolor=0x14181C@0.8:boxborderw=13,\
fade=t=in:st=0:d=${fade_in_end}:color=0xF0F0ED" \
    -r "$fps" "$work/seg-%03d.png"

  for f in "$work"/seg-*.png; do
    mv "$f" "$work/all/$(printf '%05d' "$index").png"
    index=$((index+1))
  done
done

mkdir -p "$(dirname "$out")"
ffmpeg -v error -y -framerate "$fps" -i "$work/all/%05d.png" \
  -vf "split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a" \
  -loop 0 "$out"

bytes=$(wc -c <"$out" | tr -d ' ')
frames_out=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$out")
seconds_out=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out")
echo "wrote $out: ${frames_out} frames, ${seconds_out}s, $((bytes/1024)) KB"
