// utils/sendClientEmail.js
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY); // Make sure to set this in .env

async function sendClientEmail({ to, accessKey, isRenewal }) {
  try {
    await resend.emails.send({
        from: 'Zepia <no-reply@zepia.online>', // Use your verified domain
        to,
        subject: 'Zepia - Checkout Completed',
        html: `
          <div style="max-width: 600px; margin: auto; background-color: #ffffff; padding: 40px; border-radius: 10px; font-family: Arial, sans-serif; color: #333; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
  
          <div style="text-align: center;">
            <h2 style="font-size: 24px; margin-bottom: 10px;">${isRenewal ? 'Subscription Renewed' : 'Welcome to Zepia'}</h2>
          </div>

          <p style="font-size: 16px; line-height: 1.5;">
            Hi there,<br><br>
            ${isRenewal
              ? 'We’re happy to let you know that your subscription to Zepia has been successfully renewed.'
              : 'Thank you for subscribing to Zepia – your automation companion for sneaker drops!'}
          </p>

          <p style="font-size: 16px; line-height: 1.5;">
            <strong>Access key:</strong><br>
            <code style="display: inline-block; margin-top: 8px; background: #f4f4f4; padding: 10px 15px; border-radius: 6px; font-size: 18px; font-weight: bold;">${accessKey}</code>
          </p>

          <p style="font-size: 16px;">
            Thank you!
          </p>

          <p style="margin-top: 30px; font-size: 14px; color: #999;">
            — Zepia x Peenoise Notify
          </p>
        </div>
        `,
      });

    console.log('📧 Email sent to:', to);
  } catch (error) {
    console.error('❌ Failed to send email:', error);
  }
}

module.exports = { sendClientEmail };
