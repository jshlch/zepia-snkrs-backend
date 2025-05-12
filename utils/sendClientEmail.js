// utils/sendClientEmail.js
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY); // Make sure to set this in .env

async function sendClientEmail({ to, accessKey, isRenewal }) {
  try {
    await resend.emails.send({
      from: 'Zepia - Snkrs Tool <no-reply@zepia.online>', // Use verified sender or resend.dev for testing
      to,
      subject: isRenewal ? '🔁 Subscription Renewed' : '🎉 Welcome to Our Service',
      text: `Hi,

        Your access key is: ${accessKey}

        Thank you for your trust.

        — Zepia`,
    });

    console.log('📧 Email sent to:', to);
    console.log('🔑 Access key:', accessKey);
  } catch (error) {
    console.error('❌ Failed to send email:', error);
  }
}

module.exports = { sendClientEmail };
