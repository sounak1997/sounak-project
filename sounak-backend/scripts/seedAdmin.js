// scripts/seedAdmin.js
//
// FR-1.2: "Admin accounts are provisioned manually/seeded rather than
// self-registered." There's no admin UI for this (deliberately — the whole
// point is that it isn't reachable over the API), so this script is the
// provisioning path: create a new admin, or promote an existing account.
//
// Usage:
//   node scripts/seedAdmin.js <email> <password> [name]
//   node scripts/seedAdmin.js existing@user.com        (promotes; password/name ignored)
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');

async function main() {
  const [, , email, password, name] = process.argv;

  if (!email) {
    console.error('Usage: node scripts/seedAdmin.js <email> [password] [name]');
    console.error('  If <email> already exists, it is promoted to admin (password/name ignored).');
    console.error('  Otherwise a new admin account is created with the given password/name.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  try {
    let user = await User.findOne({ email });
    if (user) {
      if (user.role === 'admin') {
        console.log(`${email} is already an admin. Nothing to do.`);
      } else {
        user.role = 'admin';
        await user.save();
        console.log(`Promoted existing user ${email} to admin.`);
      }
    } else {
      if (!password) {
        console.error(`No user with email ${email} exists yet — a password is required to create one.`);
        process.exitCode = 1;
        return;
      }
      user = await User.create({ name: name || 'Admin', email, password, role: 'admin' });
      console.log(`Created new admin account: ${email}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
