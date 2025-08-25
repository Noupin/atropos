def write_transcript_txt(result: dict, out_path: str) -> None:
    """Write segments and timing from transcribe_audio result to a .txt file."""
    segments = result.get("segments", [])
    timing = result.get("timing", {})
    with open(out_path, "w", encoding="utf-8") as f:
        for seg in segments:
            start = float(seg.get("start", 0.0))
            end = float(seg.get("end", 0.0))
            text = (seg.get("text", "") or "").replace("\n", " ").strip()
            f.write(f"[{start:.2f} -> {end:.2f}] {text}\n")
        f.write("\n# TIMING\n")
        f.write(f"start_time: {timing.get('start_time', 0.0):.2f} seconds\n")
        f.write(f"stop_time: {timing.get('stop_time', 0.0):.2f} seconds\n")
        f.write(f"total_time: {timing.get('total_time', 0.0):.2f} seconds\n")
