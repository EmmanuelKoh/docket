"""
mock_board.py — a fake ESP32, so you can build the whole print flow with no
hardware. It does exactly what the real firmware will do: poll /next, check
'paper', 'print', then /ack — or /nack on failure.

Instead of burning paper, it saves what would have printed as out_<job>.png
(when the job is an image) plus the raw bytes as out_<job>.bin. Open the PNG
to see the result.

You can fake problems to test the retry path:
  python mock_board.py                 normal: prints everything in the queue
  python mock_board.py --paper-out     refuses every job (nacks); server keeps them
  python mock_board.py --die-after 1   prints 1, then 'goes offline' mid-run
  python mock_board.py --interval 3    poll every 3s (default 5)
"""

import argparse, time, sys, requests

SERVER = "http://127.0.0.1:8080"


def run(interval, paper_out, die_after):
    print(f"mock board polling {SERVER} every {interval}s "
          f"(paper_out={paper_out}, die_after={die_after})")
    printed = 0
    while True:
        try:
            r = requests.get(f"{SERVER}/next", params={"device": "mock-01"}, timeout=5)
        except requests.RequestException:
            print("  server unreachable, retrying…")
            time.sleep(interval); continue

        if r.status_code == 204:
            print("  nothing to print"); time.sleep(interval); continue

        job = r.headers.get("X-Job-Id", "?")
        data = r.content

        # --- this is the honest part the Windows version skips ---
        if paper_out:
            print(f"  {job}: paper out -> nack (server will keep it)")
            requests.get(f"{SERVER}/nack", params={"job": job, "reason": "paper"})
            time.sleep(interval); continue

        if die_after is not None and printed >= die_after:
            print(f"  {job}: 'offline' before acking -> server keeps it, exiting")
            sys.exit(0)   # job was handed out but never acked -> stays in-flight/retried

        # 'print': save the bytes, and the picture if the server has one
        with open(f"out_{job}.bin", "wb") as f:
            f.write(data)
        try:
            p = requests.get(f"{SERVER}/preview/{job}", timeout=5)
            if p.status_code == 200:
                with open(f"out_{job}.png", "wb") as f:
                    f.write(p.content)
                print(f"  {job}: printed -> out_{job}.png  ({len(data)} bytes)")
            else:
                print(f"  {job}: printed text -> out_{job}.bin  ({len(data)} bytes)")
        except requests.RequestException:
            print(f"  {job}: printed -> out_{job}.bin  ({len(data)} bytes)")

        requests.get(f"{SERVER}/ack", params={"job": job})
        printed += 1
        time.sleep(interval)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", type=float, default=5)
    ap.add_argument("--paper-out", action="store_true")
    ap.add_argument("--die-after", type=int, default=None)
    a = ap.parse_args()
    run(a.interval, a.paper_out, a.die_after)
