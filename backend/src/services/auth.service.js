const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user.models');
const RefreshSession = require('../models/refresh-session.models');
const userRepository = require('../repositories/user.repository');
const { provisionUserWallets } = require('./wallet.service');
const { sendEmail } = require('../helper/email');
const { logger } = require('../middleware/logger');
const { AppError } = require('../middleware/errorHandler');

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
const TOKEN_ISSUER = 'kobomarket';
const TOKEN_AUDIENCE = 'kobomarket-api';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function accessSecret() {
  if (!process.env.JWT_ACCESS_SECRET) {
    throw new Error('JWT_ACCESS_SECRET is required');
  }
  return process.env.JWT_ACCESS_SECRET;
}

function refreshSecret() {
  if (!process.env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_REFRESH_SECRET is required');
  }
  return process.env.JWT_REFRESH_SECRET;
}

function accessTokenFor(user) {
  return jwt.sign(
    { roles: user.roles },
    accessSecret(),
    {
      subject: String(user._id),
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      expiresIn: ACCESS_TTL_SECONDS
    }
  );
}

async function issueRefreshToken(userId) {
  const jti = crypto.randomUUID();
  const refreshToken = jwt.sign(
    {},
    refreshSecret(),
    {
      subject: String(userId),
      jwtid: jti,
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      expiresIn: REFRESH_TTL_SECONDS
    }
  );
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

  await RefreshSession.create({
    userId,
    jti,
    tokenHash: hashToken(refreshToken),
    expiresAt,
    purgeAt: new Date(expiresAt.getTime() + REFRESH_TTL_SECONDS * 1000)
  });

  return refreshToken;
}

async function issueTokenPair(user) {
  return {
    accessToken: accessTokenFor(user),
    refreshToken: await issueRefreshToken(user._id),
    tokenType: 'Bearer',
    expiresIn: ACCESS_TTL_SECONDS
  };
}

async function sendVerificationEmail(user, verificationToken) {
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3020';
  const verificationUrl = `${baseUrl}/api/v1/auth/verify-email?token=${encodeURIComponent(verificationToken)}`;
  await sendEmail(
    user.email,
    'Verify your KoboMarket email',
    'verification',
    { firstName: user.firstName, verificationUrl, expirationMinutes: 30 },
    'Use the verification link in this email to verify your KoboMarket account. The link expires in 30 minutes.'
  );
}

async function register({ firstName, lastName, email, password }) {
  const normalizedEmail = email.toLowerCase();
  let user = await userRepository.findByEmail(normalizedEmail);
  if (user?.isVerified) {
    throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists');
  }

  const verificationToken = randomToken();
  if (user) {
    user.emailVerificationTokenHash = hashToken(verificationToken);
    user.emailVerificationExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();
  } else {
    user = await userRepository.create({
      firstName,
      lastName,
      email: normalizedEmail,
      password: await bcrypt.hash(password, 12),
      emailVerificationTokenHash: hashToken(verificationToken),
      emailVerificationExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      walletProvisioningStatus: 'pending'
    });
  }

  try {
    await sendVerificationEmail(user, verificationToken);
  } catch (error) {
    logger.error({ errorCode: error.code || 'EMAIL_DELIVERY_FAILED', userId: String(user._id) }, 'Verification email delivery failed');
    throw new AppError(503, 'EMAIL_UNAVAILABLE', 'The account was created but verification email delivery failed. Retry registration to resend it.');
  }

  let walletProvisioningStatus = user.walletProvisioningStatus;
  try {
    await provisionUserWallets(user._id);
    walletProvisioningStatus = 'provisioned';
  } catch (error) {
    logger.error({ errorCode: error.code || 'WALLET_PROVISIONING_FAILED', userId: String(user._id) }, 'Initial wallet provisioning failed');
  }

  return {
    id: String(user._id),
    email: user.email,
    walletProvisioningStatus
  };
}

async function resendVerification(email) {
  const user = await userRepository.findByEmail(email.toLowerCase());
  if (!user || user.isVerified) {
    return;
  }
  const token = randomToken();
  user.emailVerificationTokenHash = hashToken(token);
  user.emailVerificationExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await user.save();
  await sendVerificationEmail(user, token);
}

async function verifyEmail(token) {
  const tokenHash = hashToken(token);
  const user = await User.findOne({
    emailVerificationTokenHash: tokenHash,
    emailVerificationExpiresAt: { $gt: new Date() }
  });
  if (!user) {
    throw new AppError(400, 'INVALID_OR_EXPIRED_VERIFICATION_TOKEN', 'The verification token is invalid or expired');
  }

  user.isVerified = true;
  user.emailVerificationTokenHash = null;
  user.emailVerificationExpiresAt = null;
  await user.save();
}

async function login({ email, password }) {
  const user = await userRepository.findByEmail(email.toLowerCase());
  const passwordMatches = user ? await bcrypt.compare(password, user.password) : false;
  if (!user || !passwordMatches) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  if (!user.isVerified) {
    throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before logging in');
  }
  if (user.accountStatus !== 'active') {
    throw new AppError(403, 'ACCOUNT_FROZEN', 'This account is frozen');
  }

  const tokens = await issueTokenPair(user);
  sendEmail(
    user.email,
    'New login to your KoboMarket account',
    'loginAlert',
    { firstName: user.firstName, loginTime: new Date().toUTCString() },
    'A new sign-in to your KoboMarket account occurred. If this was not you, reset your password.'
  ).catch((error) => logger.error({ errorCode: error.code || 'EMAIL_DELIVERY_FAILED', userId: String(user._id) }, 'Login alert delivery failed'));

  return {
    user: {
      id: String(user._id),
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      roles: user.roles
    },
    ...tokens
  };
}

function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, refreshSecret(), {
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE
    });
  } catch {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'The refresh token is invalid or expired');
  }
}

async function refresh(token) {
  const claims = verifyRefreshToken(token);
  const tokenHash = hashToken(token);
  const session = await RefreshSession.findOne({ userId: claims.sub, jti: claims.jti });

  if (!session || session.tokenHash !== tokenHash || session.revokedAt || session.expiresAt <= new Date()) {
    await RefreshSession.updateMany({ userId: claims.sub, revokedAt: null }, { $set: { revokedAt: new Date() } });
    throw new AppError(401, 'REFRESH_TOKEN_REUSE', 'Refresh token reuse detected; all sessions were revoked');
  }

  const replacementJti = crypto.randomUUID();
  const revoked = await RefreshSession.updateOne(
    { _id: session._id, tokenHash, revokedAt: null },
    { $set: { revokedAt: new Date(), replacedBy: replacementJti } }
  );
  if (revoked.modifiedCount !== 1) {
    await RefreshSession.updateMany({ userId: claims.sub, revokedAt: null }, { $set: { revokedAt: new Date() } });
    throw new AppError(401, 'REFRESH_TOKEN_REUSE', 'Refresh token reuse detected; all sessions were revoked');
  }

  const user = await userRepository.findById(claims.sub);
  if (!user || user.accountStatus !== 'active' || !user.isVerified) {
    await RefreshSession.updateMany({ userId: claims.sub, revokedAt: null }, { $set: { revokedAt: new Date() } });
    throw new AppError(401, 'ACCOUNT_UNAVAILABLE', 'The account is unavailable');
  }

  const jti = replacementJti;
  const replacement = jwt.sign(
    {},
    refreshSecret(),
    {
      subject: String(user._id),
      jwtid: jti,
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      expiresIn: REFRESH_TTL_SECONDS
    }
  );
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
  await RefreshSession.create({
    userId: user._id,
    jti,
    tokenHash: hashToken(replacement),
    expiresAt,
    purgeAt: new Date(expiresAt.getTime() + REFRESH_TTL_SECONDS * 1000)
  });

  return {
    accessToken: accessTokenFor(user),
    refreshToken: replacement,
    tokenType: 'Bearer',
    expiresIn: ACCESS_TTL_SECONDS
  };
}

async function logout(token) {
  const claims = verifyRefreshToken(token);
  const session = await RefreshSession.findOne({ userId: claims.sub, jti: claims.jti });
  if (!session || session.tokenHash !== hashToken(token)) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'The refresh token is invalid');
  }
  await RefreshSession.updateOne({ _id: session._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

async function requestPasswordReset(email) {
  const user = await userRepository.findByEmail(email.toLowerCase());
  if (!user) {
    return;
  }
  const token = randomToken();
  user.passwordResetTokenHash = hashToken(token);
  user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await user.save();

  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3020';
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  await sendEmail(
    user.email,
    'Reset your KoboMarket password',
    'passwordReset',
    { firstName: user.firstName, resetUrl, expirationMinutes: 30 },
    'Use the password reset link in this email. It expires in 30 minutes.'
  );
}

async function resetPassword({ token, newPassword }) {
  const user = await User.findOne({
    passwordResetTokenHash: hashToken(token),
    passwordResetExpiresAt: { $gt: new Date() }
  });
  if (!user) {
    throw new AppError(400, 'INVALID_OR_EXPIRED_RESET_TOKEN', 'The password reset token is invalid or expired');
  }

  user.password = await bcrypt.hash(newPassword, 12);
  user.passwordResetTokenHash = null;
  user.passwordResetExpiresAt = null;
  await user.save();
  await RefreshSession.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

module.exports = {
  register,
  resendVerification,
  verifyEmail,
  login,
  refresh,
  logout,
  requestPasswordReset,
  resetPassword
};
