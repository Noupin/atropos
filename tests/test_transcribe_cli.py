from server.cli.transcribe_cli import main as transcribe_main


def test_transcribe_cli_invokes_transcribe_audio(monkeypatch):
    called = {}

    def fake_transcribe(path, model):
        called['args'] = (path, model)

    monkeypatch.setattr(
        'server.cli.transcribe_cli._get_transcribe_audio', lambda: fake_transcribe
    )
    transcribe_main(['audio.mp3', '--model-size', 'small'])
    assert called['args'] == ('audio.mp3', 'small')


def test_transcribe_cli_uses_default_model(monkeypatch):
    called = {}

    def fake_transcribe(path, model):
        called['args'] = (path, model)

    monkeypatch.setattr(
        'server.cli.transcribe_cli._get_transcribe_audio', lambda: fake_transcribe
    )
    transcribe_main(['audio.mp3'])
    assert called['args'] == ('audio.mp3', 'medium')
