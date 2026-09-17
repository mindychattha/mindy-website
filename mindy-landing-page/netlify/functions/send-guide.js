// Triggered by Netlify's "Outgoing Webhook" form notification (free tier).
// On each guide-request submission, this sends two emails via Mailgun:
//   1. The requested guide (as a download link) to the person who signed up
//   2. A notification to Mindy so she knows a new lead came in
//
// Required environment variables (set in Netlify: Project configuration ->
// Environment variables):
//   MAILGUN_API_KEY   - your Mailgun private API key
//   MAILGUN_DOMAIN     - your verified Mailgun sending domain (e.g. mg.mindychattha.com)
//   NOTIFY_EMAIL       - where lead notifications go (e.g. mindy@mindychattha.ca)
//   REPLY_TO_EMAIL     - address guide recipients should reply to (e.g. mindy@mindychattha.ca)
//   SITE_URL           - your live site's base URL (e.g. https://mindychattha.com)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: 'Invalid payload' };
  }

  const data = body.data || {};
  const formName = body.form_name || data['form-name'] || '';
  const email = body.email || data.email || data.Email;
  const name = body.name || data.name || data.Name || 'there';

  if (!email) {
    return { statusCode: 400, body: 'Missing email in submission' };
  }

  const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
  const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
  const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'mindy@mindychattha.ca';
  const REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL || NOTIFY_EMAIL;
  const SITE_URL = (process.env.SITE_URL || 'https://mindychattha.com').replace(/\/$/, '');

  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
    console.error('Missing MAILGUN_API_KEY or MAILGUN_DOMAIN environment variables');
    return { statusCode: 500, body: 'Email service not configured' };
  }

  const isSeller = formName === 'seller-guide-request';
  const guideLabel = isSeller ? "Seller's Guide" : "Buyer's Guide";
  const guideFile = isSeller
    ? 'Mindy-Chattha-Sellers-Guide.pdf'
    : 'Mindy-Chattha-Buyers-Guide.pdf';
  const guideUrl = `${SITE_URL}/guides/${guideFile}`;

  const auth = 'Basic ' + Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64');
  const mailgunUrl = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`;

  async function sendMail({ to, subject, text, html, replyTo }) {
    const params = new URLSearchParams();
    params.append('from', `Mindy Chattha <mindy@${MAILGUN_DOMAIN}>`);
    params.append('to', to);
    params.append('subject', subject);
    params.append('text', text);
    if (html) params.append('html', html);
    if (replyTo) params.append('h:Reply-To', replyTo);

    const res = await fetch(mailgunUrl, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Mailgun send failed:', res.status, errText);
    }
    return res.ok;
  }

  const firstName = String(name).split(' ')[0];

  const guestResult = await sendMail({
    to: email,
    replyTo: REPLY_TO_EMAIL,
    subject: `Your ${guideLabel} from Mindy Chattha`,
    text:
      `Hi ${firstName},\n\n` +
      `Thanks for requesting the ${guideLabel}! Here's your download:\n${guideUrl}\n\n` +
      `If anything comes up as you read through it, just reply to this email or call/text ` +
      `(403) 966-0921 — happy to help.\n\n` +
      `Mindy Chattha\nREALTOR®, CENTURY 21 Bamber Realty Ltd.`,
    html:
      `<p>Hi ${firstName},</p>` +
      `<p>Thanks for requesting the ${guideLabel}! Here's your download:</p>` +
      `<p><a href="${guideUrl}">${guideUrl}</a></p>` +
      `<p>If anything comes up as you read through it, just reply to this email or call/text ` +
      `(403) 966-0921 — happy to help.</p>` +
      `<p>Mindy Chattha<br>REALTOR®, CENTURY 21 Bamber Realty Ltd.</p>`,
  });

  const notifyResult = await sendMail({
    to: NOTIFY_EMAIL,
    subject: `New ${guideLabel} sign-up: ${firstName}`,
    text: `${name} (${email}) just requested the ${guideLabel} on your site.`,
  });

  if (!guestResult || !notifyResult) {
    return { statusCode: 502, body: 'One or more emails failed to send' };
  }

  return { statusCode: 200, body: 'OK' };
};
