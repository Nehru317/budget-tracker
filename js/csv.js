function parseCsvText(text) {
  const src = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((line) => line.some((value) => String(value).trim()));
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseMoneyCell(value) {
  if (value == null) return 0;
  let raw = String(value).trim();
  if (!raw || raw === "-" || raw === "—") return 0;
  const negative = /^\(.*\)$/.test(raw);
  raw = raw.replace(/[$,()\s]/g, "");
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return 0;
  return negative ? -Math.abs(amount) : amount;
}

function parseFlexibleDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (us) {
    let year = Number(us[3]);
    if (year < 100) year += 2000;
    const month = String(Number(us[1])).padStart(2, "0");
    const day = String(Number(us[2])).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return toISODate(new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
}

function guessCategory(description, isIncome) {
  if (isIncome) return "Income";
  const text = String(description || "").toUpperCase();
  if (/WALMART|KROGER|PUBLIX|ALDI|GIANT FOOD|SAFEWAY|FOOD LION|GROCERY|TRADER JOE|COSTCO|SAM'?S CLUB|TARGET/.test(text)) return "Groceries";
  if (/MCDONALD|STARBUCKS|CHIPOTLE|DOMINO|PIZZA|RESTAURANT|DOORDASH|UBER EATS|GRUBHUB|WENDY|TACO BELL|DUNKIN|PANERA/.test(text)) return "Dining";
  if (/NETFLIX|SPOTIFY|HULU|DISNEY|YOUTUBE|APPLE.COM.BILL|HBO|PARAMOUNT|AMAZON PRIME/.test(text)) return "Subscriptions";
  if (/SHELL|EXXON|CHEVRON|WAWA|CIRCLE K|\bBP\b|GAS STATION|UBER|LYFT|TRANSIT|METRO|PARKING/.test(text)) return "Transportation";
  if (/RENT|APARTMENT|MORTGAGE|HOA|LANDLORD/.test(text)) return "Housing";
  if (/ELECTRIC|DOMINION|PEPCO|WATER|SEWER|COMCAST|XFINITY|VERIZON|T-MOBILE|AT&T|UTILIT|GAS CO/.test(text)) return "Utilities";
  if (/GEICO|STATE FARM|PROGRESSIVE|ALLSTATE|USAA|INSURANCE/.test(text)) return "Insurance";
  if (/CVS|WALGREENS|PHARMACY|HOSPITAL|DOCTOR|DENTAL|CLINIC/.test(text)) return "Healthcare";
  if (/LOAN PMT|LOAN PAYMENT|NFCU LOAN|PAYMENT TO LOAN|CREDIT CARD PMT/.test(text)) return "Debt payment";
  if (/TRANSFER TO SHARE|TRANSFER TO SAVINGS|DEPOSIT TO SAV/.test(text)) return "Savings";
  if (/AMAZON|AMZN/.test(text)) return "Personal";
  return "Other";
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const headers = rows[i].map(normalizeHeader);
    const hasDate = headers.some((h) => h.includes("date"));
    const hasDesc = headers.some((h) => /description|memo|payee|name/.test(h));
    const hasMoney = headers.some((h) => /debit|credit|amount|withdrawal|deposit/.test(h));
    if (hasDate && (hasDesc || hasMoney)) return i;
  }
  return 0;
}

function pickColumn(headers, patterns) {
  for (const pattern of patterns) {
    const index = headers.findIndex((header) => pattern.test(header));
    if (index >= 0) return index;
  }
  return -1;
}

function parseBankCsv(text) {
  const rows = parseCsvText(text);
  if (!rows.length) throw new Error("That file looks empty.");
  const headerIndex = findHeaderRow(rows);
  const headers = rows[headerIndex].map(normalizeHeader);
  const dateCol = pickColumn(headers, [/^posted date$/, /^posting date$/, /^transaction date$/, /^tran date$/, /^trans date$/, /^date$/]);
  const descCol = pickColumn(headers, [/^transaction description$/, /^description$/, /^memo$/, /^payee$/, /^name$/]);
  const debitCol = pickColumn(headers, [/^debit$/, /^withdrawal/, /^withdrawals$/]);
  const creditCol = pickColumn(headers, [/^credit$/, /^deposit$/, /^deposits$/]);
  const amountCol = pickColumn(headers, [/^amount$/, /^transaction amount$/, /^value$/]);
  const refCol = pickColumn(headers, [/^no$/, /^check/, /^reference/, /^id$/]);
  if (dateCol < 0) throw new Error("Could not find a Date column. Use the CSV download from Navy Federal, not a PDF.");
  const parsed = [];
  rows.slice(headerIndex + 1).forEach((line) => {
    const date = parseFlexibleDate(line[dateCol]);
    if (!date) return;
    const description = String(line[descCol >= 0 ? descCol : 1] || "Navy Federal transaction").trim() || "Navy Federal transaction";
    let amount = 0;
    let type = "expense";
    const debit = debitCol >= 0 ? Math.abs(parseMoneyCell(line[debitCol])) : 0;
    const credit = creditCol >= 0 ? Math.abs(parseMoneyCell(line[creditCol])) : 0;
    if (debitCol >= 0 || creditCol >= 0) {
      if (credit > 0 && credit >= debit) {
        amount = credit;
        type = "income";
      } else if (debit > 0) {
        amount = debit;
        type = "expense";
      } else {
        return;
      }
    } else {
      const signed = parseMoneyCell(line[amountCol >= 0 ? amountCol : line.length - 1]);
      if (!signed) return;
      amount = Math.abs(signed);
      type = signed < 0 ? "expense" : "income";
    }
    parsed.push({
      date,
      description,
      amount,
      type,
      category: guessCategory(description, type === "income"),
      externalId: refCol >= 0 ? String(line[refCol] || "").trim() : "",
    });
  });
  if (!parsed.length) throw new Error("No transactions were found in that CSV.");
  return parsed;
}

function csvFingerprint(tx, accountId) {
  const desc = String(tx.description || "").replace(/\s+/g, " ").trim().toUpperCase();
  return `${tx.date}|${desc}|${Number(tx.amount).toFixed(2)}|${tx.type}|${accountId}`;
}

function importBankRows(state, rows, accountId) {
  const existing = new Set((state.transactions || []).map((tx) => csvFingerprint(tx, tx.accountId || accountId)));
  const existingIds = new Set(
    (state.transactions || [])
      .filter((tx) => tx.externalId)
      .map((tx) => `${tx.accountId || ""}|${tx.externalId}`)
  );
  let added = 0;
  let skipped = 0;
  rows.forEach((row) => {
    if (row.externalId && existingIds.has(`${accountId}|${row.externalId}`)) {
      skipped += 1;
      return;
    }
    const fingerprint = csvFingerprint(row, accountId);
    if (existing.has(fingerprint)) {
      skipped += 1;
      return;
    }
    state.transactions.push({
      id: uid(),
      date: row.date,
      description: row.description,
      category: row.category,
      amount: row.amount,
      type: row.type,
      status: "completed",
      recurring: "none",
      accountId,
      source: "csv",
      externalId: row.externalId || "",
    });
    existing.add(fingerprint);
    if (row.externalId) existingIds.add(`${accountId}|${row.externalId}`);
    added += 1;
  });
  return { added, skipped };
}
