const prisma = require('../config/database');
const logger = require('../utils/logger');
const { BadRequestError, NotFoundError, ConflictError, ForbiddenError } = require('../utils/errors');
const coinService = require('../services/coin.service');
const eliminationService = require('../services/elimination.service');

/**
 * Create a new spin wheel (Admin only)
 * POST /api/spin-wheel
 */
async function createSpinWheel(req, res, next) {
  try {
    const { entryFee, winnerPoolPct, adminPoolPct, appPoolPct } = req.body;

    // Check no active wheel exists
    const activeWheel = await prisma.spinWheel.findFirst({
      where: { status: { in: ['WAITING', 'ACTIVE'] } },
    });

    if (activeWheel) {
      throw new ConflictError('An active spin wheel already exists. Only one active wheel allowed at a time.');
    }

    // Get defaults from config if not provided
    const config = await getConfigMap();
    const fee = entryFee || parseInt(config.DEFAULT_ENTRY_FEE) || 100;
    const wPct = winnerPoolPct || parseFloat(config.DEFAULT_WINNER_POOL_PCT) || 70;
    const aPct = adminPoolPct || parseFloat(config.DEFAULT_ADMIN_POOL_PCT) || 20;
    const appPct2 = appPoolPct || parseFloat(config.DEFAULT_APP_POOL_PCT) || 10;

    // Validate percentages sum to 100
    if (Math.abs(wPct + aPct + appPct2 - 100) > 0.01) {
      throw new BadRequestError('Pool percentages must sum to 100');
    }

    const autoStartDelay = parseInt(config.AUTO_START_DELAY) || 180;

    const wheel = await prisma.spinWheel.create({
      data: {
        entryFee: fee,
        winnerPoolPct: wPct,
        adminPoolPct: aPct,
        appPoolPct: appPct2,
        minParticipants: parseInt(config.MIN_PARTICIPANTS) || 3,
        eliminationInterval: parseInt(config.ELIMINATION_INTERVAL) || 7,
        autoStartDelay,
        autoStartAt: new Date(Date.now() + autoStartDelay * 1000),
        createdById: req.user.id,
      },
      include: {
        createdBy: { select: { id: true, username: true } },
        participants: { include: { user: { select: { id: true, username: true } } } },
      },
    });

    // Start auto-start timer
    const io = req.app.get('io');
    eliminationService.startAutoStartTimer(
      wheel.id,
      autoStartDelay,
      io,
      async () => {
        await handleAutoStart(wheel.id, io);
      }
    );

    // Broadcast to all connected clients
    io.emit('wheel_created', {
      spinWheelId: wheel.id,
      entryFee: wheel.entryFee,
      autoStartAt: wheel.autoStartAt,
      createdBy: wheel.createdBy.username,
    });

    logger.info(`Spin wheel created by ${req.user.username}: ${wheel.id}`);
    res.status(201).json({ success: true, data: { spinWheel: wheel } });
  } catch (error) {
    next(error);
  }
}

/**
 * Join an active spin wheel
 * POST /api/spin-wheel/:id/join
 */
async function joinSpinWheel(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const wheel = await prisma.spinWheel.findUnique({
      where: { id },
      include: { participants: true },
    });

    if (!wheel) throw new NotFoundError('Spin wheel not found');
    if (wheel.status !== 'WAITING') {
      throw new BadRequestError('Spin wheel is not accepting participants');
    }

    // Check if already joined
    const alreadyJoined = wheel.participants.find((p) => p.userId === userId);
    if (alreadyJoined) {
      throw new ConflictError('You have already joined this spin wheel');
    }

    // Check user has enough coins
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user.coins < wheel.entryFee) {
      throw new BadRequestError(
        `Insufficient coins. You have ${user.coins} but need ${wheel.entryFee}`
      );
    }

    // Deduct entry fee atomically
    await coinService.deductCoins(userId, wheel.entryFee, id, 'Spin wheel entry fee');

    // Distribute entry fee to pools
    await coinService.distributeEntryFee(
      id,
      wheel.entryFee,
      wheel.winnerPoolPct,
      wheel.adminPoolPct,
      wheel.appPoolPct
    );

    // Add participant
    const participant = await prisma.participant.create({
      data: { userId, spinWheelId: id },
      include: { user: { select: { id: true, username: true, coins: true } } },
    });

    // Get updated participant count
    const participantCount = await prisma.participant.count({
      where: { spinWheelId: id },
    });

    // Get updated wheel with pools
    const updatedWheel = await prisma.spinWheel.findUnique({
      where: { id },
      select: { winnerPoolAmount: true, adminPoolAmount: true, appPoolAmount: true },
    });

    // Broadcast join event
    const io = req.app.get('io');
    io.to(`wheel:${id}`).emit('user_joined', {
      spinWheelId: id,
      user: { id: participant.user.id, username: participant.user.username },
      participantCount,
      pools: updatedWheel,
    });

    // Also broadcast globally so dashboard can update
    io.emit('participant_update', { spinWheelId: id, participantCount });

    logger.info(`${req.user.username} joined wheel ${id}. Participants: ${participantCount}`);
    res.json({
      success: true,
      data: {
        participant,
        participantCount,
        newBalance: participant.user.coins,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Manually start a spin wheel (Admin only)
 * POST /api/spin-wheel/:id/start
 */
async function startSpinWheel(req, res, next) {
  try {
    const { id } = req.params;

    const wheel = await prisma.spinWheel.findUnique({
      where: { id },
      include: { participants: true },
    });

    if (!wheel) throw new NotFoundError('Spin wheel not found');
    if (wheel.status !== 'WAITING') {
      throw new BadRequestError('Spin wheel is not in waiting state');
    }

    if (wheel.createdById !== req.user.id) {
      throw new ForbiddenError('Only the wheel creator can manually start it');
    }

    if (wheel.participants.length < wheel.minParticipants) {
      throw new BadRequestError(
        `Need at least ${wheel.minParticipants} participants. Current: ${wheel.participants.length}`
      );
    }

    // Clear auto-start timer
    eliminationService.clearAutoStartTimer(id);

    // Update status
    await prisma.spinWheel.update({
      where: { id },
      data: { status: 'ACTIVE', startedAt: new Date() },
    });

    // Start elimination process
    const io = req.app.get('io');
    runEliminationsAsync(id, io);

    logger.info(`Wheel ${id} manually started by ${req.user.username}`);
    res.json({ success: true, data: { message: 'Spin wheel started!' } });
  } catch (error) {
    next(error);
  }
}

/**
 * Get the active spin wheel
 * GET /api/spin-wheel/active
 */
async function getActiveWheel(req, res, next) {
  try {
    const wheel = await prisma.spinWheel.findFirst({
      where: { status: { in: ['WAITING', 'ACTIVE'] } },
      include: {
        createdBy: { select: { id: true, username: true } },
        participants: {
          include: { user: { select: { id: true, username: true } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    res.json({ success: true, data: { spinWheel: wheel } });
  } catch (error) {
    next(error);
  }
}

/**
 * Get spin wheel by ID with full details
 * GET /api/spin-wheel/:id
 */
async function getSpinWheel(req, res, next) {
  try {
    const { id } = req.params;

    const wheel = await prisma.spinWheel.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, username: true } },
        winner: { select: { id: true, username: true } },
        participants: {
          include: { user: { select: { id: true, username: true } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    if (!wheel) throw new NotFoundError('Spin wheel not found');
    res.json({ success: true, data: { spinWheel: wheel } });
  } catch (error) {
    next(error);
  }
}

/**
 * Get spin wheel history
 * GET /api/spin-wheel/history
 */
async function getWheelHistory(req, res, next) {
  try {
    const wheels = await prisma.spinWheel.findMany({
      where: { status: { in: ['COMPLETED', 'ABORTED'] } },
      include: {
        createdBy: { select: { id: true, username: true } },
        winner: { select: { id: true, username: true } },
        _count: { select: { participants: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    res.json({ success: true, data: { wheels } });
  } catch (error) {
    next(error);
  }
}

/**
 * Get user's transactions
 * GET /api/transactions
 */
async function getTransactions(req, res, next) {
  try {
    const transactions = await prisma.transaction.findMany({
      where: { userId: req.user.id },
      include: {
        spinWheel: { select: { id: true, entryFee: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ success: true, data: { transactions } });
  } catch (error) {
    next(error);
  }
}

/**
 * Get game configuration (Admin only)
 * GET /api/config
 */
async function getConfig(req, res, next) {
  try {
    const configs = await prisma.gameConfig.findMany();
    res.json({ success: true, data: { configs } });
  } catch (error) {
    next(error);
  }
}

/**
 * Update game configuration (Admin only)
 * PUT /api/config/:key
 */
async function updateConfig(req, res, next) {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (!value) throw new BadRequestError('Value is required');

    const config = await prisma.gameConfig.update({
      where: { key },
      data: { value: String(value) },
    });

    logger.info(`Config updated by ${req.user.username}: ${key} = ${value}`);
    res.json({ success: true, data: { config } });
  } catch (error) {
    next(error);
  }
}

// === Helper Functions ===

async function getConfigMap() {
  const configs = await prisma.gameConfig.findMany();
  const map = {};
  configs.forEach((c) => (map[c.key] = c.value));
  return map;
}

async function handleAutoStart(spinWheelId, io) {
  try {
    const wheel = await prisma.spinWheel.findUnique({
      where: { id: spinWheelId },
      include: { participants: true },
    });

    if (!wheel || wheel.status !== 'WAITING') return;

    if (wheel.participants.length < wheel.minParticipants) {
      // Auto-abort and refund
      await prisma.spinWheel.update({
        where: { id: spinWheelId },
        data: { status: 'ABORTED', completedAt: new Date() },
      });

      const refunds = await coinService.refundAll(spinWheelId);

      io.to(`wheel:${spinWheelId}`).emit('wheel_aborted', {
        spinWheelId,
        reason: `Not enough participants (${wheel.participants.length}/${wheel.minParticipants})`,
        refunds,
      });

      io.emit('wheel_status_change', { spinWheelId, status: 'ABORTED' });

      logger.info(`Wheel ${spinWheelId} auto-aborted: insufficient participants`);
    } else {
      // Auto-start
      await prisma.spinWheel.update({
        where: { id: spinWheelId },
        data: { status: 'ACTIVE', startedAt: new Date() },
      });

      io.emit('wheel_status_change', { spinWheelId, status: 'ACTIVE' });
      runEliminationsAsync(spinWheelId, io);
      logger.info(`Wheel ${spinWheelId} auto-started with ${wheel.participants.length} participants`);
    }
  } catch (error) {
    logger.error(`Auto-start error for wheel ${spinWheelId}: ${error.message}`);
  }
}

function runEliminationsAsync(spinWheelId, io) {
  // Run eliminations in background (not blocking the request)
  eliminationService.runEliminations(spinWheelId, io).catch((error) => {
    logger.error(`Elimination process failed for wheel ${spinWheelId}: ${error.message}`);
  });
}

module.exports = {
  createSpinWheel,
  joinSpinWheel,
  startSpinWheel,
  getActiveWheel,
  getSpinWheel,
  getWheelHistory,
  getTransactions,
  getConfig,
  updateConfig,
};
