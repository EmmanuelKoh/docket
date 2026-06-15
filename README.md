# Mac dev harness — print without a printer or ESP32

Build and test the whole print flow on your Mac. No hardware needed until the
very end, when you swap the mock board for the real ESP32 (same endpoints).

## Pieces
- `render.py`    — content -> ESC/POS printer bytes (PNG or plain text)
- `server.py`    — holds a job queue, hands bytes to whoever polls, tracks ack/nack
- `mock_board.py`— a fake ESP32: polls, "prints" by saving an image, acks/nacks
- `jobs/`        — drop PNGs here; they get queued on server start

## Setup
    pip install python-escpos pillow flask requests

## Run the loop
Terminal 1:
    python server.py
Terminal 2:
    python mock_board.py --interval 2

Each job in the queue gets "printed" as `out_<job>.png` — open it to see exactly
what the paper would show.

## Add jobs
    # an image you designed in the Receipt Studio (exported as ticket.png)
    cp ~/Downloads/ticket.png jobs/ && curl -X POST localhost:8080/enqueue \
        -H 'Content-Type: application/json' -d '{"png":"ticket.png"}'

    # or quick text
    curl -X POST localhost:8080/enqueue \
        -H 'Content-Type: application/json' -d '{"text":"buy milk\nand eggs"}'

## Prove it never loses a print
    python mock_board.py --paper-out     # refuses every job; check /status — they stay queued
    python mock_board.py --die-after 1   # prints one, "goes offline"; the next stays waiting
    curl localhost:8080/status           # see what's waiting vs in-flight

## The design half
Open `receipt-design-studio.html` in a browser. Edit the ticket, see it at the
printer's true width, toggle the thermal (1-bit) view to see the real output,
then "Download print PNG" and drop it in `jobs/`.

## When the hardware arrives
The real ESP32 hits the same `/next`, `/ack`, `/nack`. Point its `SERVER` at
your Mac's IP and delete nothing — the mock board was just standing in for it.
