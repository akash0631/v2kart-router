# Handover — v2kart-router

**For**: Manish (and his Claude)
**From**: Akash
**Date**: 2026-07-16
**Status**: Deployed, tested, awaiting real landing HTML + vendor URLs + domain cutover

## What this repo is

Pincode-based A/B router for **v2kart.com**. Two vendors are building the V2E commerce site:

- **TTU** — Think Tank Unthinkable
- **GA** — Green Audio

Traffic split by pincode. Winner (higher conversion / lower bounce / whatever the business decides) gets all stores. This repo owns the **landing page** + the **router** that sends customers to the right vendor.

## Current state

- **Deployed**: https://v2kart-router.akash-bab.workers.dev
- **Repo**: https://github.com/akash0631/v2kart-router (public)
- **Cloudflare account**: `Akash@v2kart.com` (account id `bab06c93e17ae71cae3c11b4cc40240b`)
- **KV namespace**: `PINCODE_MAP` id `4700d379bd9a439fbf997a03f7f85ed2`

Landing HTML is a placeholder. Vendor URLs are placeholders (`ttu.v2kart.com`, `ga.v2kart.com`). Domain `v2kart.com` still on GoDaddy — nameservers not yet moved to Cloudflare.

## How it works

Single Cloudflare Worker serves three things:

| Path | Behavior |
|------|----------|
| `/` | Static landing page from `public/index.html` |
| `/route?pincode=NNNNNN` | Validates pincode → 302 redirect to vendor URL with UTM tags + sticky cookie |
| `/health` | Returns `ok` |

**Split logic** (`src/index.ts` → `resolveVendor`):
1. Check KV `pin:<pincode>` — if set to `"ttu"` or `"ga"`, use that (manual override)
2. Else `SHA-256(pincode)[0] % 2` — deterministic 50/50 (`0` = ttu, `1` = ga)
3. **Sticky**: `v2k_vendor` cookie (90d) — same browser always lands same vendor even if customer retypes pincode. Prevents split-brain.
4. **UTM tags** appended to redirect URL: `utm_source=v2kart_landing&utm_vendor=ttu|ga` so vendors' GA/Meta pixels attribute correctly.
5. **Logs**: every `/route` hit writes `log:<timestamp>:<pincode>` to KV with `{pincode, vendor, sticky, ts}`. 30-day TTL. Eyeballing only — for real analytics move to D1 or Supabase.

## What Manish needs to do next

### 1. Drop real landing page

Replace `public/index.html` with the real landing you have. **Requirement**: the pincode form must:
- Have `method="get"` and `action="/route"`
- Contain an `<input name="pincode">` (validated to `[1-9][0-9]{5}` — 6 digits, no leading 0)

Anything else in the page — hero, brand, copy, images — is free-form. Static assets (CSS/JS/images) go in `public/` alongside `index.html`.

### 2. Wire real vendor URLs

Edit `wrangler.toml`:
```toml
[vars]
VENDOR_TTU_URL = "https://<ttu-prod-url>"
VENDOR_GA_URL = "https://<ga-prod-url>"
```

Redeploy: `npm run deploy`.

### 3. Domain cutover (when ready)

1. GoDaddy → change nameservers on `v2kart.com` to Cloudflare's (Cloudflare shows them when you add the zone)
2. Cloudflare dashboard → Add site → `v2kart.com` → follow onboarding
3. Uncomment the `[[routes]]` block at the bottom of `wrangler.toml`:
   ```toml
   [[routes]]
   pattern = "v2kart.com/*"
   zone_name = "v2kart.com"
   ```
4. `npm run deploy`
5. `https://v2kart.com/` now serves the landing. `/route` on the same domain.

### 4. Pincode overrides (as vendor territories are decided)

If the business hands you a list of "these pincodes go to TTU, these go to GA":
```bash
npm run kv:set -- pin:110001 ttu
npm run kv:set -- pin:400001 ga
# ... or batch via wrangler kv bulk put
```

Any pincode not in KV falls back to hash split, which is fine as a default.

## Deploy commands

```bash
# from repo root
npm install         # first time only
npm run dev         # local dev at http://localhost:8787
npm run deploy      # push to Cloudflare
npm run tail        # live log stream
```

Requires `wrangler login` to the `Akash@v2kart.com` Cloudflare account (or a `CLOUDFLARE_API_TOKEN` env var with equivalent scopes: workers/kv/pages write, zone read).

## Access Manish needs

- **GitHub**: repo is public — read is free. For push access, Akash should add Manish as a collaborator on `akash0631/v2kart-router`.
- **Cloudflare**: needs invite to `Akash@v2kart.com` account with Workers + KV + Zone write. Otherwise Akash runs deploys and Manish PRs the code.
- **GoDaddy**: only needed for the nameserver flip in step 3.

## Smoke tests (should still pass)

```bash
curl -s https://v2kart-router.akash-bab.workers.dev/health
# → ok

curl -sI "https://v2kart-router.akash-bab.workers.dev/route?pincode=110001" | grep -E "^(HTTP|Location)"
# → HTTP/1.1 302 Found
# → Location: https://ttu.v2kart.com/?pincode=110001&utm_source=v2kart_landing&utm_medium=router&utm_vendor=ttu

curl -sI "https://v2kart-router.akash-bab.workers.dev/route?pincode=400001" | grep -E "^(HTTP|Location)"
# → HTTP/1.1 302 Found
# → Location: https://ga.v2kart.com/?pincode=400001&utm_source=v2kart_landing&utm_medium=router&utm_vendor=ga

curl -sI "https://v2kart-router.akash-bab.workers.dev/route?pincode=abc"
# → HTTP/1.1 400 Bad Request
```

## Gotchas (learned during scaffold)

- **`@cloudflare/workers-types` v4 breaks with wrangler ≥4.111** — pinned to `^5.20260710.1` in `package.json`. Don't downgrade.
- **Assets binding** uses `not_found_handling = "single-page-application"` — fine while landing is one file. If landing grows to multi-page (contact, about, etc.), swap to `"404-page"` or add explicit routes.
- **KV logs are throwaway** (30d TTL, unindexed). Do NOT build vendor performance reports off KV — build a D1 table or push to Supabase when you need real attribution.
- **Sticky cookie is per-browser, not per-user** — customer on a new device gets rehashed. Fine for A/B; not fine if you need cross-device identity (would need auth).

## Files that matter

| File | Purpose |
|------|---------|
| `src/index.ts` | Worker logic — pincode validation, split, redirect, logging |
| `public/index.html` | Landing page — REPLACE |
| `wrangler.toml` | KV binding, vendor URLs, account id, (commented) prod route |
| `package.json` | wrangler 4 + workers-types 5 |
| `README.md` | Public-facing docs |
| `HANDOVER.md` | This file |

## Contact

Anything unclear, ping Akash. Everything in this repo was built in one session — full context is in the commit history and the vault daily note (`daily/2026-07-16-v2kart-router.md` in `claude-akash-vault`).
