# DOCKET

DOCKET connects a thermal receipt printer to the internet. You host DOCKET
as your own website. A job is one receipt that DOCKET sends to the printer. A
small computer board next to the printer fetches the jobs from the website
and sends them to the printer. Several accounts can share one printer.

In the dashboard, the website's signed-in pages, you can print:

- a receipt you design;
- a photo;
- a melody you record, written out as notes.

Some slips also print on their own, on a schedule or when a message
arrives. A slip is a kind of receipt on the dashboard's Slips page.

<table>
  <tr>
    <td valign="top"><img src="docs/images/receipt-daily-brief.png" width="240" alt="Daily Brief receipt: Friday, 3 meetings, 72 degrees with a 20% chance of rain, three schedule lines and a focus bar"></td>
    <td valign="top"><img src="docs/images/receipt-task.png" width="240" alt="Task receipt: a 'Before leaving' checklist with three items, the sender and the original message"></td>
    <td valign="top"><img src="docs/images/receipt-wc-goal.png" width="240" alt="World Cup goal receipt: Portugal 1, Uzbekistan 0, with the scorer, minute and assist"></td>
  </tr>
  <tr>
    <td valign="top">Morning brief. Your meetings and the weather, at a set time each morning.</td>
    <td valign="top">Task. The tasks in a text message that you forward from your phone.</td>
    <td valign="top">World Cup goal. Prints when a team scores. Kickoffs and final scores print too.</td>
  </tr>
</table>

The images use sample data. Each one is the exact black-and-white picture
that the printer receives.

## Status

Everything on this page works today on one hosted copy with one printer,
a Rongta RP850 on 80 mm paper. Its board is an ESP32, a small computer
board with Wi-Fi. The [build guide](docs/receipt-printer-build-guide.md)
lists the exact parts. One person maintains DOCKET, and the maintainer's
copy is invite-only. One printer stays inside the free plans of the
hosting services ([hosting costs](docs/store-costs.md)).

## What you need

| To | You need |
|---|---|
| Try DOCKET on your computer | Node 22.12 or later. No printer and no cloud account |
| Print on paper | An 80 mm thermal receipt printer that understands ESC/POS, the command language of most receipt printers |
| Use a printer with a serial port (a 9-pin connector), like the RP850 | An ESP32 board and a serial adapter, a small part that converts the board's signals for the printer's port. The [build guide](docs/receipt-printer-build-guide.md) has the parts and the wiring |
| Use a network printer that accepts jobs on port 9100 | No board. The printer agent, a script on your computer, fetches the jobs and sends them to the printer |
| Host your own copy | An account on Vercel, a website hosting service. The [deploy guide](docs/deploy.md) adds three storage services from inside Vercel |

## Try it on your computer

1. Clone the repository:

   ```
   git clone https://github.com/EmmanuelKoh/docket.git
   ```

2. Go into its folder: `cd docket`
3. Install the dependencies: `npm install`
4. Copy the example settings file: `cp .env.example .env`
5. Create your account. The script asks for a password.

   ```
   node scripts/create-user.js "Your Name" you@example.com
   ```

6. Note the account id that the script shows.
7. In `.env`, set `OWNER_ID` to your account id.
8. Start DOCKET: `npm run dev`
9. Open http://localhost:3000.
10. Sign in with your email and password.

To watch a job finish with no printer:

1. In a second terminal, start the printer agent. With this setting, it
   saves each job as a file in `data/prints/`.

   ```
   PRINTER_IP=file:data/prints node agent/printer-agent.js
   ```

2. In the dashboard, open a slip on the Slips page.
3. Select Print test.
4. Open History. The job shows as done.

## Documentation

Set up and use DOCKET:

- [Host your own copy](docs/deploy.md)
- [Build the printer and board](docs/receipt-printer-build-guide.md)
- [Slips that print on their own](docs/plugins.md), and how to write one
- [Design a receipt](docs/template-authoring.md)
- [Forward text messages from an Android phone](android-forwarder/README.md)
- [Configuration](docs/configuration.md): the main settings, and where data
  lives. `.env.example` lists every variable
- [Hosting costs](docs/store-costs.md): what each request costs on the
  free plans

Work on the code:

- [Contributing](CONTRIBUTING.md): development setup, checks, where code goes
- [Architecture](docs/architecture.md): how the parts fit together
- [Hosting costs](docs/store-costs.md): the rules for code that runs on a timer
- [Dashboard design](docs/design-spec.md)
- [RP850 field notes](docs/rp850-field-notes.md): measured printer behavior
- [Tape transcription](docs/tape-transcription-v2.md): how a recording becomes notes
- [Test on a phone](docs/local-phone-debugging.md)
- [Report a security problem](SECURITY.md)

## License

MIT ([LICENSE](LICENSE)). Some files come from other projects and keep
their own licenses. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists
them.
