const { AppError } = require('./errorHandler');

function validate(schema, property = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
      convert: true
    });

    if (error) {
      return next(new AppError(
        400,
        'VALIDATION_ERROR',
        'Request validation failed',
        error.details.map(({ path, message }) => ({ path, message }))
      ));
    }

    req[property] = value;
    return next();
  };
}

module.exports = validate;
