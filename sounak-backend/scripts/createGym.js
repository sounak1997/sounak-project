// scripts/createGym.js
//
// Sets up a new gym on the platform: its owner account, its plans, and
// optionally a first member ready to sign up.
//
// Find-or-create throughout, so re-running is harmless and can be used to add
// a member to a gym that already exists.
//
// Usage:
//   node scripts/createGym.js --name "Imtaj Gym Center" \
//        --owner-email owner@imtaj.gym --owner-password imtaj12345 \
//        [--gym-phone 9800112200] [--address "..."] \
//        [--member "Full Name" --member-phone 9800112233]
require('dotenv').config();
const pgPool = require('../src/config/pg.config');
const gymAuthService = require('../src/services/gymAuthService');
const gymService = require('../src/services/gymService');

const arg = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

// Sensible starting plans. The owner edits prices in their console; these only
// exist so a brand-new gym is not unusable until someone adds one.
const DEFAULT_PLANS = [
  { name: '1 Month', durationDays: 30, price: 800 },
  { name: '3 Months', durationDays: 90, price: 2100, description: 'Most popular' },
  { name: '1 Year', durationDays: 365, price: 7500, description: 'Best value' },
];

(async () => {
  const name = arg('--name');
  const ownerEmail = arg('--owner-email');
  const ownerPassword = arg('--owner-password');

  if (!name || !ownerEmail || !ownerPassword) {
    console.error('Usage: node scripts/createGym.js --name "<gym>" --owner-email <email> --owner-password <pw>');
    console.error('       [--gym-phone <n>] [--address "<a>"] [--member "<name>" --member-phone <n>]');
    process.exit(1);
  }

  const gymPhone = arg('--gym-phone');
  const address = arg('--address');
  const memberName = arg('--member');
  const memberPhone = arg('--member-phone');

  // --- owner account ---
  const existingOwner = await pgPool.query('SELECT * FROM gym_accounts WHERE email = $1', [
    ownerEmail.toLowerCase(),
  ]);
  const owner = existingOwner.rows[0]
    ? gymAuthService.publicAccount(existingOwner.rows[0])
    : await gymAuthService.createAccount({
        name: `${name} Owner`, email: ownerEmail, password: ownerPassword, phone: gymPhone,
      });
  console.log(existingOwner.rows[0] ? `- owner ${ownerEmail} already existed` : `✓ owner ${ownerEmail}`);

  // --- the gym ---
  let gym = (await pgPool.query('SELECT * FROM gyms WHERE name = $1', [name])).rows[0];
  if (gym) {
    console.log(`- gym "${name}" already existed`);
  } else {
    gym = await gymAuthService.createGym({
      name, address, phone: gymPhone, timezone: 'Asia/Kolkata', ownerAccountId: owner.id,
    });
    console.log(`✓ gym "${name}"`);
  }

  // --- plans ---
  const plans = [];
  for (const spec of DEFAULT_PLANS) {
    const found = await pgPool.query('SELECT * FROM gym_plans WHERE gym_id = $1 AND name = $2', [
      gym.id, spec.name,
    ]);
    plans.push(found.rows[0] || (await gymService.createPlan({ gymId: gym.id, ...spec })));
  }
  console.log(`✓ plans: ${plans.map((p) => p.name).join(', ')}`);

  // --- first member (optional) ---
  let member = null;
  if (memberName && memberPhone) {
    member = (await pgPool.query(
      'SELECT * FROM gym_members WHERE gym_id = $1 AND full_name = $2', [gym.id, memberName]
    )).rows[0];

    if (member) {
      console.log(`- member "${memberName}" already existed`);
    } else {
      const created = await gymService.createMember({
        gymId: gym.id, fullName: memberName, phone: memberPhone,
      });
      member = created.member;

      // Back-dated 10 days so the attendance percentage has a denominator to
      // work against, instead of reading "not started" on day one.
      const start = new Date();
      start.setDate(start.getDate() - 10);
      await gymService.createSubscription({
        gymId: gym.id,
        memberId: member.id,
        planId: plans[1].id,
        startDate: start.toISOString().slice(0, 10),
        payment: { method: 'cash' },
        recordedBy: owner.id,
      });
      console.log(`✓ member "${memberName}" with an active ${plans[1].name} membership`);
    }
  }

  const web = process.env.GYM_WEB_URL || 'https://suvidhaa-gym.sounak-project.workers.dev';

  console.log('\n' + '='.repeat(52));
  console.log(' ' + name);
  console.log('='.repeat(52));
  if (member) {
    const sub = (await pgPool.query(
      `SELECT plan_name, start_date, end_date FROM gym_subscriptions
        WHERE member_id = $1 AND status = 'active' ORDER BY end_date DESC LIMIT 1`,
      [member.id]
    )).rows[0];
    console.log('\nSIGN UP  ->  ' + web + '/signup');
    console.log('  Member code    ' + member.member_code);
    console.log('  Mobile number  ' + member.phone);
    console.log('  then pick any email + password (8+ characters)');
    if (sub) console.log(`  Membership:    ${sub.plan_name}, ${sub.start_date} -> ${sub.end_date}`);
  }
  console.log('\nDOOR QR  ->  print this URL as a QR code for the entrance');
  console.log('  ' + web + '/checkin?g=' + gym.gym_code);
  console.log('\nOWNER CONSOLE  ->  ' + web + '/login');
  console.log('  ' + ownerEmail + '  /  ' + ownerPassword);
  console.log('');

  await pgPool.pool.end();
})().catch(async (e) => {
  console.error('\nFAILED:', e.message);
  await pgPool.pool.end();
  process.exit(1);
});
