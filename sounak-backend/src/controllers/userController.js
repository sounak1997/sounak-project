// src/controllers/userController.js
const getUsers = (req, res) => {
  res.status(200).json([
    { id: 1, name: 'John Doe', email: 'john@example.com' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
    { id: 1, name: 'John Doe', email: 'john@example.com' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
  ]);
};

const createUser = (req, res) => {
  const newUser = req.body;
  console.log('Received new user:', newUser);
  res.status(201).json({ message: 'User created successfully', user: newUser });
};

module.exports = {
  getUsers,
  createUser
};