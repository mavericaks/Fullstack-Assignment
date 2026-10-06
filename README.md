# Sapien Robot - Full Stack Assignment

This repository contains the solutions for the Sapien Robot Full Stack Assignment.

## Repository Structure

```
Fullstack-Assignment/
├── Q1/                               # Solution for Question 1 (Drawly - Multiplayer Pictionary)
│   ├── public/                       # Frontend client code (HTML, CSS, JS)
│   ├── server/                       # Backend server code (Node.js, Express, Socket.IO)
│   ├── scripts/                      # Load testing, scripts, and legacy verification
│   ├── tests/                        # Automated unit tests for core game logic
│   ├── "Demo Video"/                 # Demonstration video of the Q1 solution
│   ├── Documentation.md              # Project Documentation & Short Notes
│   └── README.md                     # Q1 specific setup and architecture details
├── Q2/                               # System design doc: Listen Together rooms
├── Full stack assignment_1Oct.pdf    # Original Assignment Document
└── README.md                         # This file
```

**Requires Node >=22**
*Check out the [Demo Video](./Q1/Demo%20Video/Final%20Demo.mp4) to see the game in action!*

## Running the Solutions

### Question 1: Drawly (Multiplayer Drawing Game)
To run the Drawly game, navigate to the `Q1` directory and start the server:

```bash
cd Q1
npm install
npm start
```
> The game will be accessible at **http://localhost:3000**. If port 3000 is occupied, you can set a different port using the `PORT` environment variable.
> For full architecture details, capacity testing, and the anti-cheat system explanation, please read the [Q1 README](./Q1/README.md).

### Question 2: System Design (Listen Together Rooms)
This section contains a comprehensive System Design document for a highly scalable, Spotify-style music streaming service featuring real-time "Listen Together" rooms. 

The design covers:
* **Scale & Architecture:** Handling 20 million MAUs, 2 million peak concurrent listeners, and massive audio delivery (320 Gbps) using CDNs and Adaptive Bitrate (ABR) CMAF segments.
* **Real-time Syncing:** How to achieve <200ms synchronization across thousands of clients using time-anchored commands, WebSocket fan-outs, and drift correction.
* **Data Storage:** The breakdown of how Postgres, Redis, OpenSearch, etcd, and Kafka are utilized together to guarantee consistency and low latency.
* **Failure Handling:** Strategies for dealing with room node crashes, region outages, and reconnect storms.

> Please navigate to the `Q2` directory and read the [Q2 README](./Q2/README.md) for the complete architecture document and Mermaid diagrams.
