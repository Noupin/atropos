from server.cli.download_cli import main as download_main


def test_download_cli_invokes_download_transcript(monkeypatch):
    called = {}

    def fake_download(url, output):
        called['args'] = (url, output)

    monkeypatch.setattr(
        'server.cli.download_cli._get_download_transcript', lambda: fake_download
    )
    download_main(['https://youtu.be/test', '--output', 'out.txt'])
    assert called['args'] == ('https://youtu.be/test', 'out.txt')


def test_download_cli_uses_default_output(monkeypatch):
    called = {}

    def fake_download(url, output):
        called['args'] = (url, output)

    monkeypatch.setattr(
        'server.cli.download_cli._get_download_transcript', lambda: fake_download
    )
    download_main(['https://youtu.be/test'])
    assert called['args'] == ('https://youtu.be/test', 'transcript.txt')
