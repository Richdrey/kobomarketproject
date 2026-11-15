const User = require('../models/user.models');

async function findByEmail(email) {
  return User.findOne({ email: email.toLowerCase() });
}

async function create(userData) {
  return User.create(userData);
}

async function findById(id) {
  return User.findById(id);
}

module.exports = { findByEmail, create, findById };
