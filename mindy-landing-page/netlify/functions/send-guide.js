// Triggered by Netlify's "Outgoing Webhook" form notification (free tier).
// On each guide-request submission, this sends:
//   1. Immediately: the requested guide (download link) to the signer, +
//      a lead notification to Mindy
//   2. Day 2: a short value/tip email (different content for buyer vs seller)
//   3. Day 5: a gentle nudge toward booking a free consultation
// All recipient-facing emails use a branded HTML template (logo, colors, footer).
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
  const LOGO_URL = `${SITE_URL}/images/logo_web.png`;

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

  // ---------- Branded HTML template ----------
  // bodyHtml: the inner content for this specific email (paragraphs, a button, etc.)
  // ctaText / ctaUrl: optional button shown below the body content
  function renderEmail({ bodyHtml, ctaText, ctaUrl }) {
    const button = ctaText && ctaUrl
      ? `<tr><td style="padding:28px 40px 8px;">
           <a href="${ctaUrl}" style="display:inline-block; background:#1D3025; color:#F7F6F2; text-decoration:none; font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; padding:14px 28px; border-radius:2px;">${ctaText}</a>
         </td></tr>`
      : '';

    return `
<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#F1EFE7;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F1EFE7; padding:32px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#F7F6F2; border-radius:6px; overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:#1D3025; padding:28px 40px; text-align:center;">
              <img src="${LOGO_URL}" alt="Mindy Chattha" width="64" style="display:block; margin:0 auto 10px; filter:brightness(0) invert(1);">
              <div style="font-family:Georgia,'Times New Roman',serif; font-style:italic; color:#F7F6F2; font-size:16px;">Make Your Move with Mindy</div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px 8px; font-family:Arial,Helvetica,sans-serif; font-size:15.5px; line-height:1.6; color:#2A2A28;">
              ${bodyHtml}
            </td>
          </tr>

          ${button}

          <!-- Footer -->
          <tr>
            <td style="padding:32px 40px 28px;">
              <hr style="border:none; border-top:1px solid rgba(29,48,37,0.15); margin:0 0 20px;">
              <div style="font-family:Arial,Helvetica,sans-serif; font-size:13.5px; color:#5b5b58; line-height:1.6;">
                <strong style="color:#1D3025;">Mindy Chattha</strong><br>
                REALTOR&reg;, CENTURY 21 Bamber Realty Ltd.<br>
                1612 17 Ave SW, Calgary, AB<br>
                <a href="tel:14039660921" style="color:#5b5b58; text-decoration:none;">(403) 966-0921</a> &middot;
                <a href="mailto:mindy@mindychattha.ca" style="color:#5b5b58; text-decoration:none;">mindy@mindychattha.ca</a>
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

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
  const guideBodyHtml =
    `<p>Hi ${firstName},</p>` +
    `<p>Thanks for requesting the <strong>${guideLabel}</strong>! Your download is ready below.</p>` +
    `<p>If anything comes up as you read through it, just reply to this email or call/text (403) 966-0921 &mdash; happy to help.</p>`;

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
    html: renderEmail({
      bodyHtml: guideBodyHtml,
      ctaText: `Download the ${guideLabel}`,
      ctaUrl: guideUrl,
    }),
  });

  // ---------- Email 2 (Day 2): a value/tip email ----------
  const tipSubject = isSeller
    ? 'One thing that surprises most sellers'
    : 'A quick tip before you start touring homes';
  const tipBodyHtml = isSeller
    ? `<p>Hi ${firstName},</p>` +
      `<p>Quick one: most sellers spend money on the wrong things before listing. Fresh paint and decluttering ` +
      `almost always pay off &mdash; big renovations almost never do, at least not at resale.</p>` +
      `<p>If you want a second opinion on what's actually worth doing for your specific place, just reply and let me know a bit about it.</p>`
    : `<p>Hi ${firstName},</p>` +
      `<p>Quick one: get pre-approved before you start seriously touring homes, not after. It tells you your ` +
      `real price range and makes your offer stronger when you find the right place.</p>` +
      `<p>If you want to talk through where you stand, just reply and let me know.</p>`;
  const tipText = isSeller
    ? `Hi ${firstName},\n\nQuick one: most sellers spend money on the wrong things before listing. Fresh paint and decluttering almost always pay off — big renovations almost never do, at least not at resale.\n\nIf you want a second opinion on what's actually worth doing for your specific place, just reply and let me know a bit about it.\n\nMindy`
    : `Hi ${firstName},\n\nQuick one: get pre-approved before you start seriously touring homes, not after. It tells you your real price range and makes your offer stronger when you find the right place.\n\nIf you want to talk through where you stand, just reply and let me know.\n\nMindy`;

  await sendMail({
    to: email,
    replyTo: REPLY_TO_EMAIL,
    subject: tipSubject,
    text: tipText,
    html: renderEmail({ bodyHtml: tipBodyHtml }),
    deliverAt: day2,
  });

  // ---------- Email 3 (Day 5): nudge toward booking ----------
  const nudgeSubject = isSeller
    ? 'Curious what your home is worth right now?'
    : 'Still exploring, or ready to chat?';
  const nudgeBodyHtml = isSeller
    ? `<p>Hi ${firstName},</p>` +
      `<p>No pressure at all &mdash; just wanted to leave the door open. If you're curious what your home would ` +
      `sell for in today's market, or just want to talk timing, grab a free 20-minute slot below.</p>`
    : `<p>Hi ${firstName},</p>` +
      `<p>No pressure at all &mdash; just wanted to leave the door open. If you want a real answer on what you ` +
      `can afford or just want to talk through next steps, grab a free 20-minute slot below.</p>`;
  const nudgeText = isSeller
    ? `Hi ${firstName},\n\nNo pressure at all — just wanted to leave the door open. If you're curious what your home would sell for in today's market, or just want to talk timing, you can grab a free 20-minute slot here:\n${BOOKING_URL}\n\nMindy`
    : `Hi ${firstName},\n\nNo pressure at all — just wanted to leave the door open. If you want a real answer on what you can afford or just want to talk through next steps, you can grab a free 20-minute slot here:\n${BOOKING_URL}\n\nMindy`;

  await sendMail({
    to: email,
    replyTo: REPLY_TO_EMAIL,
    subject: nudgeSubject,
    text: nudgeText,
    html: renderEmail({
      bodyHtml: nudgeBodyHtml,
      ctaText: 'Book My Free Call',
      ctaUrl: BOOKING_URL,
    }),
    deliverAt: day5,
  });

  // ---------- Lead notification to Mindy (immediate, plain) ----------
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
