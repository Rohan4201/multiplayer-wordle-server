// index.js in wordle-server

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const fs = require('fs');

const wordList = JSON.parse(fs.readFileSync('words.json', 'utf8'));
const validWords = new Set(wordList);
console.log(`Loaded ${validWords.size} valid words.`);

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow connections from any origin (for development)
    methods: ["GET", "POST"]
  }
});

// This will store our game rooms
const rooms = {};
function findRoomBySocketId(socketId) {
  return Object.values(rooms).find(room => 
    room.players.some(player => player.id === socketId)
  );
}

io.on('connection', (socket) => {
  console.log(`User Connected: ${socket.id}`);

  // --- ROOM MANAGEMENT ---
  socket.on('createRoom', () => {
      const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      socket.join(roomId);
      rooms[roomId] = {
        id: roomId, // <-- ADD THIS LINE
        players: [{ id: socket.id, name: 'Player 1' }],
        guesses: [],
        secretWord: null
      };
      socket.emit('roomCreated', roomId);
      console.log(`Room ${roomId} created by ${socket.id}`);
  });

// In wordle-server/index.js

  socket.on('joinRoom', (roomId) => {
    if (rooms[roomId] && rooms[roomId].players.length < 2) {
      socket.join(roomId);
      rooms[roomId].players.push({ id: socket.id, name: 'Player 2' });
      
      const room = rooms[roomId];
      io.to(roomId).emit('gameStart', room);
      console.log(`${socket.id} joined room ${roomId}`);

      // --- NEW CODE STARTS HERE ---
      // Randomly select who goes first
      const firstPlayer = room.players[Math.floor(Math.random() * room.players.length)];
      
      // Tell everyone who is setting the first word
      io.to(roomId).emit('setInitialTurn', { firstPlayerId: firstPlayer.id });
      // --- NEW CODE ENDS HERE ---

    } else {
      socket.emit('error', 'Room is full or does not exist.');
    }
  });

  // --- GAME LOGIC ---
  socket.on('setWord', ({ word }) => {
    const lowerWord = word.toLowerCase();

    // --- NEW VALIDATION ---
    if (!validWords.has(lowerWord)) {
      // Notify only the sender that the word is invalid and stop.
      return socket.emit('error', `'${word.toUpperCase()}' is not a valid word.`);
    }
    // ----------------------

    const room = findRoomBySocketId(socket.id);
    if (room) {
      room.secretWord = lowerWord;
      room.guesses = [];
      
      const guessingPlayer = room.players.find(p => p.id !== socket.id);
      if (guessingPlayer) {
        io.to(room.id).emit('newRound', { turn: guessingPlayer.id });
      }
    }
  });

  socket.on('makeGuess', ({ guess }) => {
    const lowerGuess = guess.toLowerCase();

    // --- NEW VALIDATION ---
    if (!validWords.has(lowerGuess)) {
      // Notify only the guesser that their word is not in the list and stop.
      return socket.emit('invalidGuess', `'${guess.toUpperCase()}' is not in the word list.`);
    }
    // ----------------------

    const room = findRoomBySocketId(socket.id);
    const secret = room ? room.secretWord : undefined;
    
    // This check is important to prevent crashes if the room or secret word doesn't exist
    if (room && secret) {
      let feedback = [];
      for (let i = 0; i < 5; i++) {
          if (lowerGuess[i] === secret[i]) {
              feedback.push('green');
          } else if (secret.includes(lowerGuess[i])) {
              feedback.push('yellow');
          } else {
              feedback.push('gray');
          }
      }
      
      room.guesses.push({ guess: guess.toUpperCase(), feedback });

      const isWinner = lowerGuess === secret;
      const isRoundOver = isWinner || room.guesses.length === 6;
      
      io.to(room.id).emit('guessResult', { guesses: room.guesses });
      
      if (isRoundOver) {
          const guessingPlayer = room.players.find(p => p.id === socket.id);
          io.to(room.id).emit('roundOver', { 
              isWinner, 
              secretWord: secret.toUpperCase(),
              nextTurn: guessingPlayer.id 
          });
      }
    }
  });
  socket.on('disconnect', () => {
    console.log(`User Disconnected: ${socket.id}`);
    // Find which room the player was in and notify the other player
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        // Remove player and notify
        room.players.splice(playerIndex, 1);
        io.to(roomId).emit('playerLeft', 'The other player has left the game.');
        // If room is empty, delete it
        if (room.players.length === 0) {
          delete rooms[roomId];
          console.log(`Room ${roomId} closed.`);
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server running on port ${PORT} 🚀`));