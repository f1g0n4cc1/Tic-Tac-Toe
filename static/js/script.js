const socket = io();

// DOM Elements
const lobbyScreen = document.getElementById('lobby');
const gameScreen = document.getElementById('game');
const boardElement = document.getElementById('board');
const cells = document.querySelectorAll('.cell');
const statusMsg = document.getElementById('status-msg');
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const roomCodeInput = document.getElementById('room-code-input');
const usernameInput = document.getElementById('username');
const displayRoomCode = document.getElementById('display-room-code');
const darkModeToggle = document.getElementById('dark-mode-toggle');
const floatingEmotes = document.getElementById('floating-emotes');
const coinFlipContainer = document.getElementById('coin-flip');
const coin = document.querySelector('.coin');
const restartBtn = document.getElementById('restart-btn');

// Game State
let roomID = null;
let mySymbol = null;
let isMyTurn = false;
let gameActive = false;

// Define the SVG templates as strings
const markers = {
    X: `<svg viewBox="0 0 100 100">
            <path class="marker-path" d="M20 20 L80 80 M80 20 L20 80" />
        </svg>`,
    O: `<svg viewBox="0 0 100 100">
            <circle class="marker-path" cx="50" cy="50" r="35" />
        </svg>`
};

// Audio / Haptics
function vibrate(pattern) {
    if (navigator.vibrate) {
        navigator.vibrate(pattern);
    }
}

// Helper: Show Screen
function showScreen(screen) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
}

// Event Listeners
createBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (!name) return alert("Please enter your name");
    socket.emit('create_room', { name: name });
    // Expect 'room_created' event
});

const aiBtn = document.getElementById('ai-btn');
const aiDifficulty = document.getElementById('ai-difficulty');
const diffBtns = document.querySelectorAll('.diff-btn');

aiBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (!name) return alert("Please enter your name");
    // Show difficulty selection instead of joining immediately
    aiDifficulty.style.display = 'flex';
    aiBtn.style.display = 'none'; // Hide main button to focus on difficulty
});

diffBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const name = usernameInput.value.trim();
        const difficulty = btn.dataset.level;
        socket.emit('create_ai_room', { name: name, difficulty: difficulty });

        // Reset UI for next time
        aiDifficulty.style.display = 'none';
        aiBtn.style.display = 'block';
    });
});

joinBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    const code = roomCodeInput.value.trim();
    if (!name || !code) return alert("Enter name and room code");

    // Store in localStorage for refresh recovery
    localStorage.setItem('ttt_name', name);
    localStorage.setItem('ttt_room', code);

    socket.emit('join_game', {
        room_id: code,
        name: name,
        player_id: getPlayerID()
    });
});

function getPlayerID() {
    let id = localStorage.getItem('ttt_player_id');
    if (!id) {
        id = Math.random().toString(36).substring(2) + Date.now().toString(36);
        localStorage.setItem('ttt_player_id', id);
    }
    return id;
}

cells.forEach(cell => {
    cell.addEventListener('click', () => {
        if (!gameActive || !isMyTurn) return;
        const index = cell.dataset.index;
        if (cell.classList.contains('occupied')) return;

        // Optimistic UI update/Selection
        // But let's wait for server to be safe or just send move
        socket.emit('make_move', { room_id: roomID, index: index, symbol: mySymbol });
    });
});

document.querySelectorAll('.emote-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const emote = btn.dataset.emote;
        socket.emit('send_emote', { room_id: roomID, emote: emote });
    });
});

restartBtn.addEventListener('click', () => {
    socket.emit('reset_game', { room_id: roomID });
    restartBtn.style.display = 'none';
    statusMsg.textContent = "Waiting for restart...";
});

darkModeToggle.addEventListener('change', () => {
    document.body.setAttribute('data-theme', darkModeToggle.checked ? 'dark' : 'light');
});

// Socket Events
socket.on('connect', () => {
    document.getElementById('loader').classList.add('hidden');
    statusMsg.textContent = "Connected!";
});

socket.on('disconnect', () => {
    document.getElementById('loader').classList.remove('hidden');
    statusMsg.textContent = "Connection lost. Reconnecting...";
});

socket.on('room_created', (data) => {
    const code = data.room_id;
    roomID = code; // Set global roomID immediately

    // Fix: Save for reconnection
    const name = usernameInput.value || localStorage.getItem('ttt_name');
    if (name) {
        localStorage.setItem('ttt_name', name);
        localStorage.setItem('ttt_room', code);
    }

    // Auto join the room we created
    socket.emit('join_game', {
        room_id: code,
        name: name,
        player_id: getPlayerID()
    });
});

socket.on('player_joined', (data) => {
    roomID = data.room_id || (roomID ? roomID : roomCodeInput.value);

    if (data.symbol && !mySymbol) {
        mySymbol = data.symbol;
        displayRoomCode.textContent = roomID;
        showScreen(gameScreen);
    }

    const me = data.players.find(p => p.name === (usernameInput.value || localStorage.getItem('ttt_name')));
    if (me && !mySymbol) mySymbol = me.symbol;

    updateScoreboardNames(data.players);

    if (data.players.length < 2) {
        statusMsg.textContent = "Waiting for opponent...";
    } else {
        statusMsg.textContent = "Opponent joined! Ready?";
    }
});

socket.on('player_reconnected', (data) => {
    roomID = data.room_id;
    mySymbol = data.symbol;
    gameActive = data.game_active;
    isMyTurn = (data.turn === mySymbol);

    displayRoomCode.textContent = roomID;
    showScreen(gameScreen);
    resetBoard();

    // Restore board
    data.board.forEach((sym, i) => {
        if (sym) {
            const cell = document.querySelector(`.cell[data-index="${i}"]`);
            cell.textContent = sym;
            cell.classList.add('occupied', sym);
        }
    });

    updateScoreboardNames(data.players);
    updateScores(data.wins);
    updateTurnInternal(data.turn);
    statusMsg.textContent = "Reconnected!";
});

socket.on('player_left', (data) => {
    statusMsg.textContent = data.message;
    gameActive = false;
    vibrate([100, 50, 100]);
});

// Auto-reconnect on load if room info exists
window.addEventListener('load', () => {
    const savedName = localStorage.getItem('ttt_name');
    const savedRoom = localStorage.getItem('ttt_room');
    if (savedName && savedRoom) {
        usernameInput.value = savedName;
        roomCodeInput.value = savedRoom;
        // Small delay to ensure socket is ready
        setTimeout(() => {
            socket.emit('join_game', {
                room_id: savedRoom,
                name: savedName,
                player_id: getPlayerID()
            });
        }, 500);
    }
});

socket.on('game_start', (data) => {
    gameActive = true;
    resetBoard();
    restartBtn.style.display = 'none'; // Hide if shown

    // Coin Flip Animation
    coinFlipContainer.classList.remove('hidden');

    // Force reflow
    void coin.offsetWidth;

    // Animate based on who starts (turn)
    // If turn is X, land on Heads. If O, land on Tails. 
    // We can cheat the animation for visual feedback
    const winningSide = data.turn === 'X' ? 0 : 180;
    const rotations = 1800 + winningSide; // 5 spins + outcome

    coin.style.transform = `rotateY(${rotations}deg)`;
    coin.style.transition = "transform 3s ease-out";

    setTimeout(() => {
        coinFlipContainer.classList.add('hidden');
        // Reset transform so we can spin again if needed (with no transition)
        coin.style.transition = "none";
        coin.style.transform = "rotateY(0deg)";

        updateTurnInternal(data.turn);

        // Haptic check
        if (navigator.vibrate) navigator.vibrate(200);
    }, 3500);
});

// Input Sanitization
[usernameInput, roomCodeInput].forEach(input => {
    input.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, '');
    });
});

socket.on('move_made', (data) => {
    const cell = document.querySelector(`.cell[data-index="${data.index}"]`);
    cell.innerHTML = markers[data.symbol];
    cell.classList.add('occupied', data.symbol);

    // Haptic if it's my move (confirm) or opp move (alert)
    if (data.symbol !== mySymbol) {
        vibrate(200);
    } else {
        vibrate(50);
    }

    if (data.next_turn) {
        updateTurnInternal(data.next_turn);
    }
});

socket.on('game_over', (data) => {
    gameActive = false;
    let msg = "";
    if (data.winner === 'Draw') {
        msg = "It's a Draw! 🧂";
    } else {
        msg = data.winner === mySymbol ? "You Win! 🎉" : "You Lost! 💀";
    }
    statusMsg.textContent = msg;

    // Auto restart or button?
    restartBtn.style.display = 'block';

    // Update scores
    updateScores(data.wins);
});

socket.on('emote_received', (data) => {
    showFloatingEmote(data.emote);
    if (data.sender_sid !== socket.id) {
        vibrate([50, 50, 50]);
    }
});

socket.on('error', (data) => {
    alert(data.message);
});

// Internal Logic
function updateTurnInternal(turn) {
    isMyTurn = (turn === mySymbol);
    statusMsg.textContent = isMyTurn ? `Your Turn (${mySymbol})` : `Opponent's Turn (${turn === 'X' ? 'O' : 'X'})`;

    // Visual indicators
    document.querySelector('.player.p1').classList.toggle('active', turn === 'X');
    document.querySelector('.player.p2').classList.toggle('active', turn === 'O');
}

function resetBoard() {
    cells.forEach(cell => {
        cell.innerHTML = '';
        cell.className = 'cell';
    });
}

function showFloatingEmote(emoji) {
    const el = document.createElement('div');
    el.classList.add('floating-emote');
    el.textContent = emoji;
    el.style.left = Math.random() * 80 + 10 + '%'; // Random horizontal pos
    floatingEmotes.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

function updateScoreboardNames(players) {
    const p1 = players.find(p => p.symbol === 'X');
    const p2 = players.find(p => p.symbol === 'O');

    if (p1) {
        document.querySelector('.player.p1 .name').textContent = p1.name;
    }
    if (p2) {
        document.querySelector('.player.p2 .name').textContent = p2.name;
    } else {
        document.querySelector('.player.p2 .name').textContent = "Waiting...";
    }
}

function updateScores(wins) {
    document.querySelector('.player.p1 .score').textContent = wins['X'];
    document.querySelector('.player.p2 .score').textContent = wins['O'];
}

// Mobile Height Fix
function setAppHeight() {
    document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
}
window.addEventListener('resize', setAppHeight);
setAppHeight();
