# Deploying Glypad Dataset Builder to AWS

This is a step-by-step guide to putting the app on a real server so your
team can reach it from a URL, instead of it only running on your laptop.

**What this actually is:** an AWS EC2 instance (a virtual machine AWS rents
you) running Docker, with the whole app — Postgres, the backend API, and
the frontend — running in containers on it, the same containers you can
test locally with `docker compose -f docker-compose.prod.yml up -d`. There's
no managed database service involved (no RDS) — Postgres runs in its own
container on your instance, the same self-managed setup as local
development, just on a server instead of your laptop.

If you've never done anything like this before, that's completely fine —
every step below says exactly what to click or type, and why.

---

## Before you start: what you'll need

- An AWS account (if you don't have one, sign up at aws.amazon.com — it
  asks for a credit card, but the instance size below is eligible for the
  AWS Free Tier for the first 12 months on a new account).
- About 30-45 minutes for the first deployment.
- A `GEMINI_API_KEY` if you want the AI-suggest feature live in production
  (get one free at https://aistudio.google.com/apikey) — you can skip this
  and add it later, the app works fine without it.

---

## Step 1: Launch an EC2 instance

1. Sign in to the AWS Console (console.aws.amazon.com) and search for
   **"EC2"** in the top search bar.
2. Click **"Launch instance"**.
3. Fill in these fields:
   - **Name**: `glypad-dataset-builder` (or anything you'll recognize).
   - **Application and OS Images**: choose **Ubuntu**, then the newest
     "Ubuntu Server ... LTS" option (LTS = Long Term Support, the stable
     choice).
   - **Instance type**: `t3.small` is a reasonable starting point (2 GB
     RAM). If you want to stay strictly in the Free Tier, `t2.micro` or
     `t3.micro` will work for testing with a small team, though the app
     may feel slow with larger files.
   - **Key pair**: click "Create new key pair", give it a name, leave the
     defaults, and click "Create key pair" — this downloads a `.pem` file
     to your computer. **Keep this file safe and don't lose it** — it's
     the only way you can log into this server. On Mac/Linux, run
     `chmod 400 your-key-name.pem` after downloading it, or SSH will
     refuse to use it.
   - **Network settings**: click "Edit" and set up these rules (this is
     your server's firewall — it controls what's allowed to reach it):
     - SSH (port 22) — Source: "My IP" (so only you can SSH in).
     - HTTP (port 80) — Source: "Anywhere" (this is what lets your team
       reach the app in a browser).
     - HTTPS (port 443) — Source: "Anywhere" (only needed if you set up a
       real domain + HTTPS later, in Step 6 — fine to add now anyway).
   - **Storage**: the default (usually 8 GB) is enough to start; increase
     it if you expect to store a lot of files with `STORAGE_BACKEND=local`
     rather than S3.
4. Click **"Launch instance"**. Wait about a minute, then find it in your
   EC2 instance list and note its **Public IPv4 address** — you'll need
   this for the next steps.

---

## Step 2: Connect to your instance and install Docker

From a terminal on your own computer, in the folder where you saved the
`.pem` file:

```bash
ssh -i your-key-name.pem ubuntu@YOUR-INSTANCE-PUBLIC-IP
```

(Say "yes" if it asks whether to trust the host — that's normal the first
time you connect to a new server.)

Once you're connected (your terminal prompt will change to something like
`ubuntu@ip-...`), install Docker:

```bash
# Update the package list and install Docker + the Compose plugin
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Let your user run docker without typing "sudo" every time
sudo usermod -aG docker $USER
```

After that last command, type `exit` to close the SSH session, then SSH
back in (same command as above) so the permission change takes effect.
Confirm it worked:

```bash
docker --version
docker compose version
```

Both should print a version number, not an error.

---

## Step 3: Get the project onto the server

The simplest way, without needing git or GitHub set up: from **your own
computer** (not the server), copy the whole project folder over with
`scp`:

```bash
scp -i your-key-name.pem -r glypad-dataset-builder ubuntu@YOUR-INSTANCE-PUBLIC-IP:~/
```

This can take a minute or two depending on your connection. Once it's
done, back in your SSH session on the server:

```bash
cd ~/glypad-dataset-builder
ls
```

You should see `backend/`, `frontend/`, `docker-compose.prod.yml`, and so
on.

(If you later set this project up on GitHub, `git clone` /
`git pull` on the server is a nicer way to update it than re-copying the
whole folder every time — but `scp` is the simplest way to get started.)

---

## Step 4: Fill in your real production settings

Still on the server:

```bash
cp backend/.env.production.example backend/.env.production
nano backend/.env.production
```

(`nano` is a simple in-terminal text editor — arrow keys to move around,
`Ctrl+O` then Enter to save, `Ctrl+X` to exit.)

At minimum, set:

- **`SECRET_KEY`** — generate a real one by running this in a *separate*
  terminal tab (on the server or your own machine, doesn't matter, it
  just needs Python):
  ```bash
  python3 -c "import secrets; print(secrets.token_hex(32))"
  ```
  Copy the long random string it prints into `SECRET_KEY=` in the file.
  **Do not skip this** — the checked-in example value is public (it's in
  this guide!) and would let anyone forge a login.
- **`GEMINI_API_KEY`** — paste your key from Google AI Studio, or leave
  blank to deploy without AI-suggest for now.
- **`STORAGE_BACKEND`** — `s3` is recommended for production (files
  survive even if you ever replace this server). If you'd rather start
  simple with files stored on this instance's own disk, set it to `local`
  instead — that works too, just remember the files live and die with
  this specific server.
- If using S3: fill in `AWS_S3_BUCKET`, `AWS_REGION`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` for a bucket and an AWS
  user with permission to read/write it.
- **`CORS_ORIGINS`** — set this to `http://YOUR-INSTANCE-PUBLIC-IP` for
  now (or your real domain, once you have one from Step 6).

Save and exit.

---

## Step 5: Start the app

```bash
cd ~/glypad-dataset-builder
docker compose -f docker-compose.prod.yml up -d --build
```

This builds the backend and frontend images (takes a few minutes the
first time) and starts everything in the background. Watch it come up
with:

```bash
docker compose -f docker-compose.prod.yml logs -f
```

(`Ctrl+C` stops *watching* the logs — it doesn't stop the app.) You're
looking for the backend to print "Starting the API..." with no errors
above it, and the frontend container to start without complaint.

Then open `http://YOUR-INSTANCE-PUBLIC-IP` in your browser. You should
see the sign-in page. Register an account and try uploading a file to
confirm everything's actually working end to end, not just "the
containers are running."

**Note on the first deploy:** the `backend` container automatically runs
database migrations (`alembic upgrade head`) every time it starts, so the
`users`/`files`/`regions` tables get created on this first run without you
doing anything extra.

---

## Step 6 (optional, recommended once you're happy with it): a real domain + HTTPS

Right now the app is reachable at a plain HTTP address like
`http://54.123.45.67` — that works, but browsers will warn that it's not
secure, and an IP address is hard for your team to remember.

1. Buy a domain (or use one you already have) from any registrar (Route
   53, Namecheap, Google Domains, etc.).
2. In your domain's DNS settings, add an **A record** pointing your
   domain (e.g. `glypad.yourcompany.com`) at your instance's public IP.
3. On the server, install Certbot (a free tool that gets you a real
   HTTPS certificate from Let's Encrypt) and point it at your domain. The
   simplest path is to install `certbot` with the nginx plugin *outside*
   the Docker setup, temporarily stop the `frontend` container so port 80
   is free, get the certificate, then update `frontend/nginx.conf` to
   listen on 443 with that certificate and redirect port 80 to it — this
   is a bit more involved, so if you'd like, come back and I can walk you
   through wiring HTTPS into the nginx config specifically once you have
   a domain pointed at the server.
4. Update `CORS_ORIGINS` in `backend/.env.production` to your real
   `https://` domain, and restart the backend:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build backend
   ```

---

## Everyday maintenance

**Deploying a code change** (after copying updated files onto the server,
e.g. with `scp` again, or `git pull` if you've set up git):

```bash
cd ~/glypad-dataset-builder
docker compose -f docker-compose.prod.yml up -d --build
```

This rebuilds only what changed and restarts those containers — Postgres
keeps running the whole time, so you don't lose data.

**Viewing logs** (useful when something's not working):

```bash
docker compose -f docker-compose.prod.yml logs -f backend    # just the API
docker compose -f docker-compose.prod.yml logs -f frontend   # just nginx
docker compose -f docker-compose.prod.yml logs -f            # everything
```

**Backing up your database** (do this regularly — it's your team's actual
data):

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U glypad glypad > backup-$(date +%Y-%m-%d).sql
```

This writes a `backup-2026-09-25.sql` file (or whatever today's date is)
you can copy off the server with `scp` and store somewhere safe.

**Restoring from a backup** (if you ever need to):

```bash
cat backup-2026-09-25.sql | docker compose -f docker-compose.prod.yml \
  exec -T postgres psql -U glypad glypad
```

**Stopping the app** (without deleting anything):

```bash
docker compose -f docker-compose.prod.yml down
```

**Stopping and deleting all data** (careful — this is permanent):

```bash
docker compose -f docker-compose.prod.yml down -v
```

---

## A note on what's been verified vs. what hasn't

Everything in this project — the classification, tracing, 3D viewer,
manifest table, authentication, and AI-suggest features — has been
tested against a real running instance of the app during development.
The Docker deployment setup itself (this file, the `Dockerfile`s, and
`docker-compose.prod.yml`) has been written carefully and reviewed for
correctness, but wasn't run end-to-end on a real AWS server as part of
building it — that needs an actual AWS account and a running Docker
daemon, neither of which is available in the environment this project
was built in. Follow the steps above and they should work; if you hit
something that doesn't match what's described here, let me know what
happened and we'll fix it together.
