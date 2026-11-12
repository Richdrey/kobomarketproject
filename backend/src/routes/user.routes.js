const express = require("express");
const router = express.Router();
const { signup , login , sendOtp, verifyOtp, resendOtp, forgotPassword, resetPassword } = require("../controllers/user.controllers");

router.post("/signup", signup); 
router.post("/login", login); 
router.post("/send-otp/:id", sendOtp);
router.post("/verify-otp/:id", verifyOtp);
router.post("/resend-otp/:id", resendOtp);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
module.exports = router;