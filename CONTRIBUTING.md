# Contributing

Thanks for your interest in contributing! This is a casual, community-driven
project and contributions of all kinds are welcome.

## Ways to Contribute

### Report Bugs

Found something that's not working? Open an issue and include:

- What you were trying to do
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (OS, Node version, printer model if relevant)

### Suggest Features

Open an issue with a clear description of what you'd like to see, why it
would be useful, and any implementation ideas you have.

### Submit Code

1. Fork the repo
2. Create a branch (`git checkout -b cool-new-feature`)
3. Make your changes
4. Test your changes against the local server
5. Commit and push
6. Open a Pull Request describing what you changed and how you tested it

### Improve Documentation

Fix typos, add examples, or clarify confusing sections. Documentation PRs
are always welcome.

## Development Setup

```bash
git clone https://github.com/EmmanuelKoh/docket.git
cd docket
npm install
cp .env.example .env   # set DASHBOARD_PASSWORD and SESSION_SECRET
npm start              # http://localhost:3000
```

The default `STORE_DRIVER=json` keeps all state in local files under
`data/`, so you don't need Redis, a Vercel account, or a printer to develop.
Two optional helpers:

```bash
node agent/printer-agent.js   # fake printer: polls /next, sends to TCP
node agent/heartbeat.js       # POSTs /tick to drive plugin runs
```

Note: restart the server after editing files in `views/` (LiquidJS caches
compiled templates). CSS changes only need a browser refresh.

## Code Guidelines

We're not super strict, but a few rules keep this codebase working:

- All Redis/Blob/file access goes through the store facades in `lib/`.
  New state means implementing both the `json` and `redis` drivers.
- Read `docs/store-costs.md` before adding any polled or timer-driven
  store query. The hosted stores bill per operation.
- Plugins only talk to the world through `ctx` (`createJob`,
  `getTemplate`, `log`). See `plugins/index.js` for the contract.
- Update `docs/design-spec.md` when you change the dashboard UI.
- Add new env vars to `.env.example` and the README table.
- Never commit secrets or personal data. `data/`, `.env` and `secrets.h`
  are gitignored; use placeholder domains and numbers in docs.

## Questions?

Open an issue. Happy to help.
