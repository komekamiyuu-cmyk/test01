import io
import json
import threading
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path

import pytest

from stemsplit.separator import SeparationOptions
from stemsplit.webui import build_server
from stemsplit.webui.multipart import MultipartError, boundary_of, parse


# ---------------------------------------------------------------- multipart
def build_body(fields: dict, upload=None) -> tuple:
    boundary = uuid.uuid4().hex
    body = b""
    for name, value in fields.items():
        body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n".encode()
        body += value.encode() + b"\r\n"
    if upload is not None:
        filename, data, ctype = upload
        body += (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\";"
            f" filename=\"{filename}\"\r\nContent-Type: {ctype}\r\n\r\n"
        ).encode()
        body += data + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def test_boundary_extraction():
    assert boundary_of('multipart/form-data; boundary=abc123') == b"abc123"
    assert boundary_of('multipart/form-data; boundary="ab-c_1"') == b"ab-c_1"
    with pytest.raises(MultipartError):
        boundary_of("multipart/form-data")


def test_parse_fields_and_file():
    body, ctype = build_body({"options": '{"model":"lite"}'},
                             ("曲.mp3", b"\x00\x01binary\xff", "audio/mpeg"))
    parts = parse(body, ctype)
    assert parts["options"][0].text == '{"model":"lite"}'
    upload = parts["file"][0]
    assert upload.filename == "曲.mp3"
    assert upload.data == b"\x00\x01binary\xff"
    assert upload.content_type == "audio/mpeg"


# ------------------------------------------------------------------- server
@pytest.fixture
def server(tmp_path):
    httpd = build_server(
        SeparationOptions(model="lite", output_format="flac"),
        host="127.0.0.1", port=0, workdir=tmp_path / "jobs",
    )
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


def get_json(url: str):
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


def submit(base: str, path: Path, settings: dict):
    body, ctype = build_body(
        {"options": json.dumps(settings)},
        (path.name, path.read_bytes(), "audio/wav"),
    )
    request = urllib.request.Request(base + "/api/jobs", data=body,
                                     headers={"Content-Type": ctype})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def wait_for(base: str, job_id: str, timeout: float = 60.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = get_json(f"{base}/api/jobs/{job_id}")
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.2)
    raise AssertionError("分離が終わりませんでした")


def test_index_and_static_files_are_served(server):
    with urllib.request.urlopen(server + "/") as response:
        assert b"<title>" in response.read()
    for name in ("app.js", "style.css"):
        with urllib.request.urlopen(f"{server}/static/{name}") as response:
            assert response.status == 200


def test_config_lists_models_and_stems(server):
    config = get_json(server + "/api/config")
    assert any(model["name"] == "lite" and model["available"] for model in config["models"])
    assert {"guitar", "piano"} <= {
        stem["key"] for model in config["models"] for stem in model["stems"]
    }
    assert config["formats"] == ["wav", "flac", "mp3"]


def test_full_job_lifecycle(server, song_file):
    job = submit(server, song_file, {"model": "lite", "format": "flac",
                                     "instrumental": True})
    assert job["status"] in ("queued", "running")
    job = wait_for(server, job["id"])
    assert job["status"] == "done", job.get("error")
    names = [stem["file"] for stem in job["stems"]]
    assert "instrumental.flac" in names and "vocals.flac" in names

    with urllib.request.urlopen(server + job["stems"][0]["url"]) as response:
        assert len(response.read()) > 0
        assert "filename*=UTF-8" in response.headers["Content-Disposition"]

    with urllib.request.urlopen(f"{server}/api/jobs/{job['id']}/zip") as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))
        assert sorted(archive.namelist()) == sorted(names)

    listing = get_json(server + "/api/jobs")
    assert listing["jobs"][0]["id"] == job["id"]


def test_only_selected_stems_are_written(server, song_file):
    job = wait_for(server, submit(server, song_file,
                                  {"model": "lite", "only": ["vocals"]})["id"])
    assert [stem["key"] for stem in job["stems"]] == ["vocals"]


def test_delete_removes_job(server, song_file):
    job = wait_for(server, submit(server, song_file, {"model": "lite"})["id"])
    request = urllib.request.Request(f"{server}/api/jobs/{job['id']}", method="DELETE")
    with urllib.request.urlopen(request) as response:
        assert json.load(response)["deleted"] == job["id"]
    with pytest.raises(urllib.error.HTTPError) as info:
        get_json(f"{server}/api/jobs/{job['id']}")
    assert info.value.code == 404


def test_unknown_paths_and_bad_requests(server, song_file):
    with pytest.raises(urllib.error.HTTPError) as info:
        get_json(server + "/api/nope")
    assert info.value.code == 404

    with pytest.raises(urllib.error.HTTPError) as info:
        submit(server, song_file, {"model": "存在しないモデル"})
    assert info.value.code == 400

    body, ctype = build_body({"options": "{}"})  # ファイル無し
    request = urllib.request.Request(server + "/api/jobs", data=body,
                                     headers={"Content-Type": ctype})
    with pytest.raises(urllib.error.HTTPError) as info:
        urllib.request.urlopen(request)
    assert info.value.code == 400


def test_failure_is_reported_as_error_status(server, tmp_path):
    broken = tmp_path / "broken.wav"
    broken.write_bytes(b"this is not audio")
    job = wait_for(server, submit(server, broken, {"model": "lite"})["id"])
    assert job["status"] == "error"
    assert job["error"]
