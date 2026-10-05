# Sapien Robot - Full Stack Assignment

This repository contains the solutions for the Sapien Robot Full Stack Assignment.

## Repository Structure

```
Sapien_Robot/
├── Q1/                               # Solution for Question 1 (Drawly - Multiplayer Pictionary)
│   ├── public/                       # Frontend client code (HTML, CSS, JS)
│   ├── server/                       # Backend server code (Node.js, Express, Socket.IO)
│   ├── scripts/                      # Load testing and rate limit testing scripts
│   ├── Documentation.md              # Project Documentation & Short Notes
│   ├── Final_Deliverables_Report.md  # Detailed requirements mapping
│   ├── Video_Recording_Plan.md       # Showcase video storyboard and AI voiceover script
│   └── README.md                     # Q1 specific setup and architecture details
├── Q2/                               # Solution for Question 2 (Reserved)
├── Full stack assignment_1Oct.pdf    # Original Assignment Document
└── README.md                         # This file
```

## Running the Solutions

### Question 1: Drawly (Multiplayer Drawing Game)
To run the Drawly game, navigate to the `Q1` directory and start the server:

```bash
cd Q1
npm install
npm start
```
> The game will be accessible at **http://localhost:3000** (or port 4000 if 3000 is occupied).
> For full architecture details, capacity testing, and the anti-cheat system explanation, please read the [Q1 README](./Q1/README.md).

### Question 2: System Design (Listen Together Rooms)
This section contains a comprehensive System Design document for a highly scalable, Spotify-style music streaming service featuring real-time "Listen Together" rooms. 

The design covers:
* **Scale & Architecture:** Handling 20 million MAUs, 2 million peak concurrent listeners, and massive audio delivery (320 Gbps) using CDNs and Adaptive Bitrate (ABR) CMAF segments.
* **Real-time Syncing:** How to achieve <200ms synchronization across thousands of clients using time-anchored commands, WebSocket fan-outs, and drift correction.
* **Data Storage:** The breakdown of how Postgres, Redis, OpenSearch, etcd, and Kafka are utilized together to guarantee consistency and low latency.
* **Failure Handling:** Strategies for dealing with room node crashes, region outages, and reconnect storms.

> Please navigate to the `Q2` directory and read the [Q2 README](./Q2/README.md) for the complete architecture document and Mermaid diagrams.
