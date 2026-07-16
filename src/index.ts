export interface Env {
  ASSETS: Fetcher;
  PINCODE_MAP: KVNamespace;
  VENDOR_TTU_URL: string;
  VENDOR_GA_URL: string;
  DEFAULT_SPLIT: string;
}

type Vendor = "ttu" | "ga";

const COOKIE_NAME = "v2k_vendor";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90d

function isValidPincode(pin: string): boolean {
  return /^[1-9][0-9]{5}$/.test(pin);
}

async function hashSplit(pin: string): Promise<Vendor> {
  const buf = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const byte = new Uint8Array(digest)[0];
  return byte % 2 === 0 ? "ttu" : "ga";
}

function getCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

function vendorUrl(v: Vendor, env: Env, pincode: string): string {
  const base = v === "ttu" ? env.VENDOR_TTU_URL : env.VENDOR_GA_URL;
  const u = new URL(base);
  u.searchParams.set("pincode", pincode);
  u.searchParams.set("utm_source", "v2kart_landing");
  u.searchParams.set("utm_medium", "router");
  u.searchParams.set("utm_vendor", v);
  return u.toString();
}

async function resolveVendor(pincode: string, env: Env): Promise<Vendor> {
  const mapped = await env.PINCODE_MAP.get(`pin:${pincode}`);
  if (mapped === "ttu" || mapped === "ga") return mapped;
  return hashSplit(pincode);
}

async function logAssignment(pincode: string, vendor: Vendor, sticky: boolean, env: Env): Promise<void> {
  const key = `log:${Date.now()}:${pincode}`;
  await env.PINCODE_MAP.put(key, JSON.stringify({ pincode, vendor, sticky, ts: Date.now() }), {
    expirationTtl: 60 * 60 * 24 * 30,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname === "/route") {
      const pincode = (url.searchParams.get("pincode") || "").trim();

      if (!isValidPincode(pincode)) {
        return new Response(JSON.stringify({ error: "invalid_pincode" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const sticky = getCookie(request, COOKIE_NAME) as Vendor | null;
      const vendor: Vendor = sticky === "ttu" || sticky === "ga" ? sticky : await resolveVendor(pincode, env);
      const target = vendorUrl(vendor, env, pincode);

      await logAssignment(pincode, vendor, !!sticky, env);

      const headers = new Headers({ Location: target });
      if (!sticky) {
        headers.append(
          "Set-Cookie",
          `${COOKIE_NAME}=${vendor}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; Secure`
        );
      }
      return new Response(null, { status: 302, headers });
    }

    return env.ASSETS.fetch(request);
  },
};
