import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html", host: "localhost" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {} },
  );
}

test("renders the finished Waidwerk app shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Waidwerk/);
  assert.match(html, /Waidwerk wird geladen/);
  assert.match(html, /manifest\.webmanifest/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships an installable PWA manifest and service worker", async () => {
  const [manifestText, workerText] = await Promise.all([
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));
  assert.match(workerText, /serviceWorker|addEventListener\("fetch"/);
});

test("keeps the required project disclaimer in the client source", async () => {
  const source = await readFile(new URL("../app/SchiessplanApp.tsx", import.meta.url), "utf8");
  assert.match(source, /Diese App ist ein mit KI erstelltes Hobbyprojekt/);
  assert.match(source, /Mittwoch/);
  assert.match(source, /Samstag/);
  assert.match(source, /Sonntag/);
});
