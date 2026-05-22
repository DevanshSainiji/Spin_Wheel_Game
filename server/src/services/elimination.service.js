const prisma = require('../config/database');
const logger = require('../utils/logger');
const coinService = require('./coin.service');

// In-memory store for active timers
const activeTimers = new Map();

/**
 * Generate a random elimination order using Fisher-Yates shuffle
 */
function generateEliminationOrder(participants) {
  const shuffled = [...participants];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Start the auto-start countdown timer
 */
function startAutoStartTimer(spinWheelId, delaySeconds, io, startCallback) {
  // Clear any existing timer
  clearAutoStartTimer(spinWheelId);

  const startTime = Date.now();
  const endTime = startTime + delaySeconds * 1000;

  // Countdown tick every second
  const tickInterval = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    io.to(`wheel:${spinWheelId}`).emit('countdown_tick', { secondsRemaining: remaining });

    if (remaining <= 0) {
      clearInterval(tickInterval);
    }
  }, 1000);

  // Auto-start timeout
  const timeout = setTimeout(async () => {
    clearInterval(tickInterval);
    activeTimers.delete(spinWheelId);
    await startCallback();
  }, delaySeconds * 1000);

  activeTimers.set(spinWheelId, { timeout, tickInterval });
  logger.info(`Auto-start timer set for wheel ${spinWheelId}: ${delaySeconds}s`);
}

/**
 * Clear auto-start timer
 */
function clearAutoStartTimer(spinWheelId) {
  const timer = activeTimers.get(spinWheelId);
  if (timer) {
    clearTimeout(timer.timeout);
    clearInterval(timer.tickInterval);
    activeTimers.delete(spinWheelId);
    logger.info(`Auto-start timer cleared for wheel ${spinWheelId}`);
  }
}

/**
 * Run the elimination process
 * Eliminates one user every N seconds until one remains
 */
async function runEliminations(spinWheelId, io) {
  try {
    const wheel = await prisma.spinWheel.findUnique({
      where: { id: spinWheelId },
      include: {
        participants: {
          include: { user: { select: { id: true, username: true } } },
        },
      },
    });

    if (!wheel || wheel.status !== 'ACTIVE') {
      logger.error(`Cannot run eliminations: wheel ${spinWheelId} not active`);
      return;
    }

    // Generate random elimination order
    const eliminationOrder = generateEliminationOrder(wheel.participants);
    const intervalMs = wheel.eliminationInterval * 1000;

    logger.info(
      `Starting eliminations for wheel ${spinWheelId}: ` +
      `${eliminationOrder.length} participants, ${wheel.eliminationInterval}s interval`
    );

    // Broadcast the start with participant list (not the order!)
    io.to(`wheel:${spinWheelId}`).emit('wheel_started', {
      spinWheelId,
      participantCount: eliminationOrder.length,
      eliminationInterval: wheel.eliminationInterval,
    });

    // Process eliminations sequentially with delay
    for (let i = 0; i < eliminationOrder.length - 1; i++) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));

      const eliminated = eliminationOrder[i];

      // Update DB
      await prisma.participant.update({
        where: { id: eliminated.id },
        data: {
          eliminatedAt: new Date(),
          eliminationOrder: i + 1,
        },
      });

      // Broadcast elimination
      io.to(`wheel:${spinWheelId}`).emit('user_eliminated', {
        participantId: eliminated.id,
        userId: eliminated.user.id,
        username: eliminated.user.username,
        eliminationOrder: i + 1,
        remaining: eliminationOrder.length - i - 1,
      });

      logger.info(
        `Eliminated ${eliminated.user.username} (${i + 1}/${eliminationOrder.length - 1}) ` +
        `from wheel ${spinWheelId}`
      );
    }

    // Last standing = Winner
    const winner = eliminationOrder[eliminationOrder.length - 1];

    // Mark winner in DB
    await prisma.participant.update({
      where: { id: winner.id },
      data: { isWinner: true },
    });

    // Update wheel status
    await prisma.spinWheel.update({
      where: { id: spinWheelId },
      data: {
        status: 'COMPLETED',
        winnerId: winner.user.id,
        completedAt: new Date(),
      },
    });

    // Process payouts
    const payouts = await coinService.processFinalPayout(
      spinWheelId,
      winner.user.id,
      wheel.createdById
    );

    // Get updated winner data
    const updatedWinner = await prisma.user.findUnique({
      where: { id: winner.user.id },
      select: { id: true, username: true, coins: true },
    });

    // Broadcast winner
    io.to(`wheel:${spinWheelId}`).emit('wheel_completed', {
      spinWheelId,
      winner: {
        userId: winner.user.id,
        username: winner.user.username,
        newBalance: updatedWinner.coins,
      },
      payouts: {
        winnerPayout: payouts.winnerPayout,
        adminPayout: payouts.adminPayout,
        appFee: payouts.appFee,
      },
    });

    logger.info(`Wheel ${spinWheelId} completed! Winner: ${winner.user.username}`);
  } catch (error) {
    logger.error(`Elimination error for wheel ${spinWheelId}: ${error.message}`);

    // Try to abort gracefully
    try {
      await prisma.spinWheel.update({
        where: { id: spinWheelId },
        data: { status: 'ABORTED' },
      });
      io.to(`wheel:${spinWheelId}`).emit('wheel_aborted', {
        spinWheelId,
        reason: 'Internal error during elimination',
      });
    } catch (e) {
      logger.error(`Failed to abort wheel ${spinWheelId}: ${e.message}`);
    }
  }
}

module.exports = {
  generateEliminationOrder,
  startAutoStartTimer,
  clearAutoStartTimer,
  runEliminations,
};
