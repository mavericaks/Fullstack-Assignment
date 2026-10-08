# 🚀 Fullstack Assignment - Review Cheat Sheet

This document is designed to be your quick-reference guide during the review. Keep this open! It covers the "Why" and "How" of all the major technical decisions in the codebase.

---

## 🏗️ Q1: Multiplayer Drawing Game (Drawly)

### 1. High-Level Architecture
- **Tech Stack:** Node.js (v22+), Express, Socket.IO, HTML5 Canvas.
- **Server-Authoritative:** The server dictates *everything*. Clients cannot change the timer, dictate their score, or declare they guessed correctly. The server holds the true state.
- **WebSocket over HTTP:** We use WebSockets because we need bidirectional, low-latency communication. HTTP polling would be too slow for real-time drawing sync (which happens every 25ms).

### 2. Live Drawing Sync (`public/js/canvas.js` & `server/index.js`)
- **How it works:** As the drawer moves their mouse, the client collects points `[{x, y}, ...]`. Every 25ms, it flushes this "stroke batch" to the server.
- **Server Validation:** The server intercepts it (`draw-stroke` event in `index.js`), validates that the coordinates are within bounds, the array isn't too large (prevents DoS), and the colors are valid hex.
- **Broadcasting:** It instantly broadcasts this to all guessers in the room so they see the drawing in real-time.

### 3. Stroke Buffer & Late Joiners (`server/strokeBuffer.js`)
- **The Problem:** If someone joins in the middle of a 60-second round, the canvas would be blank for them because they missed the earlier WebSocket events.
- **The Solution:** The server maintains a `StrokeBuffer`. Every valid stroke is appended to this buffer. When a new player joins (`room-joined`), the server sends them the `stroke-history`, and their client instantly re-renders everything drawn so far.
- **Undo/Clear:** If the drawer hits "Undo", the server removes the last stroke ID from the buffer and tells clients to re-render. If they hit "Clear", the buffer is wiped.

### 4. Anti-Cheat System (OCR) (`server/antiCheat/index.js`)
- **The Problem:** Drawers cheating by just writing the word (e.g., writing "APPLE" instead of drawing it).
- **The Solution:** A 3-step pipeline:
  1. **Heuristics:** We check if strokes look like text (lots of small, fast, isolated strokes).
  2. **Rasterization:** We convert the vector points into a binary image (PBM format) in pure JavaScript.
  3. **OCR (Tesseract):** We feed the image to Tesseract.js (running in a Web Worker to avoid blocking the main thread). If the detected text closely matches the secret word (using Levenshtein distance), we issue a strike. Strike 1/2 clear the canvas. Strike 3 kicks them from drawing.

### 5. Crash Safety & Rate Limiting (`server/rateLimiter.js` & `index.js`)
- **Crash Safety:** In Node.js, an uncaught exception crashes the entire server, ruining the game for *all* rooms. We wrap every socket handler in `safeHandler` which uses a `try/catch` and validates the incoming payload shape so malicious clients can't crash the server by sending `null` or weird objects.
- **Rate Limiting:** We use a Sliding Window rate limiter. If a player spams chat messages or forged stroke events, the server drops them and sends a warning. 

### 6. Disconnections & Grace Period (`server/roomManager.js`)
- **The Problem:** Sockets disconnect briefly if a player changes WiFi or refreshes the page on accident. We shouldn't kick them immediately.
- **The Solution:** When a socket disconnects, we start a 30-second `reconnectTimer`. The player is marked `connected: false`. If they reconnect and send their `sessionToken` (which is stored in their browser's `sessionStorage`), the server cancels the timer, updates their socket ID, and resumes their game state perfectly.

### 7. Guessing Logic (`server/guessChecker.js` & `server/gameEngine.js`)
- **Near-Misses:** We calculate the Levenshtein distance (edit distance) between the guess and the secret word. If it's off by 1 or 2 characters, we privately tell the guesser they are "close!" without showing it to everyone else.
- **Filtering:** If a user types a word that *contains* the answer (e.g., typing "football" when the answer is "foot"), we filter the message so it doesn't accidentally reveal the answer to the lobby.

---

## 🎧 Q2: Listen Together Rooms (System Design)

### 1. The Core Challenge
Synchronizing audio playback for up to 100,000 listeners in a room with <200ms variance, while handling massive audio bandwidth (up to 320 Gbps).

### 2. Audio Delivery (The Heavy Lifting)
- We do **NOT** stream audio through WebSockets. That would crash our servers instantly.
- Audio is chunked into 2-second segments (CMAF format) and served via a **CDN (Content Delivery Network)**. The client fetches these chunks over standard HTTP/2, keeping audio traffic entirely off our realtime servers.

### 3. Sync Mechanism (WebSockets)
- We use WebSockets purely for small, lightweight control signals (Play, Pause, Seek).
- **Time-Anchored Commands:** Instead of saying "Play now", the host says "Play at Server Time 14:00:05.000". Every client's clock is synced with the server using NTP (Network Time Protocol) offsets. When their local clock hits that exact time, they all press play simultaneously.

### 4. WebSocket Scaling (Redis Pub/Sub)
- A single Node/Go server can only hold about 50,000 WebSockets. If a room has 100,000 people, they will be connected to *different* servers.
- **Redis Pub/Sub:** When the host sends a "Pause" command to Server A, Server A publishes it to Redis. Servers B and C are subscribed to Redis, hear the command, and fan it out to the listeners connected to them.

### 5. Datastores
- **Postgres:** For persistent data (User profiles, playlists).
- **Redis:** For ephemeral data (Who is in what room, active listener counts).
- **Kafka:** For processing analytics and generating the "Trending Rooms" feed asynchronously.
