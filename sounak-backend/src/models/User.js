// my-angular-backend/src/models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const addressSchema = mongoose.Schema(
  {
    label: { type: String, default: 'Home' },
    line1: { type: String, required: true },
    line2: { type: String },
    city: { type: String, required: true },
    state: { type: String },
    postalCode: { type: String },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true }
);

const userSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    // FR-1.3: role encoded in the JWT and checked on every protected route.
    // Admin accounts are seeded/created by an existing admin (FR-1.2) — never
    // self-registered — so nothing in the public register flow should ever
    // be able to set this to 'admin'. See authController.registerUser.
    role: {
      type: String,
      enum: ['admin', 'customer'],
      default: 'customer',
    },
    phone: {
      type: String,
    },
    addresses: {
      type: [addressSchema],
      default: [],
    },
    // FR-1.4: password reset. The token stored here is a hash of the one
    // emailed/texted to the user, so a leaked DB dump alone can't be used to
    // reset an account (same reasoning as hashing the password itself).
    resetPasswordTokenHash: {
      type: String,
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt fields
  }
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to compare entered password with hashed password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);

module.exports = User;
