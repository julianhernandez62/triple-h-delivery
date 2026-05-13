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
  minimumCharge: 75,           // Minimum job charge ($)
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
//  Email — sends a professional invoice-style quote to the owner
// ─────────────────────────────────────────────────────────────────────────────
function sendQuoteEmail(job, quote) {
  const service = SERVICES[job.service] || job.service;
  const now     = job.submittedAt;

  // Quote number: THH-YYMMDD-HHMM
  const pad = n => String(n).padStart(2, '0');
  const quoteNumber = `THH-${String(now.getFullYear()).slice(-2)}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

  // Formatted dates (Central time)
  const fmtOpts = { timeZone: 'America/Chicago', day: '2-digit', month: '2-digit', year: 'numeric' };
  const issueDateStr  = now.toLocaleDateString('en-US', fmtOpts);
  const validUntil    = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const validUntilStr = validUntil.toLocaleDateString('en-US', fmtOpts);

  // Pull the estimate range from the AI text (e.g. "$187.50 – $337.50")
  const rangeMatch   = quote.match(/\$([0-9,]+(?:\.[0-9]{2})?)\s*[–\-]\s*\$([0-9,]+(?:\.[0-9]{2})?)/);
  const estimateRange = rangeMatch ? `$${rangeMatch[1]} – $${rangeMatch[2]}` : 'See details below';

  // Route summary
  const route = [job.address, job.destination].filter(Boolean).join(' → ');

  // Parse AI quote into structured HTML sections
  const quoteLines = formatQuoteHtml(quote);

  const subject = `New Quote Request — ${job.name} | Triple H Delivery [${quoteNumber}]`;

  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#ebebeb;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:680px;margin:36px auto;background:#ffffff;border:1px solid #cccccc;">

  <!-- ── HEADER ─────────────────────────────────────── -->
  <div style="padding:40px 48px 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr valign="middle">
      <td>
        <div style="font-size:32px;font-weight:900;letter-spacing:4px;color:#111111;line-height:1;">QUOTE</div>
      </td>
      <td align="right">
        <div style="font-size:17px;font-weight:900;color:#C41230;letter-spacing:0.5px;">Triple H Delivery</div>
        <div style="font-size:11px;color:#999999;margin-top:3px;letter-spacing:0.3px;">Hernie's Helping Hand</div>
      </td>
    </tr></table>
  </div>

  <!-- ── COMPANY INFO ───────────────────────────────── -->
  <div style="padding:0 48px 20px;">
    <div style="font-size:12px;color:#555555;">
      <strong style="color:#222;">Triple H Delivery, LLC</strong>
      &nbsp;&middot;&nbsp; Nashville, TN &amp; Surrounding Areas
      &nbsp;&middot;&nbsp; julian.hernandez@triplehdelivery.com
    </div>
  </div>

  <div style="border-top:1px solid #e2e2e2;margin:0 48px;"></div>

  <!-- ── CLIENT + QUOTE META ───────────────────────── -->
  <div style="padding:26px 48px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr valign="top">

      <td width="52%">
        <div style="font-size:10px;font-weight:700;color:#aaaaaa;letter-spacing:1.8px;text-transform:uppercase;margin-bottom:10px;">For</div>
        <div style="font-size:14px;color:#111111;line-height:1.9;">
          <strong>${job.name}</strong><br>
          ${job.email}<br>
          ${job.phone ? job.phone : ''}
        </div>
      </td>

      <td width="48%" align="right">
        <table cellpadding="0" cellspacing="0" style="font-size:13px;margin-left:auto;">
          <tr>
            <td style="color:#888888;padding:4px 20px 4px 0;white-space:nowrap;">Quote No.:</td>
            <td align="right"><strong style="color:#111111;">${quoteNumber}</strong></td>
          </tr>
          <tr>
            <td style="color:#888888;padding:4px 20px 4px 0;">Issue date:</td>
            <td align="right"><strong style="color:#111111;">${issueDateStr}</strong></td>
          </tr>
          <tr>
            <td style="color:#888888;padding:4px 20px 4px 0;">Valid until:</td>
            <td align="right"><strong style="color:#111111;">${validUntilStr}</strong></td>
          </tr>
        </table>
      </td>

    </tr></table>
  </div>

  <!-- ── LINE ITEMS TABLE ──────────────────────────── -->
  <div style="padding:0 48px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f5f5f5;">
          <th style="text-align:left;padding:11px 14px;border:1px solid #dedede;font-weight:700;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#444444;">Description</th>
          <th style="text-align:center;padding:11px 14px;border:1px solid #dedede;font-weight:700;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#444444;width:70px;">Quantity</th>
          <th style="text-align:right;padding:11px 14px;border:1px solid #dedede;font-weight:700;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#444444;width:170px;">Estimate (USD)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:15px 14px;border:1px solid #dedede;vertical-align:top;">
            <div style="font-weight:700;color:#111111;margin-bottom:4px;">${service}</div>
            ${route ? `<div style="font-size:12px;color:#777777;">${route}</div>` : ''}
            ${job.message ? `<div style="font-size:12px;color:#888888;margin-top:5px;">${job.message.length > 130 ? job.message.slice(0,130)+'…' : job.message}</div>` : ''}
          </td>
          <td style="text-align:center;padding:15px 14px;border:1px solid #dedede;color:#666666;vertical-align:top;">1</td>
          <td style="text-align:right;padding:15px 14px;border:1px solid #dedede;font-weight:700;color:#111111;vertical-align:top;">${estimateRange}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- ── TOTALS ─────────────────────────────────────── -->
  <div style="padding:0 48px 28px;">
    <table cellpadding="0" cellspacing="0" style="margin-left:auto;border-collapse:collapse;font-size:13px;min-width:290px;">
      <tr>
        <td style="padding:10px 16px;border:1px solid #dedede;border-top:none;color:#555555;font-weight:600;white-space:nowrap;">SUBTOTAL:</td>
        <td style="text-align:right;padding:10px 16px;border:1px solid #dedede;border-top:none;border-left:none;min-width:130px;">${estimateRange}</td>
      </tr>
      <tr>
        <td style="padding:11px 16px;border:1px solid #dedede;border-top:none;font-weight:700;color:#111111;">TOTAL (USD):</td>
        <td style="text-align:right;padding:11px 16px;border:1px solid #dedede;border-top:none;border-left:none;font-weight:700;color:#111111;">${estimateRange}</td>
      </tr>
    </table>
  </div>

  <!-- ── AI QUOTE BREAKDOWN ────────────────────────── -->
  <div style="padding:0 48px 36px;">
    <div style="font-size:10px;font-weight:700;color:#aaaaaa;letter-spacing:1.8px;text-transform:uppercase;margin-bottom:10px;">Quote Details</div>
    <div style="background:#f8f8f8;border:1px solid #e8e8e8;padding:18px 20px;font-size:12px;line-height:1.85;color:#444444;">
      ${quoteLines}
    </div>
  </div>

  <!-- ── FOOTER ─────────────────────────────────────── -->
  <div style="border-top:1px solid #e2e2e2;padding:15px 48px;background:#f7f7f7;">
    <div style="font-size:11px;color:#888888;">
      <strong style="color:#444444;">Triple H Delivery, LLC</strong>
      &nbsp;&middot;&nbsp; Nashville, TN &amp; Surrounding Areas
      &nbsp;&nbsp;<strong style="color:#444444;">Email:</strong> julian.hernandez@triplehdelivery.com
    </div>
  </div>

</div>
</body>
</html>`;

  const plainBody = [
    `QUOTE — Triple H Delivery`,
    `Quote No.: ${quoteNumber}  |  Issue Date: ${issueDateStr}  |  Valid Until: ${validUntilStr}`,
    ``,
    `FOR`,
    `  ${job.name}`,
    `  ${job.email}`,
    `  ${job.phone || ''}`,
    ``,
    `SERVICE:  ${service}`,
    route ? `ROUTE:    ${route}` : '',
    ``,
    `ESTIMATE: ${estimateRange}`,
    ``,
    `── QUOTE DETAILS ──────────────────────────────`,
    quote,
    `───────────────────────────────────────────────`,
    ``,
    `Triple H Delivery, LLC — Nashville, TN`,
    `julian.hernandez@triplehdelivery.com`,
  ].filter(l => l !== null).join('\n');

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

// Converts the AI quote text into structured invoice-quality HTML.
function formatQuoteHtml(quote) {
  // Split into named sections
  const sections = { summary: [], breakdown: [], notes: [] };
  let current = null;
  quote.split('\n').forEach(function(line) {
    const t = line.trim();
    if (t === 'ESTIMATE SUMMARY') { current = 'summary';   return; }
    if (t === 'BREAKDOWN')        { current = 'breakdown'; return; }
    if (t === 'NOTES')            { current = 'notes';     return; }
    if (current && t)             { sections[current].push(t); }
  });

  const labelStyle  = 'font-size:10px;font-weight:700;color:#aaaaaa;letter-spacing:1.8px;text-transform:uppercase;margin-bottom:10px;';
  let html = '';

  // ── ESTIMATE SUMMARY ─────────────────────────────
  if (sections.summary.length) {
    html += '<div style="margin-bottom:22px;">';
    html += '<div style="' + labelStyle + '">Estimate Summary</div>';
    html += '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">';
    sections.summary.forEach(function(line) {
      const m = line.match(/^[•\-]\s*(.+?):\s*(.+)$/);
      if (!m) return;
      const isTotal = /estimated total/i.test(m[1]);
      html += '<tr>';
      html += '<td style="padding:8px 14px;border-bottom:1px solid #f0f0f0;color:#777777;width:48%;">' + m[1] + '</td>';
      html += '<td style="padding:8px 14px;border-bottom:1px solid #f0f0f0;' + (isTotal ? 'font-weight:700;font-size:14px;color:#111111;' : 'font-weight:600;color:#222222;') + '">' + m[2] + '</td>';
      html += '</tr>';
    });
    html += '</table></div>';
  }

  // ── BREAKDOWN ────────────────────────────────────
  const tableRows = sections.breakdown.filter(function(l) { return l.startsWith('|'); });
  const extraLines = sections.breakdown.filter(function(l) { return !l.startsWith('|') && l !== '---'; });

  if (tableRows.length >= 2) {
    html += '<div style="margin-bottom:22px;">';
    html += '<div style="' + labelStyle + '">Breakdown</div>';
    html += '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;">';
    let headerDone = false;
    tableRows.forEach(function(row) {
      if (/^\|[\s\-|]+\|$/.test(row)) return; // separator
      const cells = row.split('|').filter(function(c) { return c.trim(); }).map(function(c) {
        return c.trim().replace(/\*\*/g, '');
      });
      if (!headerDone) {
        html += '<thead><tr style="background:#f5f5f5;">';
        cells.forEach(function(c, i) {
          html += '<th style="padding:9px 14px;border:1px solid #e4e4e4;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#555555;text-align:' + (i === 0 ? 'left' : 'right') + ';">' + c + '</th>';
        });
        html += '</tr></thead><tbody>';
        headerDone = true;
      } else {
        const isTotalRow = /subtotal|total/i.test(cells[0] || '');
        const rowStyle   = isTotalRow ? 'background:#f9f9f9;' : '';
        html += '<tr style="' + rowStyle + '">';
        cells.forEach(function(c, i) {
          const cellStyle = 'padding:8px 14px;border-bottom:1px solid #f0f0f0;' +
            (isTotalRow ? 'font-weight:700;' : '') +
            (i === 0 ? 'color:#333333;' : 'text-align:right;color:#111111;');
          html += '<td style="' + cellStyle + '">' + c + '</td>';
        });
        html += '</tr>';
      }
    });
    html += '</tbody></table>';
    extraLines.forEach(function(l) {
      const clean = l.replace(/^>\s*/, '').replace(/✅\s*/g, '').trim();
      if (clean) html += '<div style="font-size:12px;color:#555555;margin-top:8px;padding-left:2px;">' + clean + '</div>';
    });
    html += '</div>';
  }

  // ── NOTES ────────────────────────────────────────
  const notesText = sections.notes.filter(function(l) { return l !== '---'; }).join(' ').trim();
  if (notesText) {
    html += '<div style="background:#fafafa;border-left:3px solid #C41230;padding:14px 18px;">';
    html += '<div style="' + labelStyle + 'margin-bottom:6px;">Notes</div>';
    html += '<div style="font-size:12px;color:#444444;line-height:1.75;">' + notesText + '</div>';
    html += '</div>';
  }

  return html || '<div style="font-size:12px;color:#666;">' + quote + '</div>';
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
