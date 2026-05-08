// ─────────────────────────────────────────────
//  Triple H Delivery — AI Quote Engine
//  Google Apps Script
//
//  REQUIRED Script Properties (set in Apps Script editor):
//    ANTHROPIC_API_KEY  — your Anthropic API key
//    SPREADSHEET_ID     — Google Sheet ID to log quotes
// ─────────────────────────────────────────────

const OWNER_EMAIL = 'julian.hernandez@triplehdelivery.com';

// ── Adjust these rates to match your actual pricing ──────────────────────────
const PRICING_CONFIG = {
  minimumCharge: 150,          // Minimum job charge ($)
  baseHourlyRate: 75,          // $/hr for standard 2-helper crew
  extraHelperRate: 40,         // $/hr per additional helper beyond 2
  mileageRate: 2.50,           // $/mile (one-way) for trips over 10 miles
  mileageFreeRadius: 10,       // Miles before mileage fee kicks in
  heavyItemSurcharge: 75,      // Per heavy/specialty item (piano, safe, appliance)
  stairsSurcharge: 25,         // Per flight of stairs beyond ground floor
  packingRate: 35,             // $/hr if packing service requested
  minimumHours: 2,             // Minimum billable hours
};

const SERVICES = {
  delivery: 'Local Delivery',
  pickup:   'Package Pickup',
  repair:   'Home Repair',
  other:    'Other / Not Sure',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Entry point — handles POST from the website form
// ─────────────────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const raw  = e.postData && e.postData.contents ? e.postData.contents : '';
    const data = raw ? JSON.parse(raw) : e.parameter;

    const job = {
      name:        (data.name        || '').trim(),
      phone:       (data.phone       || '').trim(),
      email:       (data.email       || '').trim(),
      service:     (data.service     || '').trim(),
      address:     (data.address     || '').trim(),
      destination: (data.destination || '').trim(),
      message:     (data.message     || '').trim(),
      submittedAt: new Date(),
    };

    const quote = generateQuote(job);
    logToSheet(job, quote);
    sendQuoteEmail(job, quote);

    return jsonResponse({ success: true });

  } catch (err) {
    Logger.log('doPost error: ' + err.message + '\n' + err.stack);
    return jsonResponse({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Claude AI — interprets job details and generates a structured quote
// ─────────────────────────────────────────────────────────────────────────────
function generateQuote(job) {
  const systemPrompt = buildSystemPrompt();
  const userMessage  = buildUserMessage(job);

  const payload = {
    model:      'claude-sonnet-4-6',
    max_tokens: 1024,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userMessage }],
  };

  const options = {
    method:          'post',
    contentType:     'application/json',
    headers: {
      'x-api-key':         PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
    },
    payload:          JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  const result   = JSON.parse(response.getContentText());

  if (result.error) {
    throw new Error('Anthropic API error: ' + result.error.message);
  }

  return result.content[0].text;
}

function buildSystemPrompt() {
  const p = PRICING_CONFIG;
  return `You are the quote generator for Triple H Delivery, a moving and delivery service based in Nashville, TN.

PRICING RULES:
- Minimum charge: $${p.minimumCharge}
- Standard crew (2 helpers): $${p.baseHourlyRate}/hour — minimum ${p.minimumHours} hours
- Extra helper (beyond 2): $${p.extraHelperRate}/hour each
- Mileage: $${p.mileageRate}/mile one-way for trips over ${p.mileageFreeRadius} miles
- Heavy or specialty items (piano, safe, large appliance, gun safe, hot tub): $${p.heavyItemSurcharge} surcharge each
- Stairs: $${p.stairsSurcharge} per flight above ground floor
- Packing/unpacking service: $${p.packingRate}/hour additional

CREW SIZE GUIDE:
- Small job (1–5 items, studio, or single room): 1–2 helpers
- Medium job (1–2 bedroom apartment or small house): 2–3 helpers
- Large job (3+ bedroom house or many heavy items): 3–4 helpers
- Extra-large job (4+ bedrooms, multiple stops, commercial): 4+ helpers

INSTRUCTIONS:
Given the client's job details, produce a clear, professional quote. Structure your response exactly like this:

ESTIMATE SUMMARY
• Helpers needed: [number]
• Estimated time: [X–Y hours]
• Distance fee: [amount or "None — within free radius"]
• Item surcharges: [list or "None"]
• Estimated total: $[low] – $[high]

BREAKDOWN
[Show the math: labor cost, mileage, surcharges, etc.]

NOTES
[1–3 short sentences: any assumptions made, what could affect the final price, or advice for the client.]

Keep the tone professional but friendly. If key information is missing (e.g., no destination provided), note the assumption you made and flag it for Julian to confirm with the client.`;
}

function buildUserMessage(job) {
  return `New quote request received:

Client:       ${job.name}
Phone:        ${job.phone || 'Not provided'}
Email:        ${job.email || 'Not provided'}
Service type: ${SERVICES[job.service] || job.service}
Pickup:       ${job.address || 'Not provided'}
Destination:  ${job.destination || 'Not provided'}
Job details:  ${job.message}

Please generate a quote for this job.`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Google Sheets — appends a row for every quote request
// ─────────────────────────────────────────────────────────────────────────────
function logToSheet(job, quote) {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) {
    Logger.log('SPREADSHEET_ID not set — skipping sheet logging');
    return;
  }

  const ss    = SpreadsheetApp.openById(spreadsheetId);
  let   sheet = ss.getSheetByName('Quotes');

  if (!sheet) {
    sheet = ss.insertSheet('Quotes');
    sheet.appendRow([
      'Date', 'Name', 'Phone', 'Email',
      'Service', 'Pickup Address', 'Destination',
      'Job Details', 'AI-Generated Quote',
    ]);
    sheet.getRange(1, 1, 1, 9).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  sheet.appendRow([
    job.submittedAt,
    job.name,
    job.phone,
    job.email,
    SERVICES[job.service] || job.service,
    job.address,
    job.destination,
    job.message,
    quote,
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Email — sends a formatted quote to the owner
// ─────────────────────────────────────────────────────────────────────────────
function sendQuoteEmail(job, quote) {
  const service     = SERVICES[job.service] || job.service;
  const subject     = `New Quote Request — ${job.name} | Triple H Delivery`;
  const quoteHtml   = quote.replace(/\n/g, '<br>').replace(/•/g, '&bull;');
  const dateString  = job.submittedAt.toLocaleString('en-US', { timeZone: 'America/Chicago' });

  const htmlBody = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f4;">
  <div style="max-width:620px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

    <div style="background:#1a1a2e;padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:20px;">Triple H Delivery</h1>
      <p style="color:#aaa;margin:4px 0 0;font-size:14px;">New Quote Request</p>
    </div>

    <div style="padding:28px 32px;">

      <h2 style="color:#1a1a2e;margin:0 0 16px;font-size:16px;border-bottom:2px solid #f0f0f0;padding-bottom:10px;">
        Client Information
      </h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr><td style="padding:6px 0;color:#888;width:120px;">Name</td><td style="padding:6px 0;font-weight:600;">${job.name}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Phone</td><td style="padding:6px 0;">${job.phone || '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Email</td><td style="padding:6px 0;">${job.email || '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Service</td><td style="padding:6px 0;">${service}</td></tr>
      </table>

      <h2 style="color:#1a1a2e;margin:0 0 16px;font-size:16px;border-bottom:2px solid #f0f0f0;padding-bottom:10px;">
        Job Details
      </h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr><td style="padding:6px 0;color:#888;width:120px;">Pickup</td><td style="padding:6px 0;">${job.address || '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Destination</td><td style="padding:6px 0;">${job.destination || '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#888;vertical-align:top;">Description</td><td style="padding:6px 0;">${job.message}</td></tr>
      </table>

      <h2 style="color:#1a1a2e;margin:0 0 16px;font-size:16px;border-bottom:2px solid #f0f0f0;padding-bottom:10px;">
        AI-Generated Quote
      </h2>
      <div style="background:#f8f8f8;border-left:4px solid #1a1a2e;padding:16px 20px;border-radius:0 6px 6px 0;line-height:1.7;">
        ${quoteHtml}
      </div>

    </div>

    <div style="background:#f4f4f4;padding:16px 32px;text-align:center;">
      <p style="color:#aaa;font-size:12px;margin:0;">Submitted ${dateString} &nbsp;|&nbsp; Triple H Delivery Quote System</p>
    </div>

  </div>
</body>
</html>`;

  const plainBody = [
    `NEW QUOTE REQUEST — Triple H Delivery`,
    `Submitted: ${dateString}`,
    ``,
    `CLIENT`,
    `  Name:        ${job.name}`,
    `  Phone:       ${job.phone || '—'}`,
    `  Email:       ${job.email || '—'}`,
    `  Service:     ${service}`,
    ``,
    `JOB`,
    `  Pickup:      ${job.address || '—'}`,
    `  Destination: ${job.destination || '—'}`,
    `  Details:     ${job.message}`,
    ``,
    `AI-GENERATED QUOTE`,
    `─────────────────────────────────`,
    quote,
  ].join('\n');

  MailApp.sendEmail({
    to:       OWNER_EMAIL,
    subject:  subject,
    body:     plainBody,
    htmlBody: htmlBody,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
