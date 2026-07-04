# Questr collage API (self-hosted on Vultr)

The always-on service that receives the day's photos, runs the optimizer/
evaluator collage engine (OpenRouter vision + Pillow), and uploads the finished
`collage.jpg` to S3. Replaces the Lambda **and** GitHub Actions — no GitHub
token anywhere.

```
Browser (Questr, Cloudflare Pages)
   │  POST /build  (multipart: 3–6 photos)
   ▼
Vultr box  ──►  collage engine  ──►  S3  <date>/<id>/collage.jpg  (public-read)
   │  202 {collageUrl}                         ▲
   ◀───────── browser polls collageUrl ────────┘  (shows it inline)
```

Endpoints: `POST /build` (the work), `GET /healthz` (liveness).

---

## 1. Create the box

Vultr → Deploy → **Ubuntu 24.04**, "Regular Cloud Compute", the ~$6/mo /
1 GB plan is plenty. Add your SSH key. Note its public IP.

## 2. Create a scoped AWS key for the box

Don't put an admin key on a public server. Create a user that can *only* write
collages (run locally with your admin creds in `.env`):

```bash
set -a; . ./.env; set +a          # loads ACCESS_KEY / SECRET_ACCESS_KEY
export AWS_ACCESS_KEY_ID=$ACCESS_KEY AWS_SECRET_ACCESS_KEY=$SECRET_ACCESS_KEY AWS_DEFAULT_REGION=eu-west-3

aws iam create-user --user-name questr-signer
aws iam put-user-policy --user-name questr-signer \
  --policy-name s3-put-collages \
  --policy-document file://infra/s3-put-policy.json
aws iam create-access-key --user-name questr-signer      # copy the key + secret
```

## 3. Provision the box

```bash
ssh root@<box-ip>
# on the box:
curl -fsSL https://raw.githubusercontent.com/ljo3/questr/main/server/setup.sh -o setup.sh
bash setup.sh          # installs deps, systemd service, Caddy, firewall
```

Then fill in secrets and the hostname:

```bash
nano /etc/questr/questr.env      # OPENROUTER_API_KEY + the questr-signer key
systemctl restart questr-api

nano /etc/caddy/Caddyfile         # set hostname (see TLS below)
systemctl reload caddy
```

## 4. TLS (pick one)

- **No domain (fastest):** use [sslip.io](https://sslip.io) — the hostname *is*
  the IP. A box at `203.0.113.9` → `203-0-113-9.sslip.io`. Put that in the
  Caddyfile; Caddy fetches a real Let's Encrypt cert automatically. Done.
- **Own a domain:** point an `A` record at the box IP and use that hostname in
  the Caddyfile. (If it's a Cloudflare zone, set the record to **DNS-only /
  grey-cloud** so Caddy can complete the ACME challenge — or use a Cloudflare
  Tunnel instead of opening ports.)

Verify: `curl https://<host>/healthz` → `{"ok":true,"vision":true,...}`

## 5. Point the frontend at it

```bash
# .env (local) and Cloudflare Pages → Settings → Environment variables
VITE_QUESTR_API_URL=https://<host>
```

Rebuild/redeploy the site. Open the Journal, upload 3+ photos, tap
**Create collage now** — the box builds it (~a minute) and it appears inline.

---

## Operating notes

- Logs: `journalctl -u questr-api -f`
- Update code: re-run `bash setup.sh` (it `git pull`s and restarts).
- The box holds live secrets in `/etc/questr/questr.env` (root, `chmod 600`).
  Keep the box patched and the firewall on (setup.sh enables UFW: SSH + 80/443).
- Concurrency is capped at 2 simultaneous builds (`server/app.py`).
