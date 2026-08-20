"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type View = "start" | "plan" | "notifications" | "profile";
type Duty = "aufsicht" | "karten";
type Discipline = "rollhase" | "trap" | "langwaffe" | "keller" | "kurzwaffe";

type User = { id: string; name: string; email: string; avatar: string | null };
type Slot = {
  id: string;
  standId: string;
  date: string;
  duty: Duty;
  discipline: Discipline;
  user: Pick<User, "id" | "name" | "avatar">;
};
type Activity = {
  id: number;
  type: "booking.created" | "booking.deleted";
  actorName: string;
  date: string;
  discipline: Discipline;
  standId: string;
};
type NotificationSettings = { entry: boolean; exit: boolean; free: boolean };
type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const DISCLAIMER = "Diese App ist ein mit KI erstelltes Hobbyprojekt, das durch GitHub und Cloudflare möglich ist. Alle Angaben sind ohne Gewähr, können sich jederzeit ändern und fehlerhaft sein.";
const STORAGE_TOKEN = "waidwerk.session";
const STORAGE_NOTIFICATIONS = "waidwerk.notifications";
const DEFAULT_NOTIFICATIONS: NotificationSettings = { entry: true, exit: true, free: false };

const STANDS = [
  { id: "falkenhorst", name: "Hauptstand Falkenhorst", short: "Falkenhorst", detail: "Alle Disziplinen", code: "01" },
  { id: "eichenhoehe", name: "Waldschießstand Eichenhöhe", short: "Eichenhöhe", detail: "Flinte & Laufender Keiler", code: "02" },
  { id: "hubertus", name: "Kurzwaffenstand Hubertus", short: "Hubertus", detail: "Kurz- & Langwaffe", code: "03" },
] as const;

const DISCIPLINES: { id: Discipline; label: string; compact: string }[] = [
  { id: "rollhase", label: "Rollhase", compact: "Rollhase" },
  { id: "trap", label: "Trap", compact: "Trap" },
  { id: "langwaffe", label: "100m Langwaffe", compact: "100m LW" },
  { id: "keller", label: "60m lfd. Keller", compact: "60m Keller" },
  { id: "kurzwaffe", label: "Kurzwaffe", compact: "KW" },
];

const DAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function pad(value: number) { return String(value).padStart(2, "0"); }
function monthKey(date: Date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`; }
function isoDate(date: Date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function scheduleDates(month: Date) {
  const result: Date[] = [];
  const cursor = new Date(month.getFullYear(), month.getMonth(), 1);
  while (cursor.getMonth() === month.getMonth()) {
    if ([0, 3, 6].includes(cursor.getDay())) result.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}
function operationTime(day: number) {
  if (day === 3) return { from: "17:00", to: "20:00" };
  if (day === 6) return { from: "14:00", to: "18:00" };
  return { from: "09:00", to: "12:00" };
}

function storedNotificationSettings(): NotificationSettings {
  if (typeof window === "undefined") return DEFAULT_NOTIFICATIONS;
  const saved = window.localStorage.getItem(STORAGE_NOTIFICATIONS);
  if (!saved) return DEFAULT_NOTIFICATIONS;
  try {
    const parsed: unknown = JSON.parse(saved);
    if (parsed && typeof parsed === "object" && "entry" in parsed && "exit" in parsed && "free" in parsed) {
      return { entry: Boolean(parsed.entry), exit: Boolean(parsed.exit), free: Boolean(parsed.free) };
    }
  } catch { /* use defaults */ }
  return DEFAULT_NOTIFICATIONS;
}

async function api<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data: unknown = await response.json().catch(() => ({ error: "Die Antwort des Servers war ungültig." }));
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error
      : "Die Anfrage konnte nicht ausgeführt werden.";
    throw new Error(message);
  }
  return data as T;
}

function TargetMark({ small = false }: { small?: boolean }) {
  return <span className={`target-mark${small ? " target-mark--small" : ""}`} aria-hidden="true"><i /></span>;
}

function Avatar({ user, size = "normal" }: { user: Pick<User, "name" | "avatar">; size?: "small" | "normal" | "large" }) {
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return user.avatar
    // User-uploaded data URLs are already resized client-side and cannot use the remote image optimizer.
    ? <img className={`avatar avatar--${size}`} src={user.avatar} alt={`Profilbild von ${user.name}`} /> // eslint-disable-line @next/next/no-img-element
    : <span className={`avatar avatar--${size} avatar--initials`} aria-hidden="true">{initials || "?"}</span>;
}

function FooterNote() {
  return <p className="disclaimer">{DISCLAIMER}</p>;
}

function Toast({ message }: { message: string | null }) {
  return <div className={`toast${message ? " toast--visible" : ""}`} role="status" aria-live="polite">{message}</div>;
}

export function SchiessplanApp() {
  const [view, setView] = useState<View>("start");
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [selectedStand, setSelectedStand] = useState<(typeof STANDS)[number] | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [pendingSlot, setPendingSlot] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [settings, setSettings] = useState<NotificationSettings>(storedNotificationSettings);
  const lastEventId = useRef(0);
  const initialScheduleLoad = useRef(true);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const popup = useCallback((title: string, body: string) => {
    showToast(`${title}: ${body}`);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body, icon: "/icon-192.png", tag: `${title}-${body}` });
    }
  }, [showToast]);

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      await Promise.resolve();
      const savedToken = window.localStorage.getItem(STORAGE_TOKEN);
      if (!savedToken) { if (active) setAuthChecked(true); return; }
      if (active) setToken(savedToken);
      try {
        const result = await api<{ user: User }>("/api/me", {}, savedToken);
        if (active) setUser(result.user);
      } catch {
        window.localStorage.removeItem(STORAGE_TOKEN);
        if (active) setToken(null);
      } finally { if (active) setAuthChecked(true); }
    }
    void restoreSession();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);

  const loadSchedule = useCallback(async (quiet = false) => {
    if (!selectedStand || !token) return;
    if (!quiet) setLoadingPlan(true);
    try {
      const result = await api<{ slots: Slot[]; events: Activity[]; latestEventId: number }>(
        `/api/schedule?stand=${selectedStand.id}&month=${monthKey(currentMonth)}&since=${lastEventId.current}`,
        {}, token,
      );
      setSlots(result.slots);
      if (!initialScheduleLoad.current) {
        for (const event of result.events) {
          if (event.type === "booking.created" && settings.entry) popup("Neue Eintragung", `${event.actorName} hat sich für ${DISCIPLINES.find((d) => d.id === event.discipline)?.label} eingetragen.`);
          if (event.type === "booking.deleted" && settings.exit) popup("Austragung", `${event.actorName} hat einen Dienst am ${event.date.split("-").reverse().join(".")} freigegeben.`);
        }
      }
      lastEventId.current = Math.max(lastEventId.current, result.latestEventId);
      initialScheduleLoad.current = false;
    } catch (error) {
      if (!quiet) showToast(error instanceof Error ? error.message : "Plan konnte nicht geladen werden.");
    } finally {
      if (!quiet) setLoadingPlan(false);
    }
  }, [currentMonth, popup, selectedStand, settings.entry, settings.exit, showToast, token]);

  useEffect(() => {
    initialScheduleLoad.current = true;
    lastEventId.current = 0;
    const timeout = window.setTimeout(() => void loadSchedule(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadSchedule]);

  useEffect(() => {
    if (!selectedStand || !token || view !== "plan") return;
    const interval = window.setInterval(() => void loadSchedule(true), 12000);
    return () => window.clearInterval(interval);
  }, [loadSchedule, selectedStand, token, view]);

  useEffect(() => {
    if (!settings.free || !selectedStand || view !== "plan" || loadingPlan) return;
    const upcoming = scheduleDates(currentMonth).find((date) => {
      if (date < new Date(new Date().setHours(0, 0, 0, 0))) return false;
      const dateKey = isoDate(date);
      return DISCIPLINES.some((discipline) => !slots.some((slot) => slot.date === dateKey && slot.discipline === discipline.id));
    });
    if (!upcoming) return;
    const noticeKey = `waidwerk.free.${selectedStand.id}.${isoDate(upcoming)}`;
    if (window.sessionStorage.getItem(noticeKey)) return;
    window.sessionStorage.setItem(noticeKey, "1");
    const timeout = window.setTimeout(() => popup("Freier Aufsichtstag", `Am ${upcoming.toLocaleDateString("de-DE")} sind noch Dienste frei.`), 0);
    return () => window.clearTimeout(timeout);
  }, [currentMonth, loadingPlan, popup, selectedStand, settings.free, slots, view]);

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ user: User; token: string }>("/api/register", {
        method: "POST",
        body: JSON.stringify({ name: form.get("name"), email: form.get("email") }),
      });
      window.localStorage.setItem(STORAGE_TOKEN, result.token);
      setToken(result.token);
      setUser(result.user);
      showToast(`Willkommen, ${result.user.name}.`);
    } catch (error) { showToast(error instanceof Error ? error.message : "Registrierung fehlgeschlagen."); }
  }

  function chooseStand(stand: (typeof STANDS)[number]) {
    setSelectedStand(stand);
    setView("plan");
  }

  async function toggleSlot(date: string, duty: Duty, discipline: Discipline, occupied?: Slot) {
    if (!token || !user || !selectedStand) return;
    const key = `${date}-${duty}-${discipline}`;
    if (occupied && occupied.user.id !== user.id) return;
    if (occupied && !window.confirm(`Möchtest du deinen Dienst am ${date.split("-").reverse().join(".")} wirklich austragen?`)) return;
    setPendingSlot(key);
    try {
      if (occupied) {
        await api("/api/bookings", { method: "DELETE", body: JSON.stringify({ id: occupied.id }) }, token);
        showToast("Du wurdest ausgetragen. Der Dienst ist wieder frei.");
      } else {
        await api("/api/bookings", { method: "POST", body: JSON.stringify({ standId: selectedStand.id, date, duty, discipline }) }, token);
        showToast("Dein Dienst wurde verbindlich eingetragen.");
      }
      await loadSchedule(true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Eintragung fehlgeschlagen.");
      await loadSchedule(true);
    } finally { setPendingSlot(null); }
  }

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
    } else {
      showToast("Öffne das Browser-Menü und wähle „Zum Startbildschirm hinzufügen“.");
    }
  }

  async function updateNotification(key: keyof NotificationSettings) {
    const next = { ...settings, [key]: !settings[key] };
    if (next[key] && "Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    setSettings(next);
    window.localStorage.setItem(STORAGE_NOTIFICATIONS, JSON.stringify(next));
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ user: User }>("/api/me", { method: "PATCH", body: JSON.stringify({ name: form.get("name"), email: form.get("email"), avatar: user?.avatar }) }, token);
      setUser(result.user);
      showToast("Dein Profil wurde gespeichert.");
    } catch (error) { showToast(error instanceof Error ? error.message : "Profil konnte nicht gespeichert werden."); }
  }

  async function avatarChanged(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) { showToast("Bitte wähle eine Bilddatei aus."); return; }
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 256; canvas.height = 256;
      const context = canvas.getContext("2d");
      if (!context) return;
      const scale = Math.max(256 / image.width, 256 / image.height);
      const width = image.width * scale; const height = image.height * scale;
      context.drawImage(image, (256 - width) / 2, (256 - height) / 2, width, height);
      setUser({ ...user, avatar: canvas.toDataURL("image/jpeg", 0.78) });
      URL.revokeObjectURL(image.src);
    };
    image.src = URL.createObjectURL(file);
  }

  async function deleteProfile() {
    if (!token || !window.confirm("Profil und alle zukünftigen Eintragungen unwiderruflich löschen?")) return;
    try {
      await api("/api/me", { method: "DELETE" }, token);
      window.localStorage.removeItem(STORAGE_TOKEN);
      setUser(null); setToken(null); setView("start"); setSelectedStand(null);
      showToast("Dein Profil wurde gelöscht.");
    } catch (error) { showToast(error instanceof Error ? error.message : "Profil konnte nicht gelöscht werden."); }
  }

  const selectedStandName = selectedStand?.name || "Schießstand";

  if (!authChecked) return <div className="app-loading"><TargetMark /><span>Waidwerk wird geladen …</span></div>;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("start")} aria-label="Zur Startseite">
          <TargetMark />
          <span><b>WAIDWERK</b><small>SCHIESSPLAN</small></span>
        </button>
        {user && <div className="topbar-user"><span><small>ANGEMELDET ALS</small><b>{user.name}</b></span><Avatar user={user} size="small" /></div>}
      </header>

      <main>
        {view === "start" && <StartPage user={user} onChoose={chooseStand} onInstall={installApp} />}
        {view === "plan" && selectedStand && (
          <PlanPage
            currentMonth={currentMonth}
            loading={loadingPlan}
            onBack={() => setView("start")}
            onMonth={(delta) => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1))}
            onToday={() => setCurrentMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
            onToggle={toggleSlot}
            pendingSlot={pendingSlot}
            slots={slots}
            standName={selectedStandName}
            user={user}
          />
        )}
        {view === "notifications" && <NotificationsPage settings={settings} onToggle={updateNotification} />}
        {view === "profile" && user && <ProfilePage user={user} onAvatar={avatarChanged} onDelete={deleteProfile} onSave={saveProfile} setUser={setUser} />}
        <FooterNote />
      </main>

      {user && <nav className="bottom-nav" aria-label="Hauptnavigation">
        <NavButton active={view === "start" || view === "plan"} icon="⌂" label="Start" onClick={() => setView("start")} />
        <NavButton active={view === "notifications"} icon="●" label="Meldungen" onClick={() => setView("notifications")} />
        <NavButton active={view === "profile"} icon="◉" label="Profil" onClick={() => setView("profile")} />
      </nav>}

      {!user && <Registration onSubmit={register} />}
      <Toast message={toast} />
    </div>
  );
}

function StartPage({ user, onChoose, onInstall }: { user: User | null; onChoose(stand: (typeof STANDS)[number]): void; onInstall(): void }) {
  return <>
    <section className="hero">
      <div className="hero-copy">
        <span className="eyebrow"><i /> GEMEINSAM · VERLÄSSLICH · AKTUELL</span>
        <h1>Gut geplant.<br /><em>Sicher beaufsichtigt.</em></h1>
        <p>Der gemeinsame Aufsichtsplan für euren Schießstand. Eintragen, abstimmen und den Überblick behalten.</p>
        <div className="hero-actions">
          <a className="button button--gold" href="#staende">Stand auswählen <span>→</span></a>
          <button className="button button--ghost" onClick={onInstall}>＋ Als App installieren</button>
        </div>
      </div>
      <div className="hero-target" aria-hidden="true"><div><span>WAID</span><b>01</b><small>AUFSICHT</small></div></div>
    </section>

    <section className="stand-section" id="staende">
      <div className="section-heading"><div><span className="eyebrow"><i /> DEINE SCHIESSSTÄNDE</span><h2>Wo möchtest du Aufsicht führen?</h2></div><span className="stand-count">{STANDS.length} STÄNDE</span></div>
      <div className="stand-grid">
        {STANDS.map((stand) => <button className="stand-card" key={stand.id} onClick={() => user && onChoose(stand)} disabled={!user}>
          <span className="stand-number">{stand.code}</span><TargetMark small />
          <span className="stand-card-copy"><small>SCHIESSSTAND</small><b>{stand.name}</b><span>{stand.detail}</span></span>
          <span className="stand-arrow">→</span>
        </button>)}
      </div>
      {!user && <p className="hint">Registriere dich einmalig, um einen Stand auszuwählen und dich einzutragen.</p>}
    </section>
  </>;
}

function PlanPage(props: {
  currentMonth: Date; loading: boolean; onBack(): void; onMonth(delta: number): void; onToday(): void;
  onToggle(date: string, duty: Duty, discipline: Discipline, slot?: Slot): void; pendingSlot: string | null;
  slots: Slot[]; standName: string; user: User | null;
}) {
  const dates = useMemo(() => scheduleDates(props.currentMonth), [props.currentMonth]);
  return <section className="plan-page">
    <button className="back-link" onClick={props.onBack}>← Alle Schießstände</button>
    <div className="plan-heading">
      <div><span className="eyebrow"><i /> AUFSICHTSPLAN</span><h1>{props.standName}</h1><p>Freie Felder auswählen, eigenen Eintrag anklicken zum Austragen.</p></div>
      <div className="legend"><span><i className="legend-free" /> FREI</span><span><i className="legend-mine" /> DEIN DIENST</span><span><i className="legend-taken" /> BELEGT</span></div>
    </div>
    <div className="month-bar">
      <button onClick={() => props.onMonth(-1)} aria-label="Vorheriger Monat">‹</button>
      <div><small>MONATSPLAN</small><b>{MONTH_NAMES[props.currentMonth.getMonth()]} {props.currentMonth.getFullYear()}</b></div>
      <button onClick={() => props.onMonth(1)} aria-label="Nächster Monat">›</button>
      <button className="today-button" onClick={props.onToday}>Heute</button>
    </div>
    <div className={`schedule-wrap${props.loading ? " schedule-wrap--loading" : ""}`} aria-busy={props.loading}>
      <table className="schedule-table">
        <thead><tr><th>Datum</th><th>Tag</th><th>Schießbetrieb</th><th aria-label="Dienst">\</th>{DISCIPLINES.map((d) => <th key={d.id}><span className="full-label">{d.label}</span><span className="short-label">{d.compact}</span></th>)}</tr></thead>
        <tbody>{dates.map((date) => {
          const dateKey = isoDate(date); const time = operationTime(date.getDay());
          return (["aufsicht", "karten"] as Duty[]).map((duty, rowIndex) => <tr key={`${dateKey}-${duty}`} className={rowIndex === 0 ? "day-start" : "day-end"}>
            {rowIndex === 0 && <><td rowSpan={2} className="date-cell"><b>{pad(date.getDate())}</b><span>.{pad(date.getMonth() + 1)}.</span></td><td rowSpan={2} className="day-cell"><b>{DAY_NAMES[date.getDay()]}</b><span>{date.getDay() === 0 ? "SO" : date.getDay() === 3 ? "MI" : "SA"}</span></td></>}
            <td className="time-cell"><small>{duty === "aufsicht" ? "VON" : "BIS"}</small><b>{duty === "aufsicht" ? time.from : time.to}</b><span>Uhr</span></td>
            <td className="duty-cell">{duty === "aufsicht" ? "Aufsicht" : "Karten"}</td>
            {DISCIPLINES.map((discipline) => {
              const slot = props.slots.find((item) => item.date === dateKey && item.duty === duty && item.discipline === discipline.id);
              const mine = slot?.user.id === props.user?.id; const pending = props.pendingSlot === `${dateKey}-${duty}-${discipline.id}`;
              return <td key={discipline.id} className="slot-cell"><button
                className={`slot ${slot ? (mine ? "slot--mine" : "slot--taken") : "slot--free"}`}
                disabled={Boolean((slot && !mine) || pending)}
                onClick={() => props.onToggle(dateKey, duty, discipline.id, slot)}
                aria-label={slot ? `${slot.user.name}, ${mine ? "eigener Eintrag, zum Austragen anklicken" : "belegt"}` : `Frei: ${discipline.label}, ${duty}`}
              >{pending ? <span className="slot-spinner" /> : slot ? <><Avatar user={slot.user} size="small" /><span><b>{slot.user.name}</b><small>{mine ? "DEIN DIENST" : "BELEGT"}</small></span></> : <><span className="slot-plus">＋</span><span><b>Eintragen</b><small>FREI</small></span></>}</button></td>;
            })}
          </tr>);
        })}</tbody>
      </table>
      {props.loading && <div className="table-loader">Plan wird abgeglichen …</div>}
    </div>
    <p className="sync-note"><span>↻</span> Der Plan wird automatisch alle 12 Sekunden mit allen Geräten abgeglichen.</p>
  </section>;
}

function NotificationsPage({ settings, onToggle }: { settings: NotificationSettings; onToggle(key: keyof NotificationSettings): void }) {
  const items: { key: keyof NotificationSettings; title: string; text: string; icon: string }[] = [
    { key: "entry", title: "Neue Eintragungen", text: "Pop-up, sobald jemand einen freien Dienst übernimmt.", icon: "＋" },
    { key: "exit", title: "Austragungen", text: "Pop-up, wenn ein belegter Dienst wieder freigegeben wird.", icon: "↩" },
    { key: "free", title: "Freie Aufsichtstage", text: "Hinweis auf den nächsten Tag mit unbesetzten Diensten.", icon: "○" },
  ];
  return <section className="simple-page"><span className="eyebrow"><i /> BENACHRICHTIGUNGEN</span><h1>Nichts Wichtiges verpassen.</h1><p className="lead">Lege fest, welche Änderungen als Pop-up erscheinen sollen, während Waidwerk geöffnet ist.</p>
    <div className="settings-card">{items.map((item) => <div className="setting-row" key={item.key}><span className="setting-icon">{item.icon}</span><div><b>{item.title}</b><p>{item.text}</p></div><button role="switch" aria-checked={settings[item.key]} className={`switch${settings[item.key] ? " switch--on" : ""}`} onClick={() => onToggle(item.key)}><span /></button></div>)}</div>
    <div className="info-card"><TargetMark small /><p><b>Hinweis zu Pop-ups</b><br />Dein Browser fragt beim ersten Aktivieren nach Erlaubnis. Auf iPhone und iPad funktionieren Systemmeldungen am zuverlässigsten, wenn die App zum Home-Bildschirm hinzugefügt wurde.</p></div>
  </section>;
}

function ProfilePage({ user, onAvatar, onDelete, onSave, setUser }: { user: User; onAvatar(event: ChangeEvent<HTMLInputElement>): void; onDelete(): void; onSave(event: FormEvent<HTMLFormElement>): void; setUser(user: User): void }) {
  return <section className="simple-page"><span className="eyebrow"><i /> DEIN PROFIL</span><h1>Persönliche Angaben.</h1><p className="lead">Dein Name und Profilbild sind für andere Aufsichten im Plan sichtbar.</p>
    <form className="profile-card" onSubmit={onSave}>
      <div className="avatar-editor"><Avatar user={user} size="large" /><div><b>Profilbild</b><span>JPG, PNG oder WebP</span><label className="button button--small">Bild auswählen<input type="file" accept="image/png,image/jpeg,image/webp" onChange={onAvatar} /></label>{user.avatar && <button type="button" className="text-button" onClick={() => setUser({ ...user, avatar: null })}>Bild entfernen</button>}</div></div>
      <div className="form-grid"><label><span>Name</span><input name="name" value={user.name} minLength={2} maxLength={60} onChange={(e) => setUser({ ...user, name: e.target.value })} required /></label><label><span>E-Mail-Adresse</span><input name="email" type="email" value={user.email} maxLength={120} onChange={(e) => setUser({ ...user, email: e.target.value })} required /></label></div>
      <button className="button button--gold" type="submit">Änderungen speichern <span>→</span></button>
    </form>
    <div className="danger-card"><div><b>Profil löschen</b><p>Entfernt dein Profil, deine Sitzung und alle zukünftigen Eintragungen.</p></div><button onClick={onDelete}>Profil löschen</button></div>
  </section>;
}

function Registration({ onSubmit }: { onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  return <div className="registration-backdrop"><section className="registration-card" role="dialog" aria-modal="true" aria-labelledby="register-title">
    <div className="registration-brand"><TargetMark /><span>WAIDWERK<small>SCHIESSPLAN</small></span></div>
    <span className="eyebrow"><i /> WILLKOMMEN</span><h1 id="register-title">Einmal registrieren.<br /><em>Gemeinsam planen.</em></h1><p>Damit deine Dienste eindeutig zugeordnet werden, benötigen wir deinen Namen und deine E-Mail-Adresse.</p>
    <form onSubmit={onSubmit}><label><span>Dein vollständiger Name</span><input name="name" autoComplete="name" minLength={2} maxLength={60} placeholder="z. B. Johanna Weidmann" required /></label><label><span>E-Mail-Adresse</span><input name="email" type="email" autoComplete="email" maxLength={120} placeholder="name@beispiel.de" required /></label><label className="consent"><input type="checkbox" required /><span>Ich habe den Projekthinweis gelesen und stimme der Verarbeitung meiner Angaben für den Aufsichtsplan zu.</span></label><button className="button button--gold button--wide" type="submit">Registrierung abschließen <span>→</span></button></form>
    <p className="registration-note">🔒 Deine Angaben werden in der Cloudflare-Datenbank des Betreibers gespeichert.</p>
  </section></div>;
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick(): void }) {
  return <button className={active ? "active" : ""} onClick={onClick}><span>{icon}</span><b>{label}</b></button>;
}
