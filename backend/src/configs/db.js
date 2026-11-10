const mongoose = require('mongoose');
require('dotenv').config();

const url = process.env.MONGO_URL;



const connectDB = async () => {
  try {
    await mongoose.connect(url);
    console.log(' connected to MongoDB successfully');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
};

connectDB();

module.exports = connectDB;
