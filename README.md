# Waidwerk Schießplan

Eine installierbare Web-App (PWA) für den gemeinsamen Schießstand-Aufsichtsplan. Die Oberfläche läuft als Cloudflare Worker, die synchronen Eintragungen, Profile und Sitzungen liegen in Cloudflare D1.

## Enthaltene Funktionen

- einmalige Registrierung mit Name und E-Mail-Adresse
- drei auswählbare Schießstände als Starter-Konfiguration
- Monatsplan ausschließlich für Mittwoch, Samstag und Sonntag
- zwei Dienstzeilen je Tag: **Aufsicht** und **Karten**
- Disziplinen Rollhase, Trap, 100 m Langwaffe, 60 m lfd. Keller und Kurzwaffe
- serverseitig atomare Belegung: ein Feld kann nie doppelt vergeben werden
- fremde Einträge sind gesperrt; eigene Einträge können nur vom Eigentümer entfernt werden
- gemeinsamer Stand mit automatischem Abgleich alle 12 Sekunden
- Profilbild, Name, E-Mail und Profil-Löschung
- Pop-ups für Eintragungen, Austragungen und freie Aufsichtstage
- PWA-Manifest, App-Icons, Service Worker und Offline-App-Hülle
- automatisches Deployment über GitHub Actions

## Lokal starten

Voraussetzungen: Node.js 22 oder neuer.

```bash
npm install
npx wrangler d1 migrations apply waidwerk-schiessplan-db --local
npm run dev
```

Die lokale Adresse wird anschließend im Terminal angezeigt (normalerweise `http://localhost:3000`). Die lokale D1-Datenbank liegt im ignorierten `.wrangler`-Ordner.

Prüfen:

```bash
npm test
npm run lint
```

## Cloudflare einmalig einrichten

1. Bei Cloudflare anmelden und Wrangler verbinden:

   ```bash
   npx wrangler login
   ```

2. Die D1-Datenbank anlegen:

   ```bash
   npx wrangler d1 create waidwerk-schiessplan-db
   ```

3. Die ausgegebene `database_id` in `wrangler.jsonc` anstelle der Null-ID eintragen.

4. Schema anwenden und veröffentlichen:

   ```bash
   npx wrangler d1 migrations apply waidwerk-schiessplan-db --remote
   npm run build
   npx wrangler deploy
   ```

Danach zeigt Wrangler die öffentliche `workers.dev`-Adresse an. Eine eigene Domain kann im Cloudflare-Dashboard unter **Workers & Pages → Waidwerk Schießplan → Settings → Domains & Routes** verbunden werden.

## GitHub-Deployment aktivieren

1. Diesen kompletten Ordner in ein neues GitHub-Repository hochladen.
2. In Cloudflare ein API-Token mit Rechten für **Workers Scripts** und **D1** erstellen.
3. In GitHub unter **Settings → Secrets and variables → Actions** zwei Repository-Secrets anlegen:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. Die echte D1-`database_id` muss bereits in `wrangler.jsonc` stehen.
5. Jeder Push auf `main` baut die App, führt offene Migrationen aus und veröffentlicht die neue Version.

## Schießstände und Zeiten anpassen

Die sichtbaren Stände stehen in `app/SchiessplanApp.tsx` in `STANDS`. Die erlaubten Stand-IDs stehen zusätzlich in `worker/index.ts` in `STANDS`; IDs müssen an beiden Stellen gleich sein.

Die Standardzeiten stehen in der Funktion `operationTime`:

- Mittwoch: 17:00–20:00 Uhr
- Samstag: 14:00–18:00 Uhr
- Sonntag: 09:00–12:00 Uhr

## Installation auf dem Handy

- Android/Chrome: in der App **Als App installieren** oder im Browser-Menü **App installieren** wählen.
- iPhone/iPad/Safari: **Teilen → Zum Home-Bildschirm** wählen.

Pop-ups funktionieren in dieser ersten Version, solange die App geöffnet ist. Echte Push-Nachrichten bei komplett geschlossener App benötigen zusätzlich Web-Push-Schlüssel und eine Push-Abonnement-Tabelle.

## Datenschutz und Sicherheit

Die App speichert Namen, E-Mail-Adressen, optionale Profilbilder, Sitzungen und Planeinträge in D1. Vor einem echten Vereinsbetrieb sollten eine Datenschutzerklärung, ein verantwortlicher Betreiber und Löschfristen festgelegt werden.

Die erste Version verwendet bewusst eine einfache Registrierung ohne E-Mail-Bestätigung. Für einen öffentlichen oder größeren Nutzerkreis sollte als nächster Schritt ein Magic-Link-Login oder ein Vereins-Login ergänzt werden. Sitzungstoken werden nur gehasht in D1 gespeichert; Belegungs- und Eigentumsprüfungen erfolgen immer serverseitig.

## Projektstruktur

```text
app/                    Oberfläche und Gestaltung
worker/index.ts         API, Sitzungen und Belegungslogik
db/schema.ts            D1-/SQLite-Schema
drizzle/                versionierte Datenbankmigrationen
public/                 PWA-Manifest, Icons, Social Card, Service Worker
.github/workflows/      automatisches Cloudflare-Deployment
wrangler.jsonc          Cloudflare-Konfiguration
```
