const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const logger = require('../utils/logger');
const { BadRequestError, ConflictError } = require('../utils/errors');

/**
 * Register a new user
 * POST /api/auth/register
 */
async function register(req, res, next) {
  try {
    const { username, email, password } = req.body;

    // Validate input
    if (!username || !email || !password) {
      throw new BadRequestError('Username, email, and password are required');
    }
    if (password.length < 6) {
      throw new BadRequestError('Password must be at least 6 characters');
    }

    // Check for existing user
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }],
      },
    });

    if (existingUser) {
      throw new ConflictError(
        existingUser.email === email.toLowerCase()
          ? 'Email already registered'
          : 'Username already taken'
      );
    }

    // Hash password and create user
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username: username.toLowerCase(),
        email: email.toLowerCase(),
        passwordHash,
        coins: 1000, // Default starting coins
        role: 'USER',
      },
      select: {
        id: true,
        username: true,
        email: true,
        coins: true,
        role: true,
        createdAt: true,
      },
    });

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    logger.info(`User registered: ${user.username} (${user.role})`);
    res.status(201).json({ success: true, data: { user, token } });
  } catch (error) {
    next(error);
  }
}

/**
 * Login user
 * POST /api/auth/login
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new BadRequestError('Email and password are required');
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      throw new BadRequestError('Invalid email or password');
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new BadRequestError('Invalid email or password');
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    logger.info(`User logged in: ${user.username}`);
    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          coins: user.coins,
          role: user.role,
        },
        token,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get current user profile
 * GET /api/auth/me
 */
async function getMe(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        username: true,
        email: true,
        coins: true,
        role: true,
        createdAt: true,
      },
    });

    res.json({ success: true, data: { user } });
  } catch (error) {
    next(error);
  }
}

module.exports = { register, login, getMe };
