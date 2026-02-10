# ChatPe

Discord-style anonymous department chat with in-memory student verification. Student data is embedded directly in code (no external DB).

## Structure
- `client/` React + Tailwind (Discord-like UI)
- `server/` Node + Express + WebSocket (real-time chat)

## Student Data
Embedded at `server/src/data/students.js` (auto-generated from `MSC ROLL NUMBER.pdf`).
- `registrationNo` = roll number
- `name`
- `department` (currently hardcoded to `MSc`)

## Authentication
Login uses a 5-second time-based numeric code generated at login time (no PIN).

## Persistence (No External DB)
Messages and room name are persisted to a local JSON file:
- `server/src/data/store.json`

Messages do not auto-expire.

## Admin Authentication
Admin access is granted to the roll number `250252780057`.

## Local Run
### Server
1. `cd server`
2. `npm install`
3. `npm run dev`

Server runs at `http://localhost:3001`.

### Client
1. `cd client`
2. `npm install`
3. `npm run dev`

Client runs at `http://localhost:5173`.

## GitHub Pages Note
GitHub Pages can host only the **frontend**. The backend (WebSocket + API) must run elsewhere (or locally) and `VITE_API_URL` must point to that server.

For GitHub Pages deployment:
1. In `client`, set `VITE_API_URL` in a `.env` file (example: `VITE_API_URL=https://your-backend-host`)
2. Run `npm run deploy`
