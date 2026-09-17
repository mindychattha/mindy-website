// Triggered by Netlify's "Outgoing Webhook" form notification (free tier).
// On each guide-request submission, this sends:
//   1. Immediately: the requested guide (download link) to the signer, +
//      a lead notification to Mindy
//   2. Day 2: a short value/tip email (different content for buyer vs seller)
//   3. Day 5: a gentle nudge toward booking a free consultation
//
// Required environment variables (Netlify: Project configuration ->
// Environment variables):
//   MAILGUN_API_KEY   - your Mailgun private API key
//   MAILGUN_DOMAIN     - your verified Mailgun sending domain (e.g. mg.mindychattha.com)
//   NOTIFY_EMAIL       - where lead notifications go (e.g. mindy@mindychattha.ca)
//   REPLY_TO_EMAIL     - address recipients should reply to (e.g. mindy@mindychattha.ca)
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
  const BOOKING_URL = `${SITE_URL}/#book`;

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
  const firstName = String(name).split(' ')[0];

  const auth = 'Basic ' + Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64');
  const mailgunUrl = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`;

  async function sendMail({ to, subject, text, html, replyTo, deliverAt }) {
    const params = new URLSearchParams();
    params.append('from', `Mindy Chattha <mindy@${MAILGUN_DOMAIN}>`);
    params.append('to', to);
    params.append('subject', subject);
    params.append('text', text);
    if (html) params.append('html', html);
    if (replyTo) params.append('h:Reply-To', replyTo);
    if (deliverAt) params.append('o:deliverytime', deliverAt.toUTCString());

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

  const DAY = 24 * 60 * 60 * 1000;
  const day2 = new Date(Date.now() + 2 * DAY);
  const day5 = new Date(Date.now() + 5 * DAY);

  // ---------- Email 1 (immediate): the guide itself ----------
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

  // ---------- Email 2 (Day 2): a value/tip email ----------
  const tipSubject = isSeller
    ? 'One thing that surprises most sellers'
    : 'A quick tip before you start touring homes';
  const tipText = isSeller
    ? `Hi ${firstName},\n\n` +
      `Quick one: most sellers spend money on the wrong things before listing. Fresh paint and decluttering ` +
      `almost always pay off — big renovations almost never do, at least not at resale.\n\n` +
      `If you want a second opinion on what's actually worth doing for your specific place, just reply and ` +
      `let me know a bit about it.\n\n` +
      `Mindy`
    : `Hi ${firstName},\n\n` +
      `Quick one: get pre-approved before you start seriously touring homes, not after. It tells you your ` +
      `real price range and makes your offer stronger when you find the right place.\n\n` +
      `If you want to talk through where you stand, just reply and let me know.\n\n` +
      `Mindy`;

  await sendMail({
    to: email,
    replyTo: REPLY_TO_EMAIL,
    subject: tipSubject,
    text: tipText,
    deliverAt: day2,
  });

  // ---------- Email 3 (Day 5): nudge toward booking ----------
  const nudgeSubject = isSeller
    ? 'Curious what your home is worth right now?'
    : 'Still exploring, or ready to chat?';
  const nudgeText = isSeller
    ? `Hi ${firstName},\n\n` +
      `No pressure at all — just wanted to leave the door open. If you're curious what your home would sell ` +
      `for in today's market, or just want to talk timing, you can grab a free 20-minute slot here:\n${BOOKING_URL}\n\n` +
      `Mindy`
    : `Hi ${firstName},\n\n` +
      `No pressure at all — just wanted to leave the door open. If you want a real answer on what you can ` +
      `afford or just want to talk through next steps, you can grab a free 20-minute slot here:\n${BOOKING_URL}\n\n` +
      `Mindy`;

  await sendMail({
    to: email,
    replyTo: REPLY_TO_EMAIL,
    subject: nudgeSubject,
    text: nudgeText,
    deliverAt: day5,
  });

  // ---------- Lead notification to Mindy (immediate) ----------
  const notifyResult = await sendMail({
    to: NOTIFY_EMAIL,
    subject: `New ${guideLabel} sign-up: ${firstName}`,
    text: `${name} (${email}) just requested the ${guideLabel} on your site. A 3-email drip is now scheduled for them (Day 2 + Day 5).`,
  });

  if (!guestResult || !notifyResult) {
    return { statusCode: 502, body: 'One or more emails failed to send' };
  }

  return { statusCode: 200, body: 'OK' };
};
