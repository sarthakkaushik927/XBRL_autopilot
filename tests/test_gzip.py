"""gzip on the backend (docs/18, "Faster first open"): the knowledge base is the app's biggest download."""
import json


def test_authority_is_gzipped_when_asked(client):
    res = client.get("/api/v1/indas/authority", headers={"Accept-Encoding": "gzip"})
    assert res.status_code == 200
    assert res.headers["content-encoding"] == "gzip"
    assert res.json()["data"]["calculation"]  # httpx decompresses: the body is the same JSON
    # on the wire it is several times smaller
    raw = len(json.dumps(res.json()).encode())
    assert int(res.headers["content-length"]) * 4 < raw


def test_plain_when_not_asked_and_small_responses_stay_plain(client):
    res = client.get("/api/v1/indas/authority", headers={"Accept-Encoding": "identity"})
    assert "content-encoding" not in res.headers
    assert json.loads(res.content)["success"] is True
    small = client.get("/health", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in small.headers  # below minimum_size: not worth compressing

