import json
from unittest.mock import patch

from server.upload.batch import upload_folder
from server.upload.pipeline import UploadConfig


def test_upload_folder_calls_upload_video_to_all(tmp_path):
    video_file = tmp_path / "clip.mp4"
    video_file.write_bytes(b"data")
    metadata = {
        "title": "My Clip",
        "description": "A description",
        "hashtags": ["#one", "#two"],
    }
    (tmp_path / "clip.json").write_text(json.dumps(metadata))
    config = UploadConfig(
        instagram_account="insta",
        tiktok_account="tiktok",
        youtube_account="youtube",
        facebook_page="facebook",
        snapchat_account="snap",
        twitter_account="twitter",
    )
    with patch("server.upload.batch.upload_video_to_all") as mock_upload:
        upload_folder(str(tmp_path), config)
        mock_upload.assert_called_once_with(
            str(video_file),
            "A description #one #two",
            "My Clip",
            "A description\n\n#one #two",
            config,
        )
