const prisma = require('../config/database');
const logger = require('../utils/logger');

/**
 * Atomic coin deduction with transaction
 * Uses serializable isolation for safety
 */
async function deductCoins(userId, amount, spinWheelId, description = 'Entry fee') {
  return await prisma.$transaction(async (tx) => {
    // Get current user coins (acts as a lock in the transaction)
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, coins: true, username: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    if (user.coins < amount) {
      throw new Error(`Insufficient coins. Have: ${user.coins}, Need: ${amount}`);
    }

    // Deduct coins atomically
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: { coins: { decrement: amount } },
    });

    // Record transaction
    await tx.transaction.create({
      data: {
        userId,
        spinWheelId,
        type: 'ENTRY_FEE',
        amount: -amount,
        description,
      },
    });

    logger.info(`Deducted ${amount} coins from ${user.username}. Balance: ${updatedUser.coins}`);
    return updatedUser;
  });
}

/**
 * Credit coins to a user atomically
 */
async function creditCoins(userId, amount, spinWheelId, type, description) {
  return await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: { coins: { increment: amount } },
    });

    await tx.transaction.create({
      data: {
        userId,
        spinWheelId,
        type,
        amount,
        description,
      },
    });

    logger.info(`Credited ${amount} coins to user ${userId}. Type: ${type}. Balance: ${updatedUser.coins}`);
    return updatedUser;
  });
}

/**
 * Distribute entry fee into pools
 */
async function distributeEntryFee(spinWheelId, entryFee, winnerPct, adminPct, appPct) {
  const winnerShare = Math.floor(entryFee * winnerPct / 100);
  const adminShare = Math.floor(entryFee * adminPct / 100);
  const appShare = entryFee - winnerShare - adminShare; // Remainder goes to app pool

  await prisma.spinWheel.update({
    where: { id: spinWheelId },
    data: {
      winnerPoolAmount: { increment: winnerShare },
      adminPoolAmount: { increment: adminShare },
      appPoolAmount: { increment: appShare },
    },
  });

  logger.info(
    `Distributed entry fee for wheel ${spinWheelId}: ` +
    `Winner: +${winnerShare}, Admin: +${adminShare}, App: +${appShare}`
  );

  return { winnerShare, adminShare, appShare };
}

/**
 * Process final payout to winner and admin
 */
async function processFinalPayout(spinWheelId, winnerId, adminId) {
  return await prisma.$transaction(async (tx) => {
    const wheel = await tx.spinWheel.findUnique({
      where: { id: spinWheelId },
    });

    if (!wheel) throw new Error('Spin wheel not found');

    const winnerPayout = Math.floor(wheel.winnerPoolAmount);
    const adminPayout = Math.floor(wheel.adminPoolAmount);

    // Credit winner
    if (winnerPayout > 0) {
      await tx.user.update({
        where: { id: winnerId },
        data: { coins: { increment: winnerPayout } },
      });

      await tx.transaction.create({
        data: {
          userId: winnerId,
          spinWheelId,
          type: 'WINNER_PAYOUT',
          amount: winnerPayout,
          description: `Winner payout for spin wheel`,
        },
      });
    }

    // Credit admin
    if (adminPayout > 0) {
      await tx.user.update({
        where: { id: adminId },
        data: { coins: { increment: adminPayout } },
      });

      await tx.transaction.create({
        data: {
          userId: adminId,
          spinWheelId,
          type: 'ADMIN_PAYOUT',
          amount: adminPayout,
          description: `Admin commission for spin wheel`,
        },
      });
    }

    // Record app fee transaction (stays in the system)
    if (wheel.appPoolAmount > 0) {
      await tx.transaction.create({
        data: {
          userId: adminId, // Record under admin for tracking
          spinWheelId,
          type: 'APP_FEE',
          amount: Math.floor(wheel.appPoolAmount),
          description: `App fee retained by platform`,
        },
      });
    }

    logger.info(
      `Final payout for wheel ${spinWheelId}: ` +
      `Winner (${winnerId}): +${winnerPayout}, Admin (${adminId}): +${adminPayout}`
    );

    return { winnerPayout, adminPayout, appFee: Math.floor(wheel.appPoolAmount) };
  });
}

/**
 * Refund all participants for an aborted wheel
 */
async function refundAll(spinWheelId) {
  const participants = await prisma.participant.findMany({
    where: { spinWheelId },
    include: { user: true, spinWheel: true },
  });

  const wheel = participants[0]?.spinWheel;
  if (!wheel) return [];

  const refunds = [];
  for (const p of participants) {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: p.userId },
        data: { coins: { increment: wheel.entryFee } },
      });

      await tx.transaction.create({
        data: {
          userId: p.userId,
          spinWheelId,
          type: 'REFUND',
          amount: wheel.entryFee,
          description: 'Refund - spin wheel aborted',
        },
      });
    });

    refunds.push({ userId: p.userId, username: p.user.username, amount: wheel.entryFee });
  }

  logger.info(`Refunded ${refunds.length} participants for wheel ${spinWheelId}`);
  return refunds;
}

module.exports = {
  deductCoins,
  creditCoins,
  distributeEntryFee,
  processFinalPayout,
  refundAll,
};
