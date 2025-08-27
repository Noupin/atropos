# Atropos

Atropos automatically extracts short-form clips from long-form videos. The
pipeline downloads a video, transcribes audio, detects silence, ranks segments
with a local LLM, and renders captioned vertical clips.

## Architecture

The project is split into a Python **server** and a separate **client**. This
repository contains the server side located in [`server/`](server/), which
exposes a pipeline that orchestrates all processing steps. A client (for example
an upcoming web UI) can invoke the server to submit video URLs and retrieve the
produced clips.

## Pipeline Overview

The server's pipeline coordinates the major steps for turning a YouTube video
into vertical clips:

1. **Download video** – fetch the source video.
2. **Ensure audio** – extract or download audio with FFmpeg if needed.
3. **Fetch transcript** – retrieve captions for the video.
4. **Detect silences** – analyze audio to locate natural pause boundaries.
5. **Find clip candidates** – score transcript lines with a local Ollama model
   to propose promising clip windows.
6. **Process candidates** – cut, caption, and render the final clips.

These stages are implemented in [`run_pipeline`](server/pipeline/__init__.py).

## Setup

### Requirements

- Python 3.11+
- [FFmpeg](https://ffmpeg.org/) available on the command line
- [Ollama](https://ollama.com/) running locally (defaults to `http://localhost:11434`)
- Python packages such as `yt-dlp`, `youtube-transcript-api`, `opencv-python`,
  `numpy`, `requests`, and `pytest`

### Installation

1. Install system dependencies (`ffmpeg` and `ollama`).
2. Install Python libraries:

   ```bash
   pip install yt-dlp youtube-transcript-api opencv-python numpy requests pytest
   ```

### Running the pipeline

Use the pipeline CLI to process a YouTube video:

```bash
python -m server.pipeline https://www.youtube.com/watch?v=YOUR_VIDEO_ID
```

Output clips are written under `server/out/`.

## Testing

Run the test suite from the repository root:

```bash
pytest
```

## Contributing

1. Follow PEP 8 style guidelines and ensure all tests pass.
2. See [AGENTS.md](AGENTS.md) for repository-wide conventions and details on how
   to run checks.
3. Submit pull requests with a clear description of changes.

Contributions that improve documentation, add features, or fix bugs are welcome!
