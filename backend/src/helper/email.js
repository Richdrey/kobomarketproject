const nodemailer = require('nodemailer');
const ejs = require('ejs');
const path = require('path');

const emailTemplates = {
  otp: 'otp.ejs',
  loginAlert: 'login-alert.ejs',
  verification: 'verification.ejs',
  passwordReset: 'password-reset.ejs'
};

const sendEmail = async (email, subject, templateName, templateData, text) => {
  const templateFile = emailTemplates[templateName];
  if (!templateFile) {
    throw new Error(`Unknown email template: ${templateName}`);
  }

  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    const error = new Error('Email transport is not configured');
    error.code = 'EMAIL_CONFIGURATION_MISSING';
    throw error;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT || 587),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD || process.env.EMAIL_PASS,
    }
  });

  const html = await ejs.renderFile(
    path.join(__dirname, '../templates/email', templateFile),
    templateData
  );

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject,
    text,
    html
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (cause) {
    const error = new Error('Email delivery failed');
    error.code = 'EMAIL_DELIVERY_FAILED';
    error.cause = { code: cause.code };
    throw error;
  }
};

module.exports = { sendEmail };
