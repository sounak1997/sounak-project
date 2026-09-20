// scripts/seedGym.js
//
// Applies src/db/schema_gym.sql and gets one gym to a state where the whole
// check-in flow can actually be walked: a platform admin, an owner account, a
// gym, some plans, and members with live subscriptions.
//
// The schema is idempotent (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT
// EXISTS), so re-running this is safe and is the intended way to pick up schema
// changes as the file grows — the same approach schema.sql and
// schema_doctors_tests.sql already use.
//
// Usage:
//   node scripts/seedGym.js                       apply schema only
//   node scripts/seedGym.js --demo                apply schema + seed a demo gym
//   node scripts/seedGym.js --platform-admin <email> <password> [name]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pgPool = require('../src/config/pg.config');
const gymAuthService = require('../src/services/gymAuthService');
const gymService = require('../src/services/gymService');

const applySchema = async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/schema_gym.sql'), 'utf8');
  await pgPool.query(sql);
  console.log('✓ schema_gym.sql applied');
};

const seedPlatformAdmin = async (email, password, name) => {
  const existing = await pgPool.query('SELECT id, platform_admin FROM gym_accounts WHERE email = $1', [
    String(email).toLowerCase(),
  ]);
  if (existing.rows[0]) {
    if (!existing.rows[0].platform_admin) {
      await pgPool.query('UPDATE gym_accounts SET platform_admin = true WHERE id = $1', [
        existing.rows[0].id,
      ]);
      console.log(`✓ promoted ${email} to platform admin`);
    } else {
      console.log(`- ${email} is already a platform admin`);
    }
    return existing.rows[0].id;
  }
  const account = await gymAuthService.createAccount({
    name: name || 'Platform Admin',
    email,
    password,
    platformAdmin: true,
  });
  console.log(`✓ created platform admin ${email}`);
  return account.id;
};

// A gym that exercises every branch of the check-in screen: a member in good
// standing, one expiring this week, one already lapsed, and one who was
// registered but never started. Without all four, the owner's worklist and the
// scan outcomes cannot be seen working.
const seedDemo = async () => {
  const ownerEmail = 'owner@demogym.test';
  let owner;
  try {
    owner = await gymAuthService.createAccount({
      name: 'Demo Gym Owner',
      email: ownerEmail,
      password: 'demo12345',
      phone: '9800000000',
    });
    console.log(`✓ owner account ${ownerEmail} / demo12345`);
  } catch (err) {
    const existing = await pgPool.query('SELECT * FROM gym_accounts WHERE email = $1', [ownerEmail]);
    owner = gymAuthService.publicAccount(existing.rows[0]);
    console.log(`- owner account ${ownerEmail} already exists`);
  }

  // Find-or-create throughout, rather than bailing out when the gym exists.
  // A seed that stops at the first thing already present is useless for picking
  // up a schema change or finishing a run that failed halfway.
  const existingGym = await pgPool.query('SELECT * FROM gyms WHERE name = $1', ['Iron House Gym']);
  let gym = existingGym.rows[0];
  if (gym) {
    console.log(`- gym "${gym.name}" already exists (code ${gym.gym_code})`);
  } else {
    gym = await gymAuthService.createGym({
      name: 'Iron House Gym',
      address: '12 Station Road, Kolkata',
      phone: '9800000001',
      timezone: 'Asia/Kolkata',
      ownerAccountId: owner.id,
    });
    console.log(`✓ gym "${gym.name}" (code ${gym.gym_code})`);
  }

  const findOrCreatePlan = async (spec) => {
    const found = await pgPool.query('SELECT * FROM gym_plans WHERE gym_id = $1 AND name = $2', [
      gym.id,
      spec.name,
    ]);
    if (found.rows[0]) return found.rows[0];
    return gymService.createPlan({ gymId: gym.id, ...spec });
  };

  const monthly = await findOrCreatePlan({ name: '1 Month', durationDays: 30, price: 1000 });
  const quarterly = await findOrCreatePlan({
    name: '3 Months',
    durationDays: 90,
    price: 2700,
    description: 'Best value',
  });
  console.log('✓ plans: 1 Month, 3 Months');

  const people = [
    { fullName: 'Arjun Das', phone: '9876543210', plan: quarterly, startOffset: -20 },
    { fullName: 'Priya Sen', phone: '9876500011', plan: monthly, startOffset: -27 },
    { fullName: 'Rahul Ghosh', phone: '9876500022', plan: monthly, startOffset: -45 },
    { fullName: 'Meera Roy', phone: '9876500033', plan: null, startOffset: null },
  ];

  for (const person of people) {
    const found = await pgPool.query(
      'SELECT * FROM gym_members WHERE gym_id = $1 AND full_name = $2',
      [gym.id, person.fullName]
    );
    if (found.rows[0]) {
      console.log(`- member ${person.fullName} already exists`);
      continue;
    }

    const { member } = await gymService.createMember({
      gymId: gym.id,
      fullName: person.fullName,
      phone: person.phone,
    });

    if (!person.plan) {
      console.log(`✓ member ${person.fullName} (no subscription — "never started")`);
      continue;
    }

    // Back-dated start so the seeded data lands in the buckets the owner's
    // worklist is meant to surface.
    const start = new Date();
    start.setDate(start.getDate() + person.startOffset);
    const startDate = start.toISOString().slice(0, 10);

    const { subscription } = await gymService.createSubscription({
      gymId: gym.id,
      memberId: member.id,
      planId: person.plan.id,
      startDate,
      payment: { method: 'cash' },
      recordedBy: owner.id,
    });
    console.log(
      `✓ member ${person.fullName} — ${subscription.plan_name}, ends ${subscription.end_date}`
    );
  }

  return { gym, owner };
};

const main = async () => {
  const args = process.argv.slice(2);

  await applySchema();

  const adminIdx = args.indexOf('--platform-admin');
  if (adminIdx !== -1) {
    const [email, password, name] = args.slice(adminIdx + 1);
    if (!email || !password) {
      console.error('Usage: node scripts/seedGym.js --platform-admin <email> <password> [name]');
      process.exitCode = 1;
      return;
    }
    await seedPlatformAdmin(email, password, name);
  }

  if (args.includes('--demo')) {
    const { gym } = await seedDemo();
    const base = process.env.GYM_WEB_URL || 'http://localhost:4300';
    console.log('\n--- door poster ---');
    console.log(`Print a QR of this URL and stick it by the entrance:\n  ${base}/checkin?g=${gym.gym_code}`);
    console.log('\nSign in to the owner console with owner@demogym.test / demo12345');
  }
};

main()
  .then(() => pgPool.pool.end())
  .catch(async (err) => {
    console.error('\nFAILED:', err.message);
    await pgPool.pool.end();
    process.exit(1);
  });
