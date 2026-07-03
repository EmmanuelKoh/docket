"""
print_usb.py — the REAL-printer version of mock_board.py.

Same loop, same server endpoints (/next, /ack, /nack). The only change:
instead of saving a PNG, it sends the bytes straight to the thermal printer
over USB. This prints your actual pipeline on real paper.

Setup:
    pip install pyserial requests
    ls /dev/cu.*          # find your printer, set PORT below

Run server in one terminal, then:
    python print_usb.py
"""

import time, sys, requests, serial

SERVER = "http://127.0.0.1:8080"

# from `ls /dev/cu.*` — e.g. /dev/cu.usbserial-1420 or /dev/cu.usbmodem1101
PORT = "/dev/cu.usbserial-XXXX"
BAUD = 19200   # matches the printer self-test (19200, None, 8, 1)


def main():
    try:
        printer = serial.Serial(PORT, BAUD, timeout=2)
    except serial.SerialException as e:
        print(f"can't open {PORT}: {e}")
        print("run `ls /dev/cu.*` and set PORT to the printer's path")
        sys.exit(1)

    print(f"printing from {SERVER} to {PORT} @ {BAUD}")
    while True:
        try:
            r = requests.get(f"{SERVER}/next", params={"device": "mac-usb"}, timeout=5)
        except requests.RequestException:
            print("  server unreachable, retrying…"); time.sleep(2); continue

        if r.status_code == 204:
            print("  nothing to print"); time.sleep(2); continue

        job = r.headers.get("X-Job-Id", "?")
        printer.write(r.content)        # <-- the real print
        printer.flush()
        requests.get(f"{SERVER}/ack", params={"job": job})
        print(f"  {job}: sent {len(r.content)} bytes to the printer")
        time.sleep(2)


if __name__ == "__main__":
    main()
