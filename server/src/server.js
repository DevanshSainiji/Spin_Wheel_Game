require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const logger = require('./utils/logger');
const { setupSocketHandlers } = require('./socket/socketHandler');

// Import routes
const authRoutes = require('./routes/auth.routes');
const spinWheelRoutes = require('./routes/spinWheel.routes');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Clean CLIENT_URL by removing trailing slash if present
const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: clientUrl,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Make io accessible in controllers via req.app
app.set('io', io);

// Middleware
app.use(cors({
  origin: clientUrl,
  credentials: true,
}));
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/spin-wheel', spinWheelRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global error handler
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : 'Internal Server Error';

  logger.error(`${statusCode} - ${err.message}`, { stack: err.stack });

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// Setup Socket.IO handlers
setupSocketHandlers(io);

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📡 Socket.IO ready`);
  logger.info(`🌐 Client URL: ${clientUrl}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

module.exports = { app, server, io };
