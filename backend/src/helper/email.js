const nodemailer = require('nodemailer');
const ejs = require('ejs');
const path = require('path');

const emailTemplates = {
  otp: 'otp.ejs',
  loginAlert: 'login-alert.ejs'
};

const sendEmail = async (email, subject, templateName, templateData, text) => {
  const templateFile = emailTemplates[templateName];
  if (!templateFile) {
    throw new Error(`Unknown email template: ${templateName}`);
  }

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
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

  await transporter.sendMail(mailOptions);
};

module.exports = { sendEmail };
