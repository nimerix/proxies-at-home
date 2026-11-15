import { DRIVE_ID, fetchDriveImage } from "./drive";

const BROWSER_CACHE = "public, max-age=86400";
const EDGE_CACHE = "public, max-age=604800";

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(body, { status, headers });

function withCacheControl(response: Response, value: string) {
  const copy = new Response(response.body, response);
  copy.headers.set("Cache-Control", value);
  return copy;
}

async function driveImage(request: Request, ctx: ExecutionContext) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id || !DRIVE_ID.test(id))
    return json({ error: "Invalid Google Drive image ID." }, 400);
  const cache = caches.default;
  const key = new Request(
    `${url.origin}/api/cards/images/front?id=${encodeURIComponent(id)}`
  );
  const cached = await cache.match(key);
  if (cached) return withCacheControl(cached, BROWSER_CACHE);
  let image: Response;
  try {
    image = withCacheControl(await fetchDriveImage(id), EDGE_CACHE);
  } catch {
    return json(
      {
        error:
          "Could not fetch this Drive image. It must be shared publicly and be under 30 MB.",
      },
      502
    );
  }
  ctx.waitUntil(cache.put(key, image.clone()).catch(() => {}));
  return withCacheControl(image, BROWSER_CACHE);
}

export default {
  async fetch(request, _env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/health") return json({ ok: true });
    if (pathname !== "/api/cards/images/front")
      return json({ error: "Not found." }, 404);
    if (request.method !== "GET")
      return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
    return driveImage(request, ctx);
  },
} satisfies ExportedHandler;
