import handler from "vinext/server/app-router-entry";

const DISCIPLINES = new Set(["rollhase", "trap", "langwaffe", "keller", "kurzwaffe"]);
const DUTIES = new Set(["aufsicht", "karten"]);
const STANDS = new Set(["falkenhorst", "eichenhoehe", "hubertus"]);
const JSON_HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };

type AuthUser = { id: string; name: string; email: string; avatar: string | null };
type BookingRow = {
  id: string; stand_id: string; date: string; duty: string; discipline: string;
  user_id: string; name: string; avatar: string | null;
};
type EventRow = { id: number; type: string; actor_name: string; stand_id: string; date: string; duty: string; discipline: string };
type BookingOwnerRow = { id: string; stand_id: string; date: string; duty: string; discipline: string; user_id: string };

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 220_000) throw new ApiError(413, "Die Anfrage ist zu groß.");
  if (!request.body) throw new ApiError(400, "Die Anfrage enthält keine Daten.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 220_000) {
      await reader.cancel();
      throw new ApiError(413, "Die Anfrage ist zu groß.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ApiError(400, "Ungültige JSON-Daten."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "Ungültige Eingabe.");
  return value as Record<string, unknown>;
}

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function cleanText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") throw new ApiError(400, `${field} fehlt.`);
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (cleaned.length < min || cleaned.length > max) throw new ApiError(400, `${field} muss zwischen ${min} und ${max} Zeichen lang sein.`);
  return cleaned;
}

function cleanEmail(value: unknown): string {
  const email = cleanText(value, "E-Mail-Adresse", 5, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "Bitte gib eine gültige E-Mail-Adresse ein.");
  return email;
}

function cleanAvatar(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 190_000 || !/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(value)) {
    throw new ApiError(400, "Das Profilbild ist ungültig oder zu groß.");
  }
  return value;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function createToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function requireUser(request: Request, env: Env): Promise<AuthUser> {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new ApiError(401, "Bitte registriere dich erneut.");
  const token = authorization.slice(7);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ApiError(401, "Die Sitzung ist ungültig.");
  const tokenHash = await sha256(token);
  const user = await env.DB.prepare(`
    SELECT u.id, u.name, u.email, u.avatar
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(tokenHash, new Date().toISOString()).first<AuthUser>();
  if (!user) throw new ApiError(401, "Deine Sitzung ist abgelaufen. Bitte registriere dich erneut.");
  return user;
}

function validateScheduleInput(standId: unknown, date: unknown, duty: unknown, discipline: unknown) {
  if (typeof standId !== "string" || !STANDS.has(standId)) throw new ApiError(400, "Unbekannter Schießstand.");
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, "Ungültiges Datum.");
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || ![0, 3, 6].includes(parsed.getUTCDay())) throw new ApiError(400, "Eintragungen sind nur Mittwoch, Samstag und Sonntag möglich.");
  if (typeof duty !== "string" || !DUTIES.has(duty)) throw new ApiError(400, "Unbekannter Dienst.");
  if (typeof discipline !== "string" || !DISCIPLINES.has(discipline)) throw new ApiError(400, "Unbekannte Disziplin.");
  return { standId, date, duty, discipline };
}

async function register(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request);
  const name = cleanText(body.name, "Name", 2, 60);
  const email = cleanEmail(body.email);
  const now = new Date().toISOString();
  let user = await env.DB.prepare("SELECT id, name, email, avatar FROM users WHERE email = ?").bind(email).first<AuthUser>();
  if (!user) {
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT OR IGNORE INTO users (id, name, email, avatar, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)")
      .bind(id, name, email, now, now).run();
    user = await env.DB.prepare("SELECT id, name, email, avatar FROM users WHERE email = ?").bind(email).first<AuthUser>();
    if (!user) throw new ApiError(500, "Das Profil konnte nicht angelegt werden.");
  }
  const token = createToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(tokenHash, user.id, now, expiresAt).run();
  return json({ user, token }, 201);
}

async function getSchedule(request: Request, env: Env, user: AuthUser): Promise<Response> {
  void user;
  const url = new URL(request.url);
  const standId = url.searchParams.get("stand");
  const month = url.searchParams.get("month");
  const sinceValue = Number(url.searchParams.get("since") || 0);
  if (!standId || !STANDS.has(standId)) throw new ApiError(400, "Unbekannter Schießstand.");
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, "Ungültiger Monat.");
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonth = monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
  const since = Number.isSafeInteger(sinceValue) && sinceValue >= 0 ? sinceValue : 0;

  const [bookingResult, eventResult, latest] = await Promise.all([
    env.DB.prepare(`
      SELECT b.id, b.stand_id, b.date, b.duty, b.discipline, b.user_id, u.name, u.avatar
      FROM bookings b JOIN users u ON u.id = b.user_id
      WHERE b.stand_id = ? AND b.date >= ? AND b.date < ?
      ORDER BY b.date, b.duty, b.discipline
    `).bind(standId, `${month}-01`, `${nextMonth}-01`).all<BookingRow>(),
    env.DB.prepare(`
      SELECT id, type, actor_name, stand_id, date, duty, discipline
      FROM events WHERE stand_id = ? AND id > ? ORDER BY id ASC LIMIT 50
    `).bind(standId, since).all<EventRow>(),
    env.DB.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM events WHERE stand_id = ?").bind(standId).first<{ id: number }>(),
  ]);

  const slots = bookingResult.results.map((row) => ({
    id: row.id, standId: row.stand_id, date: row.date, duty: row.duty, discipline: row.discipline,
    user: { id: row.user_id, name: row.name, avatar: row.avatar },
  }));
  const events = eventResult.results.map((event) => ({
    id: event.id, type: event.type, actorName: event.actor_name, standId: event.stand_id,
    date: event.date, duty: event.duty, discipline: event.discipline,
  }));
  return json({ slots, events, latestEventId: latest?.id || 0 });
}

async function createBooking(request: Request, env: Env, user: AuthUser): Promise<Response> {
  const body = await readBody(request);
  const input = validateScheduleInput(body.standId, body.date, body.duty, body.discipline);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    const result = await env.DB.prepare(`
      INSERT OR IGNORE INTO bookings (id, stand_id, date, duty, discipline, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, input.standId, input.date, input.duty, input.discipline, user.id, now).run();
    if (!result.meta.changes) throw new ApiError(409, "Dieses Feld wurde gerade von einer anderen Person belegt.");
    await env.DB.prepare(`
      INSERT INTO events (type, actor_user_id, actor_name, stand_id, date, duty, discipline, created_at)
      VALUES ('booking.created', ?, ?, ?, ?, ?, ?, ?)
    `).bind(user.id, user.name, input.standId, input.date, input.duty, input.discipline, now).run();
    return json({ id }, 201);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(409, "Dieses Feld ist nicht mehr frei. Der Plan wurde aktualisiert.");
  }
}

async function deleteBooking(request: Request, env: Env, user: AuthUser): Promise<Response> {
  const body = await readBody(request);
  const id = cleanText(body.id, "Eintrag", 8, 80);
  const booking = await env.DB.prepare("SELECT id, stand_id, date, duty, discipline, user_id FROM bookings WHERE id = ?")
    .bind(id).first<BookingOwnerRow>();
  if (!booking) throw new ApiError(404, "Der Eintrag wurde bereits entfernt.");
  if (booking.user_id !== user.id) throw new ApiError(403, "Nur die eingetragene Person kann dieses Feld freigeben.");
  const deletion = await env.DB.prepare("DELETE FROM bookings WHERE id = ? AND user_id = ?").bind(id, user.id).run();
  if (!deletion.meta.changes) throw new ApiError(409, "Der Eintrag wurde bereits geändert.");
  await env.DB.prepare(`
    INSERT INTO events (type, actor_user_id, actor_name, stand_id, date, duty, discipline, created_at)
    VALUES ('booking.deleted', ?, ?, ?, ?, ?, ?, ?)
  `).bind(user.id, user.name, booking.stand_id, booking.date, booking.duty, booking.discipline, new Date().toISOString()).run();
  return json({ ok: true });
}

async function updateProfile(request: Request, env: Env, user: AuthUser): Promise<Response> {
  const body = await readBody(request);
  const name = cleanText(body.name, "Name", 2, 60);
  const email = cleanEmail(body.email);
  const avatar = cleanAvatar(body.avatar);
  try {
    await env.DB.prepare("UPDATE users SET name = ?, email = ?, avatar = ?, updated_at = ? WHERE id = ?")
      .bind(name, email, avatar, new Date().toISOString(), user.id).run();
  } catch {
    throw new ApiError(409, "Diese E-Mail-Adresse wird bereits verwendet.");
  }
  return json({ user: { id: user.id, name, email, avatar } });
}

async function deleteProfile(env: Env, user: AuthUser): Promise<Response> {
  await env.DB.batch([
    env.DB.prepare("UPDATE events SET actor_name = 'Gelöschtes Profil', actor_user_id = NULL WHERE actor_user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
  return json({ ok: true });
}

async function apiRouter(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/register" && request.method === "POST") return register(request, env);
  const user = await requireUser(request, env);
  if (url.pathname === "/api/me" && request.method === "GET") return json({ user });
  if (url.pathname === "/api/me" && request.method === "PATCH") return updateProfile(request, env, user);
  if (url.pathname === "/api/me" && request.method === "DELETE") return deleteProfile(env, user);
  if (url.pathname === "/api/schedule" && request.method === "GET") return getSchedule(request, env, user);
  if (url.pathname === "/api/bookings" && request.method === "POST") return createBooking(request, env, user);
  if (url.pathname === "/api/bookings" && request.method === "DELETE") return deleteBooking(request, env, user);
  throw new ApiError(404, "API-Endpunkt nicht gefunden.");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await apiRouter(request, env);
      } catch (error) {
        if (error instanceof ApiError) return json({ error: error.message }, error.status);
        console.error(JSON.stringify({ message: "api_request_failed", path: url.pathname, error: error instanceof Error ? error.message : String(error) }));
        return json({ error: "Unerwarteter Serverfehler. Bitte versuche es erneut." }, 500);
      }
    }
    const response = await handler.fetch(request, env, ctx);
    return withSecurityHeaders(response);
  },
} satisfies ExportedHandler<Env>;
