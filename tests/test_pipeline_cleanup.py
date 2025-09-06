from pathlib import Path

from server.helpers.cleanup import cleanup_project_dir
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
