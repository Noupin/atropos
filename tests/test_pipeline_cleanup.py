from pathlib import Path

from server.helpers.cleanup import cleanup_project_dir, reset_project_for_restart
from server import config


def test_cleanup_project_dir_removes_non_shorts(tmp_path: Path) -> None:
    project = tmp_path / "proj"
    shorts = project / "shorts"
    shorts.mkdir(parents=True)
    (project / "keep.mp4").write_text("v")
    (project / "clips").mkdir()
    (project / "clips" / "extra.txt").write_text("x")
    (shorts / "final.mp4").write_text("f")

    cleanup_project_dir(project)

    assert shorts.exists()
    assert (shorts / "final.mp4").exists()
    assert not (project / "keep.mp4").exists()
    assert not (project / "clips").exists()


def test_config_exposes_cleanup_flag() -> None:
    assert config.CLEANUP_NON_SHORTS is False


def test_reset_project_for_restart_removes_expected_artifacts(tmp_path: Path) -> None:
    base_name = "demo_video"
    project = tmp_path / "proj"
    project.mkdir()

    video = project / f"{base_name}.mp4"
    audio = project / f"{base_name}.mp3"
    transcript = project / f"{base_name}.txt"
    silences = project / "silences.json"
    dialog = project / "dialog_ranges.json"
    segments = project / "segments.json"
    candidates = project / "candidates.json"
    render_queue = project / "render_queue.json"
    subtitles = project / "subtitles"
    shorts = project / "shorts"
    clips = project / "clips"
    archive = project / f"{base_name}_subtitles.zip"

    for path in [video, audio, transcript, silences, dialog, segments, candidates, render_queue, archive]:
        path.write_text(path.name)
    for directory in [subtitles, shorts, clips]:
        directory.mkdir(parents=True)
        (directory / "example.txt").write_text("x")

    reset_project_for_restart(project, base_name, start_step=6)

    assert video.exists()
    assert audio.exists()
    assert transcript.exists()
    assert silences.exists()
    assert dialog.exists()
    assert segments.exists()
    assert not candidates.exists()
    assert not render_queue.exists()
    assert not archive.exists()
    assert not subtitles.exists()
    assert not shorts.exists()
    assert not clips.exists()


def test_reset_project_for_restart_full_restart(tmp_path: Path) -> None:
    base_name = "demo_video"
    project = tmp_path / "proj"
    project.mkdir()
    (project / f"{base_name}.mp4").write_text("video")

    reset_project_for_restart(project, base_name, start_step=1)

    assert not project.exists()
