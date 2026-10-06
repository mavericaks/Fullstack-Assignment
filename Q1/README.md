<div align="center">
  <h1>🎨 Drawly</h1>
  <p><strong>A Real-Time Multiplayer Drawing & Guessing Game</strong></p>
  <p>Built with Node.js, Express, Socket.IO 4, and HTML5 Canvas</p>
</div>

---

## 🌟 Overview
Drawly is a highly scalable, real-time multiplayer Pictionary-style game. Players can create rooms, invite friends via links, and take turns drawing and guessing secret words. The server acts as the absolute authority, managing game state, round timing, scoring, and even employing a **machine-learning Anti-Cheat system (OCR)** to catch drawers who try to cheat by writing the word.

## 🚀 Quick Start

1. **Navigate to the project folder:**
   ```bash
   cd Q1
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Start the server:**
   ```bash
   npm start
   ```
   > By default, the server runs on port `3000`. You can access the game at **http://localhost:3000**.
   > If the port is in use, start it on a different port: `$env:PORT=4000; npm start`

## 🎮 How to Play

1. **Create a Room:** Enter your name, choose the number of rounds, set the draw time, and pick a **Word Category** (General, Hard, Animals, Food, Movies) or provide custom words.
2. **Invite Friends:** Copy the generated invite link from the Waiting Room and send it to your friends.
3. **Start the Game:** Once at least 2 players are in the room, the host can start the game.
4. **Gameplay:** 
   - **Drawer:** Selects from 3 word choices and draws on the canvas using the Pen, Eraser, or Fill tools.
   - **Guessers:** Type guesses into the chat. The faster you guess, the more points you earn.
5. **Winning:** The player with the most points at the end of all rounds wins!

## ⚙️ Architecture & Scalability

Drawly is designed as a robust, event-driven system prioritizing low-latency real-time data flow, state consistency, and fail-safe recovery.

### System Architecture Diagram

```mermaid
graph TD
    subgraph Client [Browser Clients]
        C1[Drawer]
        C2[Guesser]
        C3[Guesser]
    end

    subgraph Server [Node.js Backend]
        IO[Socket.IO Server]
        
        subgraph Core [Game Engine]
            RM[Room Manager]
            GE[State Machine]
            SB[Stroke Buffer]
            WM[Word Manager]
        end

        subgraph Security [Security & Abuse]
            RL[Rate Limiter]
            AC[Anti-Cheat OCR]
        end
    end

    C1 <-->|WS: Stroke Batches| IO
    C2 <-->|WS: Guesses| IO
    C3 <-->|WS: Guesses| IO

    IO --> RL
    RL --> Core
    
    GE --> SB
    GE --> WM
    
    SB -->|Canvas Sampling| AC
```

### Important Concepts: WebSockets & Syncing

Drawly relies heavily on **WebSockets (via Socket.IO)** instead of traditional HTTP requests. Unlike HTTP where the client must constantly "ask" the server for updates, WebSockets maintain a persistent, bidirectional connection. This allows the server to immediately push new drawings to guessers the millisecond it receives them.

#### The Syncing Loop (Sequence Diagram)
To ensure the game feels smooth and responsive without overwhelming the server, Drawly uses a **batched syncing strategy**.

```mermaid
sequenceDiagram
    participant D as Drawer
    participant S as Server
    participant G as Guesser

    Note over D,G: Round Starts
    loop Every 25ms
        D->>D: Capture mouse movements
        D->>S: Flush Stroke Batch [{x,y}, {x,y}...]
        S->>S: Validate bounds, size, colors
        S->>S: Store in Stroke Buffer
        S->>G: Broadcast Stroke Batch
        G->>G: Render lines sequentially
    end
    
    Note over S: Every 2.5s
    S->>S: Sample canvas for text (Anti-Cheat)
```

### Real-Time Canvas Synchronization
Drawing is captured as **live point batches**. Every 25ms, the client flushes these batches to the server. The server sanitizes the data (clamping coordinates, verifying colors, checking sizes) and relays it to all guessers. 
- **Zero visible lag:** Remote canvases render the strokes progressively, making the drawing appear exactly as the drawer moves their mouse.
- **Mid-Round Joining:** A `StrokeBuffer` stores the history of the current turn, allowing late joiners or reconnecting players to instantly see the complete canvas upon joining.
- **Memory Caps:** The buffer enforces hard limits (e.g., 3,000 strokes max) to ensure malicious users cannot OOM (Out-Of-Memory) the server.

### Server-Authoritative State & Security
- **State Machine:** The server dictates all state transitions (`LOBBY` -> `PICKING_WORD` -> `DRAWING` -> `ROUND_END`). Clients cannot manipulate timers or game progression.
- **Secret Words:** The secret word is **never** sent to guessers, preventing client-side scraping.
- **Scoring:** The server calculates all points based on round elapsed time. Guessers get points based on speed; the drawer receives **75% of the average points** awarded to the guessers for that round.
- **Reconnection Grace Period:** If a player drops connection or refreshes, they are kept in the room for **30 seconds**. Upon reconnecting with their session token, their socket mapping is seamlessly swapped, preserving their score and seat.

### Anti-Cheat System (OCR) 🛡️
To prevent the drawer from simply writing the word on the canvas, Drawly features a hybrid heuristic-OCR pipeline:
1. **Heuristics:** A fast, bounding-box based filter (`heuristic.js`) checks if drawn strokes resemble handwriting before invoking heavy processing.
2. **Pure-JS Rasterizer:** A custom `renderer.js` module renders vector strokes into a binary PBM (Portable Bitmap) image on the server, completely avoiding the need for native canvas dependencies.
3. **Tesseract.js OCR:** The image is scanned by Tesseract. The detected text is cross-referenced with the secret word using a Levenshtein fuzzy match.
4. **Penalties:** If a `>80%` match is found, the drawer's canvas is forcefully wiped, they receive a `-50 point penalty`, and are warned. Three strikes result in a forfeited turn.

## 📊 Performance Testing

The project includes an automated load testing script to measure capacity. Because the OCR Anti-Cheat system uses WebAssembly workers (which are highly CPU-intensive), capacity depends heavily on the server's CPU.

To run the load test:
```bash
node scripts/loadtest.js --url http://localhost:3000 --start 10 --step 10 --max 100 --ramp 8
```

### Load Test Results
*Measured on an i7-12700H, 16 GB RAM, Windows 11 with Anti-Cheat Enabled*

| rooms | sockets | CPU% | RSS MB | heap MB | p50 ms | p99 ms |
|------:|--------:|-----:|-------:|--------:|-------:|-------:|
|    10 |      30 | 97.6 |  128.6 |    12.4 |  15.65 |  50.89 |

> **Note:** With the Anti-Cheat system fully active, Tesseract OCR consumes massive CPU analyzing strokes, limiting a single Node instance to around 10 highly active concurrent rooms before the event-loop p99 latency breaches 50ms. If you are deploying this for mass scale, you should disable Anti-Cheat in `server/config.js` or offload the OCR worker to a separate microservice.

## 📂 Project Structure

```
├── server/
│   ├── index.js           # Express + Socket.IO server entrypoint
│   ├── roomManager.js     # Room CRUD & player management (30s reconnect grace)
│   ├── gameEngine.js      # Turn state machine & server-authoritative scoring
│   ├── wordManager.js     # Word selection & progressive hints
│   ├── guessChecker.js    # Levenshtein answer validation & near-miss logic
│   ├── strokeBuffer.js    # Live-segment buffer, undo, and replay capabilities
│   ├── rateLimiter.js     # Chat + stroke rate limits & size caps
│   ├── config.js          # Centralized configuration and tuning parameters
│   ├── antiCheat/         # OCR-based anti-cheat system
│   │   ├── index.js       # Orchestrator and penalty logic
│   │   ├── heuristic.js   # Fast bounding-box check for text-like strokes
│   │   ├── renderer.js    # Pure-JS stroke to PBM image rasterizer
│   │   └── ocrWorker.js   # Tesseract.js wrapper
│   └── words.json         # Categorized word lists
├── public/
│   ├── index.html         # Single-page application UI
│   ├── css/style.css      # Dark glassmorphism design system
│   └── js/
│       ├── app.js         # Client orchestrator & session management
│       ├── canvas.js      # Drawing engine (live streaming at 25 ms flush)
│       ├── chat.js        # Chat system & guess inputs
│       ├── game.js        # Game state UI updates
│       ├── lobby.js       # Room creation/joining interface
│       └── replay.js      # End-of-game stroke replay engine
├── scripts/
│   └── loadtest.js        # Capacity measurement script
├── package.json
└── README.md
```

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js + Express |
| **Real-time Transport** | Socket.IO 4 (WebSocket) |
| **Frontend** | Vanilla HTML5 / CSS3 / JavaScript |
| **Graphics** | HTML5 `<canvas>` API |
| **Machine Learning** | Tesseract.js (OCR) |
