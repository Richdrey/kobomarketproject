const express = require('express');
const { connect } = require('mongoose');
const connectDB = require('./src/configs/db');

const morgan = require('morgan');

const userRoutes = require('./src/routes/user.routes');  
require('dotenv').config();
const app = express();

const port = process.env.PORT || 3020;

app.use(express.json());
app.use(morgan('dev'));

connectDB();

app.get('/', (req, res) => {
  res.send('Hello, World!');
});

app.use('/api/v1/user', userRoutes);



app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});