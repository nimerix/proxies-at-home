import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  allowedDriveUrl,
  fetchDriveImage,
  MAX_IMAGE_BYTES,
} from "../src/drive";
import worker from "../src/index";

const png = new Uint8Array([137, 80, 78, 71]);
const image = (headers: Record<string, string> = {}, body: BodyInit = png) =>
  new Response(body, {
    headers: { "Content-Type": "image/png", ...headers },
  });
const redirect = (location: string) =>
  new Response(null, { status: 302, headers: { Location: location } });

describe("Drive URLs", () => {
  it("rejects private, credentialed, untrusted, relative and non-HTTPS URLs", () => {
    for (const url of [
      "http://drive.google.com/uc?id=abc",
      "https://127.0.0.1/secret",
      "http://169.254.169.254/latest/meta-data",
      "file:///etc/passwd",
      "https://drive.google.com.evil.example/a.png",
      "https://user@drive.google.com/a.png",
      "https://drive.google.com:8080/a.png",
      "https://cards.scryfall.io/a.png",
    ])
      expect(() => allowedDriveUrl(url), url).toThrow();
    expect(() => allowedDriveUrl("/cardback.png")).toThrow();
  });

  it("allows Google's download hosts", () => {
    for (const url of [
      "https://drive.google.com/uc?id=abc",
      "https://drive.usercontent.google.com/download?id=abc",
      "https://lh3.googleusercontent.com/abc",
    ])
      expect(allowedDriveUrl(url).toString()).toBe(url);
  });
});

describe("fetchDriveImage", () => {
  it("follows redirects between Google hosts", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        redirect("https://drive.usercontent.google.com/download?id=abc")
      )
      .mockResolvedValueOnce(image({ "Content-Length": "4" }));
    const response = await fetchDriveImage("abcdefghijkl", fetcher);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://drive.google.com/uc?export=download&id=abcdefghijkl"
    );
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("manual");
  });

  it("refuses redirects away from Google", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(redirect("https://evil.example/a.png"));
    await expect(fetchDriveImage("abcdefghijkl", fetcher)).rejects.toThrow(
      /not an allowed source/
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("stops after too many redirects", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        redirect("https://drive.google.com/uc?id=again")
      );
    await expect(fetchDriveImage("abcdefghijkl", fetcher)).rejects.toThrow(
      /Too many/
    );
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it("rejects pages, errors, empty and oversized files", async () => {
    for (const response of [
      new Response("<html>", { headers: { "Content-Type": "text/html" } }),
      new Response(png, {
        status: 403,
        headers: { "Content-Type": "image/png" },
      }),
      image({ "Content-Length": "0" }, ""),
      image({ "Content-Length": String(MAX_IMAGE_BYTES + 1) }),
    ])
      await expect(
        fetchDriveImage("abcdefghijkl", async () => response)
      ).rejects.toThrow(/supported image/);
  });

  it("cuts off a file of unknown length once it passes 30 MB", async () => {
    const chunk = new Uint8Array(8 * 1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
        if (sent > MAX_IMAGE_BYTES * 2) controller.close();
      },
    });
    const response = await fetchDriveImage("abcdefghijkl", async () =>
      image({}, body)
    );
    await expect(response.arrayBuffer()).rejects.toThrow(/30 MB/);
  });
});

describe("worker", () => {
  const stored = new Map<string, Response>();
  const waited: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => waited.push(promise),
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  const call = (path: string, init?: RequestInit) =>
    worker.fetch(
      new Request(`https://www.oopsallproxies.com${path}`, init) as Request<
        unknown,
        IncomingRequestCfProperties
      >,
      {},
      ctx
    );

  beforeEach(() => {
    stored.clear();
    waited.length = 0;
    vi.stubGlobal("caches", {
      default: {
        match: async (request: Request) => stored.get(request.url)?.clone(),
        put: async (request: Request, response: Response) => {
          stored.set(
            request.url,
            new Response(await response.arrayBuffer(), response)
          );
        },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("serves a Drive image and keeps it in the edge cache", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => image({ "Content-Length": "4" }));
    vi.stubGlobal("fetch", fetcher);
    const first = await call("/api/cards/images/front?id=abcdefghijkl");
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(png);
    await Promise.all(waited);
    const entry = stored.get(
      "https://www.oopsallproxies.com/api/cards/images/front?id=abcdefghijkl"
    );
    expect(entry?.headers.get("cache-control")).toBe("public, max-age=604800");
    const second = await call("/api/cards/images/front?id=abcdefghijkl");
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(png);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid IDs, other routes and other methods", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await call("/api/cards/images/front?id=short")).status).toBe(400);
    expect((await call("/api/cards/images/front?id=../../etc")).status).toBe(
      400
    );
    expect((await call("/api/cards/images/proxy?url=x")).status).toBe(404);
    expect((await call("/api/cards/images", { method: "POST" })).status).toBe(
      404
    );
    expect(
      (
        await call("/api/cards/images/front?id=abcdefghijkl", {
          method: "DELETE",
        })
      ).status
    ).toBe(405);
    expect(await (await call("/api/health")).json()).toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a Drive failure without caching it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 403 }))
    );
    const response = await call("/api/cards/images/front?id=abcdefghijkl");
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toMatch(
      /shared publicly/
    );
    expect(stored.size).toBe(0);
  });
});
