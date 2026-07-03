"""
server.py — the brain. Runs on your Mac (or any always-on box later).

It holds a queue of things to print. The endpoint (real ESP32, or the mock
board in this harness) asks /next, prints, then says /ack (done) or /nack
(failed — put it back). Nothing is marked done until the endpoint confirms.

Endpoints:
  POST /enqueue   body: a PNG filename in ./jobs, or {"text": "..."}  -> queues a job
  GET  /next?device=ID    -> 200 + ESC/POS bytes (+ X-Job-Id header), or 204 if empty
  GET  /ack?job=ID        -> mark done
  GET  /nack?job=ID       -> put back at the front of the queue
  GET  /preview/<job>     -> the source PNG (so the mock board can show what 'printed')
  GET  /status            -> queue + in-flight, for eyeballing

Run:  python server.py     (listens on http://0.0.0.0:8080)
Seed: drop PNGs in ./jobs and POST their names, or use load_jobs() on boot.
"""

import os, itertools, threading
from flask import Flask, request, Response, jsonify, send_file
import render

app = Flask(__name__)
JOBS_DIR = "jobs"

_lock = threading.Lock()
_ids = itertools.count(1)
_queue = []      # list of job dicts waiting to print
_inflight = {}   # job_id -> job dict, handed out but not yet acked


def _job_from_png(name):
    path = os.path.join(JOBS_DIR, name)
    return {"id": f"job{next(_ids)}", "kind": "png", "src": path,
            "bytes": render.from_image(path)}

def _job_from_text(text):
    return {"id": f"job{next(_ids)}", "kind": "text", "src": text,
            "bytes": render.from_text(text)}


def load_jobs():
    """Queue every PNG sitting in ./jobs at startup."""
    if not os.path.isdir(JOBS_DIR):
        return
    for name in sorted(os.listdir(JOBS_DIR)):
        if name.lower().endswith(".png"):
            with _lock:
                _queue.append(_job_from_png(name))


@app.post("/enqueue")
def enqueue():
    data = request.get_json(silent=True) or {}
    with _lock:
        if "text" in data:
            job = _job_from_text(data["text"])
        else:
            name = data.get("png") or request.data.decode().strip()
            job = _job_from_png(name)
        _queue.append(job)
    return jsonify(queued=job["id"])


@app.get("/next")
def next_job():
    with _lock:
        if not _queue:
            return ("", 204)
        job = _queue.pop(0)
        _inflight[job["id"]] = job
    r = Response(job["bytes"], mimetype="application/octet-stream")
    r.headers["X-Job-Id"] = job["id"]
    return r


@app.get("/ack")
def ack():
    jid = request.args.get("job")
    with _lock:
        _inflight.pop(jid, None)
    return jsonify(acked=jid)


@app.get("/nack")
def nack():
    jid = request.args.get("job")
    with _lock:
        job = _inflight.pop(jid, None)
        if job:
            _queue.insert(0, job)   # back to the front, try again next round
    return jsonify(requeued=jid, reason=request.args.get("reason"))


@app.get("/preview/<job>")
def preview(job):
    with _lock:
        j = _inflight.get(job)
    if j and j["kind"] == "png":
        return send_file(os.path.abspath(j["src"]), mimetype="image/png")
    return ("no preview", 404)


@app.get("/status")
def status():
    with _lock:
        return jsonify(waiting=[j["id"] for j in _queue],
                       inflight=list(_inflight.keys()))


if __name__ == "__main__":
    load_jobs()
    print(f"queued {len(_queue)} job(s) from ./{JOBS_DIR}")
    app.run(host="0.0.0.0", port=8080)
