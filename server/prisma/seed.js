const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create admin user
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@roxstar.com' },
    update: {},
    create: {
      username: 'admin',
      email: 'admin@roxstar.com',
      passwordHash: adminPassword,
      coins: 10000,
      role: 'ADMIN',
    },
  });
  console.log(`✅ Admin user created: ${admin.username} (${admin.email})`);

  // Create test users
  const userPassword = await bcrypt.hash('user123', 10);
  const testUsers = [
    { username: 'alice', email: 'alice@test.com' },
    { username: 'bob', email: 'bob@test.com' },
    { username: 'charlie', email: 'charlie@test.com' },
    { username: 'diana', email: 'diana@test.com' },
  ];

  for (const userData of testUsers) {
    const user = await prisma.user.upsert({
      where: { email: userData.email },
      update: {},
      create: {
        ...userData,
        passwordHash: userPassword,
        coins: 1000,
        role: 'USER',
      },
    });
    console.log(`✅ Test user created: ${user.username} (${user.email})`);
  }

  // Seed game configuration
  const configs = [
    { key: 'DEFAULT_WINNER_POOL_PCT', value: '70', description: 'Default winner pool percentage' },
    { key: 'DEFAULT_ADMIN_POOL_PCT', value: '20', description: 'Default admin/owner pool percentage' },
    { key: 'DEFAULT_APP_POOL_PCT', value: '10', description: 'Default app pool percentage' },
    { key: 'DEFAULT_ENTRY_FEE', value: '100', description: 'Default entry fee in coins' },
    { key: 'MIN_PARTICIPANTS', value: '3', description: 'Minimum participants to start a game' },
    { key: 'ELIMINATION_INTERVAL', value: '7', description: 'Seconds between eliminations' },
    { key: 'AUTO_START_DELAY', value: '180', description: 'Seconds before auto-start (3 minutes)' },
  ];

  for (const config of configs) {
    await prisma.gameConfig.upsert({
      where: { key: config.key },
      update: { value: config.value, description: config.description },
      create: config,
    });
    console.log(`✅ Config: ${config.key} = ${config.value}`);
  }

  console.log('\n🎉 Seeding complete!');
  console.log('\n📋 Test Credentials:');
  console.log('   Admin: admin@roxstar.com / admin123');
  console.log('   Users: alice@test.com, bob@test.com, charlie@test.com, diana@test.com / user123');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
