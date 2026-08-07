# Netrunner Collection Tracker

A personal, local-first web app for tracking a physical *Android: Netrunner*
card collection: import the full card catalog, record what you own, and see
completion percentages per set.

Phase 1 covers collection tracking and reporting. Phase 2 adds deck
tracking: import a published NetrunnerDB decklist and see how much of it
you own. Full deckbuilding ("what can I build with what I own", in-app
deck editing, MWL/legality checking) is still a future phase.

## Features

- **Full card catalog** — every card from both the original FFG era
  (2012–2018) and the ongoing Null Signal Games continuation, imported from
  the community NetrunnerDB dataset (~2,500 cards across ~75 sets).
- **Collection builder** — search for a card, pick a quantity, add it to
  your collection (adds to what you already own). An alternative **Batch
  mode**, settable on `/settings`, lets you start a batch with an expected
  card count, add cards to it as you sort a physical pile, then Review
  (Approve to merge into your collection, or Discard) once you're done —
  handy for logging a big pickup in one sitting instead of one card at a
  time.
- **Set completion reports** — see what percentage of each set you own,
  and an overall collection total.
- **Set browser** — view every card in a set, see what's missing, and
  correct owned quantities directly (overwrites the count).
- **Deck tracking** — import a published NetrunnerDB decklist by URL or
  ID and see how much of it you own, card by card.

## Tech stack

Next.js (App Router) + TypeScript, Prisma + SQLite, Tailwind CSS, Vitest.

## Local development

Requires Node.js 20+.

```bash
git clone <repo-url>
cd netrunner
npm install            # installs dependencies; generates the Prisma client
npm run setup          # creates/migrates the SQLite database schema
npm run import-cards   # populates the database from NetrunnerDB data
npm run dev            # starts the app at http://localhost:3000
```

`npm run setup` must run before `npm run import-cards` or `npm run dev` —
neither creates the SQLite schema itself.

Other useful commands:

- `npm test` — run the test suite.
- `npm run build` — production build.
- `npm start` — serve a production build (run `npm run build` first).

## Local dev through nginx (optional)

To test the app through a proxy and a local hostname instead of hitting
`localhost:3000` directly — e.g. to reproduce proxy/HMR-related issues —
`deploy/nginx.dev.conf` sets up `http://netrunner.test` pointing at the
`npm run dev` server on this machine. No TLS, no systemd — just a local
hostname (via `/etc/hosts`) and a plain HTTP reverse proxy with WebSocket
support for hot reload. Setup steps are in the comment header of that file.

This is separate from the production setup below, which builds the app
and serves it via `next start` + systemd instead of the dev server.

## Production deployment (nginx + systemd)

This app is a persistent Node.js server (`next start`), not a static site —
it has API routes and Server Actions, so something needs to keep it running
continuously, and nginx needs to reverse-proxy to it. Ready-to-adapt
templates live in `deploy/`:

- `deploy/netrunner.service` — a systemd unit that runs `npm start` as a
  long-lived service, restarting automatically on crash or reboot.
- `deploy/nginx.conf` — an nginx server block that reverse-proxies a
  domain to the app.

### Steps

1. Clone the repo to its deployment location (e.g. `/var/www/netrunner`)
   and run the local-development setup above (`npm install`, `npm run
   setup`, `npm run import-cards`) on the server.
2. Build for production: `npm run build`.
3. Copy `deploy/netrunner.service` to `/etc/systemd/system/netrunner.service`,
   edit the placeholders inside it (deployment path, running user), then:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now netrunner
   sudo systemctl status netrunner
   ```
4. Copy `deploy/nginx.conf` into your nginx sites directory (e.g.
   `/etc/nginx/sites-available/netrunner.conf`, then symlink it into
   `sites-enabled/`), replace the placeholder domain
   (`netrunner.example.com`) with your real one, then:
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```
5. (Optional but recommended) Add TLS with [Certbot](https://certbot.eff.org/)
   once the domain resolves and nginx is serving it over plain HTTP:
   `sudo certbot --nginx -d your-domain`.

After a `git pull`, re-run `npm install && npm run build` and
`sudo systemctl restart netrunner`. Re-run `npm run import-cards` whenever
Null Signal Games releases a new set — it's idempotent and safe to run
repeatedly.

**Security note:** this is still a single-user, local-database app with no
authentication — that was a deliberate phase-1 design choice. Deploying it
behind nginx makes it reachable over the network, but does not add a login.
Don't expose it to the public internet without adding authentication first
(e.g. nginx `auth_basic`, or a VPN/private network).

## Project structure

See `CLAUDE.md` for the full architecture/data-model orientation, and
`docs/superpowers/` for the original design spec and implementation plan.
