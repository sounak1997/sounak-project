// src/controllers/userController.js

const mongoose = require('mongoose');
const User = require('../models/User'); // Correctly import your existing model

const getUsers = async (req, res) => {
  try {
    const users = await User.find({}, { name: 1, email: 1 });
    res.status(200).json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

const createUser = async (req, res) => {
  try {
    const newUser = await User.create(req.body);
    res.status(201).json({ message: 'User created successfully', user: newUser });
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

const getProfile = async (req, res) => {
  try {
    // Assuming you can get the user's ID from the request (e.g., from a JWT token)
    const userId = req.user._id; 
    const profile = await User.findById(userId, { name: 1, email: 1 });

    if (profile) {
      res.status(200).json(profile);
    } else {
      res.status(404).json({ message: 'User profile not found' });
    }
  } catch (err) {
    console.error('Error fetching user profile:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

const getProfileDesc = async (req, res) => {
  try {
    // Assuming you can get the user's ID from the request (e.g., from a JWT token)
    //const userId = req.user._id; 
    //const profile = await User.findById(userId, { name: 1, email: 1 });
    const profile = {id:1, name: 'sounak'}

    if (profile) {
      res.status(200).json(profile);
    } else {
      res.status(404).json({ message: 'User profile not found' });
    }
  } catch (err) {
    console.error('Error fetching user profile:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

module.exports = {
  getUsers,
  createUser,
  getProfile,
  getProfileDesc
};