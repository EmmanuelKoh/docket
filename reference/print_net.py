"""
print_net.py — send to the real printer over the network.

Same loop and same server endpoints (/next, /ack) as the mock board.
The only change: it opens a network connection to the printer and sends
the bytes there. No driver, no USB.

Run the server in one terminal, then:
    python3 print_net.py
"""

import time, socket, requests

SERVER = "http://127.0.0.1:8080"
PRINTER_IP = "192.168.1.87"   # from your self-test / ping
PRINTER_PORT = 9100           # the standard "send me something to print" port


def send_to_printer(data: bytes):
    with socket.create_connection((PRINTER_IP, PRINTER_PORT), timeout=5) as s:
        s.sendall(data)


def main():
    print(f"printing from {SERVER} to {PRINTER_IP}:{PRINTER_PORT}")
    while True:
        try:
            r = requests.get(f"{SERVER}/next", params={"device": "mac-net"}, timeout=5)
        except requests.RequestException:
            print("  server unreachable, retrying…"); time.sleep(2); continue

        if r.status_code == 204:
            print("  nothing to print"); time.sleep(2); continue

        job = r.headers.get("X-Job-Id", "?")
        try:
            send_to_printer(r.content)
        except OSError as e:
            print(f"  {job}: printer unreachable ({e}) -> nack")
            requests.get(f"{SERVER}/nack", params={"job": job, "reason": "offline"})
            time.sleep(2); continue

        requests.get(f"{SERVER}/ack", params={"job": job})
        print(f"  {job}: sent {len(r.content)} bytes to the printer")
        time.sleep(2)


if __name__ == "__main__":
    main()
