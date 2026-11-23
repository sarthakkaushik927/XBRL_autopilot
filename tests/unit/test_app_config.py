from src.app_config import AppConfig


def test_embedding_model_accepts_hugging_face_model_name(monkeypatch):
    monkeypatch.setenv(
        "EMBEDDING_MODEL",
        "sentence-transformers/all-mpnet-base-v2",
    )

    config = AppConfig()

    assert config.embedding_model == "sentence-transformers/all-mpnet-base-v2"
