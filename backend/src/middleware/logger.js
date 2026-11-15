const crypto = require('crypto');
const pino = require('pino');
const pinoHttp = require('pino-http');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: [
    'req.url',
    'req.headers.authorization',
    'req.headers.cookie',
    'req.body.password',
    'req.body.newPassword',
    'req.body.refreshToken',
    'req.body.token'
  ]
});

const requestLogger = pinoHttp({
  logger,
  genReqId(req, res) {
    const requestId = crypto.randomUUID();
    res.setHeader('X-Request-Id', requestId);
    return requestId;
  },
  customProps(req) {
    return { requestId: req.id };
  }
});

module.exports = { logger, requestLogger };
