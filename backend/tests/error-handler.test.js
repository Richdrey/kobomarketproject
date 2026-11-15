const express = require('express');
const request = require('supertest');
const { AppError, errorHandler } = require('../src/middleware/errorHandler');

describe('error response contract', () => {
  test('returns the standard error shape', async () => {
    const app = express();
    app.get('/failure', (req, res, next) => {
      next(new AppError(409, 'CONFLICT', 'The request conflicts with current state'));
    });
    app.use(errorHandler);

    const response = await request(app).get('/failure');
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'CONFLICT',
        message: 'The request conflicts with current state',
        details: null
      }
    });
  });
});
