# Tic-Tac-Toe

A real-time multiplayer Tic-Tac-Toe web application featuring both peer-to-peer and AI game modes, built with Python (Quart) and Socket.IO.

## Features

- **Multiplayer:** Real-time matches against other players using room codes.
- **Single Player vs AI:**
  - **Easy:** Makes random mistakes, suitable for casual play.
  - **Hard:** Uses the Minimax algorithm for optimal play (unbeatable).
- **Resilient Connections:** Automatic reconnection support for page refreshes.
- **Design:** Modern Neon Glass UI with Dark/Light mode support and self-drawing SVG markers.
- **Interactive:** Live game states, coin flip animations, self-drawing SVG markers, and floating emotes.

## Technologies

- **Backend:** Quart (Python ASGI web framework), Python-SocketIO
- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Server:** Uvicorn

## Installation

1.  **Clone the repository.**

2.  **Set up a virtual environment:**
    ```bash
    python -m venv venv
    # Windows
    venv\Scripts\activate
    # Linux/Mac
    source venv/bin/activate
    ```

3.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

## Configuration

For production environments, ensure you set the following environment variables:

-   `SECRET_KEY`: A strong, random string for session security.
-   `ALLOWED_ORIGINS`: Comma-separated list of allowed frontend domains for CORS (e.g., `https://yourdomain.com`).

## Usage

**Development:**
Run the server with hot-reloading enabled:
```bash
python -m uvicorn app:asgi_app --port 5000 --reload
```

**Production:**
Run the server using Uvicorn directly or via a process manager:
```bash
python -m uvicorn app:asgi_app --host 0.0.0.0 --port $PORT
```

## How to Play

1.  Enter your name on the home screen.
2.  **To Host:** Click "Create Room" to generate a game code. Share this code with a friend.
3.  **To Join:** Enter a room code provided by a host and click "Join".
4.  **To Play AI:** Click "Play vs AI" and select your difficulty level.
