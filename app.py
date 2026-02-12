import os
import random
import string
import re
import asyncio
import uuid
from quart import Quart, render_template, request, session
import socketio

import time

app = Quart(__name__)
# Security: Enforce SECRET_KEY from environment in production
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY')
if not app.config['SECRET_KEY']:
    print("WARNING: SECRET_KEY not set in environment. Using temporary random key.")
    app.config['SECRET_KEY'] = os.urandom(24).hex()

# Security: Configure CORS
allowed_origins = os.environ.get('ALLOWED_ORIGINS', '*').split(',')
if allowed_origins == ['*']:
    print("WARNING: CORS allowed origins set to '*'")
else:
    print(f"Configuring CORS for origins: {allowed_origins}")

# Initialize Async Socket.IO server
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins=allowed_origins)
asgi_app = socketio.ASGIApp(sio, app)

# Game State Storage
rooms = {}
# Mapping of sid to room_id for cleanup
sid_to_room = {}

# Cleanup Configuration
ROOM_TIMEOUT = 3600  # 1 hour
CLEANUP_INTERVAL = 300  # 5 minutes

async def cleanup_rooms():
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL)
        print("Running room cleanup...")
        now = time.time()
        rooms_to_delete = []
        for r_id, room in rooms.items():
            # Delete if empty for too long or just inactive for very long
            last_act = room.get('last_activity', now)
            if len(room['players']) == 0 and (now - last_act > 60): # Empty for 1 min
                rooms_to_delete.append(r_id)
            elif (now - last_act > ROOM_TIMEOUT): # Inactive for 1 hour
                rooms_to_delete.append(r_id)
        
        for r_id in rooms_to_delete:
            print(f"Deleting inactive room: {r_id}")
            del rooms[r_id]

@app.before_serving
async def start_cleanup():
    app.add_background_task(cleanup_rooms)

def is_valid_input(text):
    if not text: return False
    # Allow spaces and some symbols for names
    return bool(re.match(r'^[a-zA-Z0-9\s🤖️]+$', text))

def generate_room_id():
    while True:
        room_id = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if room_id not in rooms:
            return room_id

@app.route('/')
async def index():
    if 'player_id' not in session:
        session['player_id'] = str(uuid.uuid4())
    return await render_template('index.html')

@sio.on('connect')
async def handle_connect(sid, environ):
    print(f"DEBUG: Client connected: {sid}")

@sio.on('create_room')
async def handle_create_room(sid, data):
    name = data.get('name', '')
    print(f"DEBUG: create_room from {sid}, name: {name}")
    if not is_valid_input(name):
        print(f"DEBUG: Invalid name in create_room: {name}")
        return await sio.emit('error', {'message': 'Invalid name'}, room=sid)
        
    room_id = generate_room_id()
    rooms[room_id] = {
        'board': [''] * 9,
        'players': {},
        'turn': 'X', 
        'wins': {'X': 0, 'O': 0},
        'game_active': False,
        'last_activity': time.time()
    }
    print(f"DEBUG: Room created: {room_id}")
    await sio.emit('room_created', {'room_id': room_id}, room=sid)

@sio.on('join_game')
async def handle_join_game(sid, data):
    room_id = data.get('room_id')
    player_name = data.get('name')
    
    if not is_valid_input(player_name) or not is_valid_input(room_id):
        await sio.emit('error', {'message': 'Invalid input'}, room=sid)
        return
    
    if room_id not in rooms:
        await sio.emit('error', {'message': 'Room not found'}, room=sid)
        return

    room = rooms[room_id]

    # Block re-joining if 2 players are already there
    if len(room['players']) >= 2 and sid not in room['players']:
        await sio.emit('error', {'message': 'Room is full'}, room=sid)
        return

    # Assign symbol and proceed as fresh join
    symbol = 'X' if len(room['players']) == 0 else 'O'
    room['players'][sid] = {'name': player_name, 'symbol': symbol}
    sid_to_room[sid] = room_id
    
    await sio.enter_room(sid, room_id)
    await sio.emit('player_joined', {
        'room_id': room_id, 
        'symbol': symbol, 
        'players': [{'name': p['name'], 'symbol': p['symbol']} for p in room['players'].values()]
    }, room=room_id)

    # Start game triggers
    if room.get('is_ai_game'):
        print(f"DEBUG: Adding AI to room {room_id}")
        room['players']['AI'] = {'name': 'Minimax Bot 🤖', 'symbol': 'O'}
        await sio.emit('player_joined', {
            'room_id': room_id, 
            'players': [{'name': p['name'], 'symbol': p['symbol']} for p in room['players'].values()]
        }, room=room_id)
        await start_game(room_id)
    elif len(room['players']) == 2:
        print(f"DEBUG: Starting 2P game in {room_id}")
        await start_game(room_id)

@sio.on('create_ai_room')
async def handle_create_ai_room(sid, data):
    name = data.get('name', '')
    difficulty = data.get('difficulty', 'hard')
    
    if not is_valid_input(name):
        return await sio.emit('error', {'message': 'Invalid name'}, room=sid)

    room_id = generate_room_id()
    rooms[room_id] = {
        'board': [''] * 9,
        'players': {},
        'turn': 'X', 
        'wins': {'X': 0, 'O': 0},
        'game_active': False,
        'is_ai_game': True,
        'difficulty': difficulty,
        'last_activity': time.time()
    }
    await sio.emit('room_created', {'room_id': room_id}, room=sid)

async def start_game(room_id):
    if room_id not in rooms: return
    room = rooms[room_id]
    room['board'] = [''] * 9
    room['game_active'] = True
    
    starting_player = random.choice(['X', 'O'])
    room['turn'] = starting_player
    
    await sio.emit('game_start', {'turn': starting_player, 'board': room['board']}, room=room_id)
    
    if room.get('is_ai_game') and starting_player == 'O':
        await asyncio.sleep(4) 
        await make_ai_move(room_id)

@sio.on('make_move')
async def handle_move(sid, data):
    room_id = data.get('room_id')
    try:
        index = int(data.get('index'))
    except (ValueError, TypeError):
        return
        
    symbol = data.get('symbol') 
    
    if room_id not in rooms:
        return

    room = rooms[room_id]
    
    if sid not in room['players']:
        return

    if not room['game_active'] or room['turn'] != symbol or room['turn'] != room['players'][sid]['symbol']:
        return
        
    if room['board'][index] != '':
        return

    room['board'][index] = symbol
    room['last_activity'] = time.time()
    
    if await process_turn(room_id, index, symbol):
        if room.get('is_ai_game') and room['game_active'] and room['turn'] == 'O':
             await asyncio.sleep(1) 
             await make_ai_move(room_id)

async def process_turn(room_id, index, symbol):
    room = rooms[room_id]
    winner = check_winner(room['board'])
    
    if winner:
        room['game_active'] = False
        room['wins'][winner] += 1
        await sio.emit('move_made', {'index': index, 'symbol': symbol, 'next_turn': None}, room=room_id)
        await sio.emit('game_over', {'winner': winner, 'wins': room['wins']}, room=room_id)
        return False
    elif '' not in room['board']:
         room['game_active'] = False
         await sio.emit('move_made', {'index': index, 'symbol': symbol, 'next_turn': None}, room=room_id)
         await sio.emit('game_over', {'winner': 'Draw', 'wins': room['wins']}, room=room_id)
         return False
    else:
        room['turn'] = 'O' if symbol == 'X' else 'X'
        await sio.emit('move_made', {'index': index, 'symbol': symbol, 'next_turn': room['turn']}, room=room_id)
        return True

async def make_ai_move(room_id):
    if room_id not in rooms: return
    room = rooms[room_id]
    diff = room.get('difficulty', 'hard')
    
    roll = random.random()
    is_clumsy = False
    if diff == 'easy' and roll < 0.8: is_clumsy = True
    elif diff == 'medium' and roll < 0.4: is_clumsy = True
    
    board = room['board'][:]
    best_move = None
    
    if is_clumsy:
        empty_spots = [i for i, v in enumerate(board) if v == '']
        if empty_spots:
            best_move = random.choice(empty_spots)
    else:
        best_score = -float('inf')
        for i in range(9):
            if board[i] == '':
                board[i] = 'O'
                score = minimax(board, 0, False)
                board[i] = ''
                if score > best_score:
                    best_score = score
                    best_move = i
    
    if best_move is not None:
        room['board'][best_move] = 'O'
        await process_turn(room_id, best_move, 'O')

def minimax(board, depth, is_maximizing):
    result = check_winner(board)
    if result == 'O': return 10 - depth
    if result == 'X': return depth - 10
    if '' not in board: return 0
    
    if is_maximizing:
        best_score = -float('inf')
        for i in range(9):
            if board[i] == '':
                board[i] = 'O'
                score = minimax(board, depth + 1, False)
                board[i] = ''
                best_score = max(score, best_score)
        return best_score
    else:
        best_score = float('inf')
        for i in range(9):
            if board[i] == '':
                board[i] = 'X'
                score = minimax(board, depth + 1, True)
                board[i] = ''
                best_score = min(score, best_score)
        return best_score

@sio.on('send_emote')
async def handle_emote(sid, data):
    room_id = data.get('room_id')
    emote = data.get('emote')
    await sio.emit('emote_received', {'emote': emote, 'sender_sid': sid}, room=room_id) 

@sio.on('reset_game')
async def handle_reset(sid, data):
    room_id = data.get('room_id')
    if room_id in rooms:
        await start_game(room_id)

@sio.on('disconnect')
async def handle_disconnect(sid):
    if sid in sid_to_room:
        room_id = sid_to_room.pop(sid)
        if room_id in rooms:
            room = rooms[room_id]
            room['game_active'] = False
            await sio.emit('player_left', {'message': 'Opponent disconnected (can reconnect)'}, room=room_id)

def check_winner(board):
    winning_combos = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]
    for combo in winning_combos:
        if board[combo[0]] and board[combo[0]] == board[combo[1]] == board[combo[2]]:
            return board[combo[0]]
    return None

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(asgi_app, host='0.0.0.0', port=5000, log_level="info")
