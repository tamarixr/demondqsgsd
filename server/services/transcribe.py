#!/usr/bin/env python3
"""
Word-level transcription service.
Usage: python3 transcribe.py <audio_path> [model_size]

Prints a single JSON object to stdout:
{
  "language": "en",
  "segments": [
    {
      "start": 0.0,
      "end": 2.3,
      "text": "hello there",
      "words": [
        {"word": "hello", "start": 0.0, "end": 0.6},
        {"word": "there", "start": 0.65, "end": 1.1}
      ]
    },
    ...
  ]
}

Model sizes (speed vs accuracy tradeoff): tiny, base, small, medium, large-v3
"""
import sys
import json


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "audio path required"}), file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "base"

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({
            "error": "faster-whisper is not installed. Run: pip install faster-whisper"
        }), file=sys.stderr)
        sys.exit(1)

    try:
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        segments_gen, info = model.transcribe(
            audio_path,
            word_timestamps=True,
            vad_filter=True,
        )

        result_segments = []
        for seg in segments_gen:
            words = []
            if seg.words:
                for w in seg.words:
                    text = (w.word or "").strip()
                    if not text:
                        continue
                    words.append({
                        "word": text,
                        "start": round(float(w.start), 3),
                        "end": round(float(w.end), 3),
                    })
            result_segments.append({
                "start": round(float(seg.start), 3),
                "end": round(float(seg.end), 3),
                "text": (seg.text or "").strip(),
                "words": words,
            })

        output = {
            "language": info.language,
            "segments": result_segments,
        }
        print(json.dumps(output))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
