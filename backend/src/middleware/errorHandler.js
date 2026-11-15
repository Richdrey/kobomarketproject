class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function notFoundHandler(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Route not found'));
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  const code = error.code || 'INTERNAL_SERVER_ERROR';

  if (statusCode >= 500) {
    if (req.log) {
      req.log.error({ errorType: error.name, errorCode: error.code || code }, 'Request failed');
    }
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message: statusCode >= 500 ? 'Internal server error' : error.message,
      details: error.details || null
    }
  });
}

module.exports = { AppError, notFoundHandler, errorHandler };
