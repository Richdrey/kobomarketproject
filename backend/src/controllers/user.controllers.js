const User = require('../models/user.models');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');



const signup = async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const newUser = await User.create({ firstName, lastName, email, password: hashedPassword });
    res.status(201).json({ message: 'User created successfully', user: newUser });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Invalid password' });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.status(200).json({ message: 'Login successful', user, token: token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Internal server error' });
  }
};


module.exports = { signup, login };