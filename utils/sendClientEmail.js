// utils/sendClientEmail.js
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY); // Make sure to set this in .env

async function sendClientEmail({ to, accessKey, isRenewal }) {
  try {
    await resend.emails.send({
        from: 'Zepia <no-reply@zepia.online>', // Use your verified domain
        to,
        subject: isRenewal ? '🔁 Your Zepia Subscription Has Been Renewed' : '🎉 Welcome to Zepia!',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee;">
            <p style="font-size: 16px; color: #555;">Hi there,</p>
  
            <p style="font-size: 16px; color: #555;">
              ${isRenewal 
                ? "We're happy to let you know that your Zepia Snkrs Automation Tool access key has been successfully renewed." 
                : "Thank you for subscribing to Zepia – your automation companion for sneaker drops!"}
            </p>
  
            <p style="font-size: 16px; color: #000; font-weight: bold;">
              Your Access Key: <code style="background: #f4f4f4; padding: 4px 8px; border-radius: 4px;">${accessKey}</code>
            </p>
  
            <p style="font-size: 16px; color: #555;">Keep this key safe – it's your access to our automation tools.</p>
  
            <p style="font-size: 14px; color: #777;">Thanks for trusting Zepia.<br>– The Zepia Team</p>
          </div>
        `,
      });

    console.log('📧 Email sent to:', to);
    console.log('🔑 Access key:', accessKey);
  } catch (error) {
    console.error('❌ Failed to send email:', error);
  }
}

module.exports = { sendClientEmail };
