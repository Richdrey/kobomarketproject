const asyncHandler = require('../middleware/asyncHandler');
const authService = require('../services/auth.service');

const register = asyncHandler(async (req, res) => {
  const user = await authService.register(req.body);
  res.status(201).json({ success: true, data: { user, message: 'Verification email sent' } });
});

const resendVerification = asyncHandler(async (req, res) => {
  await authService.resendVerification(req.body.email);
  res.status(200).json({ success: true, data: { message: 'If the account needs verification, instructions were sent' } });
});

const verifyEmail = asyncHandler(async (req, res) => {
  await authService.verifyEmail(req.body.token || req.query.token);
  res.status(200).json({ success: true, data: { message: 'Email verified successfully' } });
});

const login = asyncHandler(async (req, res) => {
  const data = await authService.login(req.body);
  res.status(200).json({ success: true, data });
});

const refresh = asyncHandler(async (req, res) => {
  const data = await authService.refresh(req.body.refreshToken);
  res.status(200).json({ success: true, data });
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.body.refreshToken);
  res.status(200).json({ success: true, data: { message: 'Logged out successfully' } });
});

const forgotPassword = asyncHandler(async (req, res) => {
  await authService.requestPasswordReset(req.body.email);
  res.status(200).json({ success: true, data: { message: 'If the account exists, reset instructions were sent' } });
});

const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body);
  res.status(200).json({ success: true, data: { message: 'Password reset successfully' } });
});

module.exports = { register, resendVerification, verifyEmail, login, refresh, logout, forgotPassword, resetPassword };
