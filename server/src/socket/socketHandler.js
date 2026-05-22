const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * Socket.IO event handler setup
 * Manages real-time communication for the spin wheel game
 */
function setupSocketHandlers(io) {
  // Authentication middleware for Socket.IO
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.user.username} (${socket.id})`);

    // Join a spin wheel room for real-time updates
    socket.on('join_room', ({ spinWheelId }) => {
      if (!spinWheelId) return;
      const room = `wheel:${spinWheelId}`;
      socket.join(room);
      logger.info(`${socket.user.username} joined room ${room}`);

      // Notify room
      socket.to(room).emit('room_user_joined', {
        username: socket.user.username,
        userId: socket.user.id,
      });
    });

    // Leave a spin wheel room
    socket.on('leave_room', ({ spinWheelId }) => {
      if (!spinWheelId) return;
      const room = `wheel:${spinWheelId}`;
      socket.leave(room);
      logger.info(`${socket.user.username} left room ${room}`);
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      logger.info(`Socket disconnected: ${socket.user.username} (${reason})`);
    });

    // Error handling
    socket.on('error', (error) => {
      logger.error(`Socket error for ${socket.user.username}: ${error.message}`);
    });
  });

  logger.info('Socket.IO handlers initialized');
}

module.exports = { setupSocketHandlers };
