# Conference Ops

A small internal web app for tracking conferences/events, registration and
vendor fees, which staff are attending under which project, and each
person's own travel details (accommodations, transportation, meetings,
people to talk to, important sessions).

- Real accounts (username + password), not a shared login
- Two roles: **admin** (manages events, accounts, branding, can view/edit
  anyone's data, can export everything) and **staff** (manages their own
  attendance and travel info)
- Data lives in a local SQLite file on your server — nothing is stored with
  Claude or any third party
- Your logo, company name, and accent color are configurable from the Admin
  panel

---

## 1. Requirements

- A server you control (a DigitalOcean droplet is the easiest fit — see
  below). DreamHost's **shared hosting** does not run Node.js apps
  reliably; if you want to stay with DreamHost, use their **VPS** product
  instead, which works the same way as a droplet.
- Node.js 18 or newer
- That's it — the database is a local file (SQLite), so there's no separate
  database server to install.

## 2. Local setup (do this first, on your own machine, to make sure it works)

```bash
cd conference-ops
npm install
cp .env.example .env
```

Open `.env` and set:
- `SESSION_SECRET` — generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_NAME` — these create your
  first admin account the very first time the app starts. You can change
  the password later from inside the app, or from the Admin > Users tab
  once you're logged in.
- Leave `NODE_ENV` unset for now (only set it to `production` once you're
  running behind HTTPS — see step 4).

Then start it:

```bash
npm start
```

Visit `http://localhost:3000/login.html`, log in with the admin account
from your `.env`, and click around: add an event, add a staff account,
mark someone attending, fill in some travel details, try the export.
Once you're happy, move on to deploying it.

## 3. Deploying to a DigitalOcean droplet

**Create the droplet**
1. In the DigitalOcean dashboard, create a new Droplet — Ubuntu 24.04 LTS,
   the cheapest "Basic" plan is plenty for a team of a handful of people.
2. Note the droplet's IP address.

**Point a domain at it (optional but recommended)**
If you have a domain (or a subdomain like `conferences.yourcompany.com`),
add an A record pointing it at the droplet's IP. This makes SSL (step 4)
straightforward. You can skip this and use the bare IP address, but then
you can't get a free HTTPS certificate from Let's Encrypt.

**SSH in and install Node**
```bash
ssh root@your-droplet-ip

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs nginx
npm install -g pm2
```

**Upload the app**
From your own machine, copy the project folder to the server (adjust the
path/IP):
```bash
scp -r conference-ops root@your-droplet-ip:/opt/conference-ops
```

**Install and configure on the server**
```bash
ssh root@your-droplet-ip
cd /opt/conference-ops
npm install --omit=dev
cp .env.example .env
nano .env   # fill in SESSION_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_NAME
```
Set `NODE_ENV=production` in `.env` now, since step 4 puts HTTPS in front
of this.

**Start it with PM2** (keeps it running, restarts it if it crashes or the
server reboots)
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # run the command this prints, to survive server reboots
```

Check it's alive: `curl http://localhost:3000/login.html` should return
HTML.

## 4. Put Nginx + HTTPS in front of it

Running the app directly is fine for testing but it's plain HTTP. Nginx as
a reverse proxy plus a free Let's Encrypt certificate gets you a real
`https://` URL.

```bash
apt-get install -y certbot python3-certbot-nginx
```

Create `/etc/nginx/sites-available/conference-ops`:
```nginx
server {
    listen 80;
    server_name conferences.yourcompany.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it and get a certificate:
```bash
ln -s /etc/nginx/sites-available/conference-ops /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d conferences.yourcompany.com
```

Certbot edits the config to redirect HTTP to HTTPS and sets up
auto-renewal. Visit `https://conferences.yourcompany.com` and you should
land on the login page.

## 5. First login and locking things down

1. Log in with the admin account from `.env`.
2. Go to **Admin > Users** and create real accounts for everyone —
   individual usernames and passwords, per your earlier answer. Give each
   person the "Staff" role; keep "Admin" for whoever should be able to
   manage everyone's data.
3. Go to **Admin > Branding** to upload your logo and set your company
   name / accent color.
4. Change the bootstrap admin password (or delete that account once you've
   made a proper named admin account for yourself).
5. Go to **Projects** and add your project list — this feeds the
   multi-select when staff mark which project they're attending an event
   under.

## 6. Backing up your data

Everything lives in `db/data.sqlite` on the server. Back it up like any
file, e.g.:
```bash
scp root@your-droplet-ip:/opt/conference-ops/db/data.sqlite ./backup-$(date +%F).sqlite
```
Consider putting this on a cron job.

## 7. Updating the app later

```bash
# from your own machine (not the droplet)
scp -r conference-ops root@your-droplet-ip:/opt/conference-ops-new
```

Then on the droplet:

```bash
ssh root@your-droplet-ip
cd /opt/conference-ops-new
cp ../conference-ops/.env .
cp ../conference-ops/db/data.sqlite db/
npm install --omit=dev
```

If `npm install` fails while compiling `better-sqlite3` with an error
mentioning `make` or `node-gyp`, the server is missing basic build tools —
install them once with `apt-get install -y build-essential` and re-run
`npm install --omit=dev`.

Once the install finishes cleanly (no `npm error` lines), test it directly
before trusting PM2 with it:
```bash
node server.js
```
You should see `Conference Ops running on http://localhost:3000` with no
errors. `Ctrl+C` to stop it, then swap PM2 over to the new folder —
`pm2 restart` on its own won't pick up a new directory, so delete and
re-add it instead:
```bash
pm2 delete conference-ops
pm2 start ecosystem.config.js
pm2 save
```
`pm2 list` should show `status: online` with a restart count of `0` and
climbing memory usage that then levels off (a restart count that keeps
climbing means it's crash-looping — see the Troubleshooting section).

Once you've confirmed the site works, you can remove the old folder:
```bash
rm -rf /opt/conference-ops
```
(Database migrations run automatically on startup and only ever add new
columns/tables — they never delete or modify existing data, so upgrading
is safe even between versions with schema changes.)

## Project structure

```
conference-ops/
  server.js              Express app entrypoint
  db/
    db.js                SQLite schema + first-run admin bootstrap
    attendanceHelpers.js  Shared read/write logic for a person's event attendance
    data.sqlite          Created automatically on first run (not in git)
  middleware/
    auth.js               requireAuth / requireAdmin route guards
  routes/
    auth.js                Login, logout, change password
    events.js              Event CRUD + self-service attendance
    me.js                  A staff member's own travel data
    projects.js             Project list
    admin.js                Users, cross-staff editing, export, branding, logo
    settings.js             Public branding read (for the login page)
  public/
    login.html, app.html, shared.css, app.css, app.js
    uploads/               Uploaded logo lives here
  ecosystem.config.js      PM2 config
  .env.example             Copy to .env and fill in
```

## A few honest limitations

- No password-reset-by-email flow — if someone forgets their password, an
  admin resets it for them from Admin > Users.
- Session store is a local file (`db/sessions/`) — fine for a small team on
  one server; if you ever run multiple server instances behind a load
  balancer, you'd want a shared session store instead.
- No automatic database backups — see step 6, that's on you (or a cron job).

## Troubleshooting

**502 Bad Gateway from the site:**
Nginx is up but nothing answered on port 3000. Run `pm2 list` — if
`conference-ops` isn't `online`, run `node server.js` directly (not
through PM2) to see the real error. Common causes we've hit:
- `node_modules` missing or incomplete — re-run `npm install --omit=dev`
  and watch it complete with no `npm error` lines.
- `better-sqlite3` failing to compile — install `build-essential`
  (`apt-get install -y build-essential`) and reinstall.
- Wrong Node.js version — `better-sqlite3` needs Node 22+; check with
  `node -v`.
- PM2 pointed at the wrong folder after an update — `pm2 restart` doesn't
  pick up a new directory, use `pm2 delete conference-ops` then
  `pm2 start ecosystem.config.js` from inside the correct folder.

**Login seems to succeed but immediately bounces back to the sign-in page:**
This means the session cookie isn't being set. Almost always caused by
`app.set('trust proxy', 1)` being missing from `server.js` — without it,
Express doesn't realize Nginx is terminating HTTPS for it and refuses to
set the `secure` cookie. This is already in the shipped `server.js`; if
you've hand-edited the file on the server before, a later `npm install`
or file copy can silently revert it — check it's still there.

**Clicking Save (or another button) does nothing, no errors visible:**
Check DevTools → Network tab with "Disable cache" checked, then look at
the actual request. A `304 Not Modified` with no payload usually means
the browser served a stale cached response — hard-reload with
`Cmd+Shift+R` (Mac) and try again.

**A specific droplet command fails with "command not found" or a path
that doesn't exist:**
Double-check which machine you're actually running it on. Your terminal
prompt tells you: `cmhockenberry@CMs-Mac-mini` means you're on your Mac,
`root@AE-Conference-Tracker` means you're on the droplet. `scp` always
runs from your Mac (it's the one command that reaches out to the
droplet); nearly everything else in this README runs after you've `ssh`'d
in.
