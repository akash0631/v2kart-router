# v2kart-router

Landing page + pincode → vendor A/B router for v2kart.com.

Two vendors building the site: **TTU** (Think Tank Unthinkable) and **GA** (Green Audio).
Landing collects pincode → Worker splits traffic → 302 to vendor URL. Sticky via cookie.

## Architecture

- **Cloudflare Worker** (this repo) — serves landing static asset + `/route` endpoint
- **Workers KV `PINCODE_MAP`** — pincode override map (`pin:110001` → `ttu` | `ga`) + assignment logs (`log:*`, 30d TTL)
- **Cookie `v2k_vendor`** — 90d sticky assignment; same customer never split-brains across sessions
- **Split**: KV override first; unmapped pincodes → SHA-256(pincode) mod 2 → 50/50 deterministic
- **UTM tags** appended to redirect: `utm_source=v2kart_landing&utm_vendor=ttu|ga`

## Endpoints

| Path | Purpose |
|------|---------|
| `/` | Landing page (static) |
| `/route?pincode=110001` | Validates pincode → 302 redirect to vendor with UTM |
| `/health` | Liveness check |

## Setup

```bash
npm install
wrangler kv namespace create PINCODE_MAP
# copy returned id into wrangler.toml → kv_namespaces[0].id
wrangler deploy
```

## Overrides

Force a pincode to a vendor:

```bash
npm run kv:set -- pin:110001 ttu
npm run kv:set -- pin:400001 ga
```

## Vars

Set in `wrangler.toml`:
- `VENDOR_TTU_URL` — TTU prod URL
- `VENDOR_GA_URL` — Green Audio prod URL

## Domain

Godaddy → move nameservers to Cloudflare → add zone `v2kart.com` → uncomment `[[routes]]` block → redeploy.

## Assignment logs

Every `/route` hit writes `log:<ts>:<pincode>` with `{pincode, vendor, sticky, ts}`. TTL 30d.
For real analytics move to D1 or Supabase — KV logs are eyeballing only.
