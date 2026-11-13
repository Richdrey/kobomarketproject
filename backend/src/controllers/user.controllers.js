const User = require('../models/user.models');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendEmail } = require('../helper/email');



const signup = async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.findOne({ email });
    if (user) {
      //console.log("Matched user from DB:", user);
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

const sendOtp = async (req, res) => {
  const id = req.params.id;
  try {
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000);
    user.otp = otp;
    user.otpexpiredat = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

   await sendEmail(user.email, 'Your OTP Code', `Your OTP code is ${otp}`);

    res.status(200).json({ message: 'OTP sent successfully', otp: otp, expiresAt: user.otpexpiredat });
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }
    if (user.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }
    if (user.otpexpiredat < Date.now()) {
      return res.status(400).json({ message: 'OTP expired' });
    }
    if (user.isVerified) {
      return res.status(400).json({ message: 'Email already verified' });
    }

    user.isVerified = true;
    user.otp = null;
    user.otpexpiredat = null;
    await user.save();

    return res.status(200).json({ message: 'Email verified successfully' });
  } catch (e) {
    console.log(e);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const resendOtp = async (req, res) => {
  try {
    const { email } = req.body; 
    const id = req.params.id;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000);
    user.otp = otp;
    user.otpexpiredat = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    res.status(200).json({ message: 'OTP resent successfully', otp: otp, expiresAt: user.otpexpiredat });
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const otp = (Math.floor(100000 + Math.random() * 900000));
    user.otp = otp;
    user.otpexpiredat = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    res.status(200).json({ message: 'Password reset instructions sent to your email' });
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { otp, newPassword } = req.body;
    if (!otp || !newPassword) {
      return res.status(400).json({ message: 'OTP and new password are required' });
    }

    const user = await User.findOne({ otp });
    if (!user) {
      return res.status(400).json({ message: 'OTP expired' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.otp = null;
    user.otpexpiredat = null;
    await user.save();

    res.status(200).json({ message: 'Password reset successfully' });
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = { signup, login, sendOtp, verifyOtp, resendOtp, forgotPassword, resetPassword };