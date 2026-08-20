# GitGreen

> Live at **gitgreen.app**

Keep your GitHub contribution grid alive, every single day, with activity that looks like a real human's.

GitGreen is a self-hosted app with a clean, light Ollama-style interface that:

- Lets you **sign in with Privy** - one click with Google, GitHub, email or a wallet. No separate username or password needed.
- Holds a library of **365 unique, ready-made projects** (web3 tools, CLIs, APIs, bots, dashboards, scripts, games, security tools and more). Each repo ships with real, substantial code (hundreds of lines) and keeps growing over time toward thousands of lines.
- Plans activity **like a person**: commits happen every single day, never below 7, sometimes 20-60, and on rare days up to 200. Activity happens at realistic times in the morning, afternoon and evening, and repos are touched again and again so they evolve from simple to advanced over weeks.
- **Creates real repos, commits and pushes real code** on your behalf. Every repo gets a proper README with badges, a license, gitignore, and a growing set of commits (tests, docs, CI, examples, new feature modules) added on later days.
- **Mixes topics randomly** - a Web3 repo, then a CLI tool, then a bot, then a dashboard - instead of draining one category at a time.
- Guarantees **no obvious AI fingerprints**: no em dashes, no filler phrases, no generated-looking README junk, and thoughtful commit titles.

## What it looks like

- Light, modern dashboard with a GitHub-style contribution grid.
- Sign-in screen with a one-click **Continue with Privy** button (Google, GitHub, email or wallet).
- Accounts page to connect GitHub accounts (with a token) so repos can be pushed.
- Projects page showing all 365 projects and which ones are already pushed.
- Plans page showing the next two weeks of scheduled activity.
- Live activity log.
- Settings to tune activity level, and to configure Privy.

## Requirements

- Node.js 22.5 or newer (Node 24 recommended)
- Git (already installed on most machines)
- A Privy app (free) for sign-in
- A GitHub personal access token (for pushing repos)

## Setup

```bash
npm install
npm run prep       # optional: stage all 365 projects to disk
npm run build:auth # rebuild the Privy sign-in widget (already built in the repo)
npm start
```

Open http://localhost:3000 and sign in with Google, GitHub, email or a wallet.

## Privy configuration (env variables)

Privy credentials are read from environment variables and live in a `.env` file (gitignored, not exposed in the UI or database). Create `.env` at the project root:

```bash
PRIVY_APP_ID=your-app-id
PRIVY_CLIENT_ID=your-app-client-id
PRIVY_APP_SECRET=your-app-secret
```

Then `npm start` and restart. The app also reads normal environment variables if you prefer not to use `.env`.

### Enable Google and GitHub login (in Privy dashboard)

Email OTP works out of the box. For Google and GitHub social login you must configure them in the Privy dashboard:

1. Go to <https://dashboard.privy.io> and open your app.
2. **Authentication → Login methods** - enable **Google** and **GitHub**.
3. **Authentication → OAuth** - add your OAuth credentials:
   - Google: create a Google OAuth Client ID + secret at console.cloud.google.com and paste them into Privy.
   - GitHub: create a GitHub OAuth App at github.com/settings/developers (callback: `https://auth.privy.io/api/v1/oauth/callback`) and paste the Client ID + secret into Privy.

Without the OAuth credentials in the dashboard, the Google/GitHub buttons show but do not complete login. Email login needs no extra setup.

## Connect GitHub for pushing (2 minutes)

Sign-in with Privy does not grant repo access, so connect a GitHub token once in the **Accounts** page:

1. Open <https://github.com/settings/tokens/new?scopes=repo&description=gitgreen>
2. Tick **repo**, generate, and copy the token.
3. Paste it into GitGreen's Accounts page.

GitGreen uses this token to create repositories and push commits. It is encrypted and stored only on your machine.

> Sign-in is Privy-only: Google, GitHub, email or wallet. No username or password is used.

## How the autopilot works

- The scheduler generates a **14-day plan** per account: which days are active, how many commits (7-200), and at what times (stored in `data/gitgreen.db`).
- A background loop (runs every 60 seconds) executes sessions whose time has arrived. If the machine was off, recent days catch up with backdated timestamps, so the grid never has a gap.
- Each commit is either a **new repo** (one of the 365 projects) or an **incremental commit** to an existing repo: new feature modules, tests, docs, CI, examples, changelog. Repos get revisited again and again, growing from a solid start toward thousands of lines.
- Commit timestamps are set to the planned minute, so a burst of commits is spread out naturally.
- Every day gets commits. The "Full day share" setting controls how often a day gets a full random amount instead of a light 1-3 commit day, so the grid never breaks.

## Files & folders

```
server/          Express app, GitHub integration, scheduler, project engine
content/         The 365-project catalog, code generators, commit messages
public/          The web dashboard (HTML/CSS/JS)
data/            SQLite database, encryption key, generated repos (gitignored)
scripts/prep.js  Stages all 365 projects into data/work/_catalog
```

## Safety

- All repos are created **public** unless you change the `private` flag in `server/projects.js`.
- If a repo name already exists, GitGreen appends `-2`, `-3`, and so on.
- Failures are logged and the scheduler moves on, so one bad token never blocks the rest.
- You can pause an account or turn off the autopilot in Settings at any time.

## Troubleshooting

- **Google/GitHub login does nothing**: configure them in the Privy dashboard (enable the login method and add the OAuth Client ID/secret under Authentication → OAuth). Email login needs no setup.
- **Privy sign-in says "not configured"**: set `PRIVY_APP_ID`, `PRIVY_CLIENT_ID`, `PRIVY_APP_SECRET` in `.env` and restart.
- **Push failed / authentication**: make sure the GitHub token you connected has the `repo` scope. Remove the account and add it again with a fresh token.
- **Port 3000 busy**: set `PORT=4000` before starting.

## Running 24/7

For the grid to stay alive, the app should run continuously. On Windows, keep the terminal open or use Task Scheduler to launch `npm start` on boot. Later you can move it to any VPS, Docker, or a free host; the data folder moves with it.

## License

MIT
