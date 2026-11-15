const Joi = require('joi');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');

const profileSchema = Joi.object({
  firstName: Joi.string().trim().min(1).max(100),
  lastName: Joi.string().trim().min(1).max(100)
}).min(1).unknown(false);

const getMe = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      user: {
        id: String(req.user._id),
        firstName: req.user.firstName,
        lastName: req.user.lastName,
        email: req.user.email,
        roles: req.user.roles,
        isVerified: req.user.isVerified,
        accountStatus: req.user.accountStatus
      }
    }
  });
});

const updateMe = asyncHandler(async (req, res) => {
  if (req.body.firstName !== undefined) req.user.firstName = req.body.firstName;
  if (req.body.lastName !== undefined) req.user.lastName = req.body.lastName;
  await req.user.save();
  res.json({
    success: true,
    data: {
      user: {
        id: String(req.user._id),
        firstName: req.user.firstName,
        lastName: req.user.lastName,
        email: req.user.email,
        roles: req.user.roles
      }
    }
  });
});

module.exports = {
  getMe,
  updateMe,
  validateProfileUpdate: validate(profileSchema)
};
