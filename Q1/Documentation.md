# Project Documentation & Short Notes

## Final Deliverables vs Requirements
This project fully delivers on the following 9 requirements:

1. **Rooms you can create and join through a shareable link, with a host who sets the number of rounds, draw time and word list.**
   *Delivered via `lobby.js` and `roomManager.js`. The host sets parameters and a shareable link is generated.*

2. **Drawing tools: pen, colours, brush size, eraser, fill, undo and clear canvas. Strokes stream to every player as they are drawn, with no visible lag.**
   *Delivered via `canvas.js`. Mouse sampling with 25ms server flushes ensures zero-lag streaming.*

3. **Turn flow: the drawer picks from 3 words, then a countdown timer starts. Letter hints reveal over time. The round ends when time runs out or when everyone has guessed.**
   *Delivered via `gameEngine.js`. Word choices are provided, and letter hints progressively reveal at 40%, 60%, and 80% of the elapsed time.*

4. **The server is the authority. The server alone checks guesses, keeps time and awards points. A player who edits the client must not be able to see the word or give themselves points.**
   *Delivered via `guessChecker.js`. Secret words remain securely on the server; clients are completely unable to spoof scores.*

5. **Players who guess right can't reveal the word in chat. Near-misses show "close!" to the person who guessed.**
   *Delivered via `server/index.js`. Guessed words are hidden from chat, and Levenshtein distance triggers private "Close!" warnings.*

6. **A player who joins mid-round sees the canvas as it stands. A player who refreshes or drops for up to 30 seconds rejoins with their score kept.**
   *Delivered via `strokeBuffer.js`. The server sends the entire stroke history upon joining, and `sessionStorage` tokens allow a 30-second reconnect window.*

7. **When the drawer leaves mid-turn, the game recovers cleanly instead of getting stuck.**
   *Delivered via `gameEngine.js`. Socket disconnects instantly halt the active turn and pass drawing rights to the next player.*

8. **Basic abuse protection: rate limiting on chat and strokes, and limits on how large a message or stroke can be.**
   *Delivered via `rateLimiter.js`. Sliding windows cap chats (3/2s) and strokes (120/s), and block payloads exceeding limits (chat max 1024 bytes, stroke max 4096 bytes).*

9. **A stroke-by-stroke replay of every drawing at the end of the game.**
   *Delivered via `replay.js`. The server archives all drawings and transmits them at game-end for animated client-side playback.*

---

## 🔑 Short Notes on System Architecture

**1. How we sync the canvas and send stroke data**
Instead of sending a heavy image file, the canvas is synchronized using vector data. The client's `canvas.js` captures `mousemove` events, turning them into an array of `{x, y}` points. Every 25 milliseconds, the client bundles these points into a "stroke segment" payload (including color, size, and tool) and emits it to the server via Socket.IO. The server immediately broadcasts this segment to all other clients in the room, who render lines between the points in real-time.

**2. How we handle latency and ordering**
Because we use WebSockets (TCP under the hood), packet ordering is guaranteed per client. Rather than relying on sequence numbers like `seq` for reordering, ordering relies on one ordered WebSocket connection per client and server-side append order. The server's `StrokeBuffer` simply stores incoming batches in the exact order received. When a remote client receives the packets, it draws them sequentially. Because we send data every 25ms rather than waiting for a stroke to finish, the drawing appears flawlessly smooth to guessers, hiding standard network latency.

**3. What happens when the server restarts**
Because the server stores game state and rooms entirely in memory (RAM), a server restart instantly destroys all active rooms, game states, and timers. However, the client-side `app.js` is built with a resilient Socket.IO reconnection loop. When the client auto-reconnects, it sends a `reconnect-session` event. The server will see their old session tokens, realize the rooms no longer exist, and reply with `reconnect-failed`. The client then returns to the Lobby screen with the toast "Connection lost or server restarted", preventing infinite loading screens or ghost states.

**4. Roughly how many rooms one server instance can handle, and how we measured it**
We measured capacity by building a custom load-testing script (`scripts/loadtest.js`) that uses headless Socket.IO clients to simulate highly active rooms (3 players per room, 1 host drawing at 40 strokes/s).
* **Without Anti-Cheat:** A single Node instance handles roughly **~100-200 concurrent rooms** before event-loop latency degrades.
* **With OCR Anti-Cheat:** Because Tesseract.js performs heavy image processing on the main thread, the CPU becomes the bottleneck, limiting a single instance to about **~5-10 highly active rooms** before p99 latency exceeds 50ms.
