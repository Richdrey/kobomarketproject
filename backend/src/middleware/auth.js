const jwt = require('jsonwebtoken');
const User = require('../models/user.models');
const { AppError } = require('./errorHandler');
const asyncHandler = require('./asyncHandler');

const accessSecret = () => process.env.JWT_ACCESS_SECRET;

const authenticate = asyncHandler(async (req, res, next) => {
  const authorization = req.get('authorization');
  const [scheme, token] = authorization ? authorization.split(' ') : [];
  if (scheme !== 'Bearer' || !token) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'A valid access token is required');
  }

  let claims;
  try {
    claims = jwt.verify(token, accessSecret(), {
      issuer: 'kobomarket',
      audience: 'kobomarket-api'
    });
  } catch {
    throw new AppError(401, 'INVALID_ACCESS_TOKEN', 'The access token is invalid or expired');
  }

  const user = await User.findById(claims.sub).select('_id firstName lastName email roles accountStatus isVerified');
  if (!user || user.accountStatus !== 'active') {
    throw new AppError(401, 'ACCOUNT_UNAVAILABLE', 'The account is unavailable');
  }
  req.user = user;
  return next();
});

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.some((role) => req.user.roles.includes(role))) {
      return next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource'));
    }
    return next();
  };
}

module.exports = { authenticate, requireRoles };
