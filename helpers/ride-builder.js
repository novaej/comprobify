'use strict';

const fs  = require('fs');
const PDFDocument = require('pdfkit');
const bwipjs      = require('bwip-js');
const moment      = require('moment');

// ─── Page constants (A4 in points) ───────────────────────────────────────────
const M  = 30;                          // margin
const CW = 595.28 - M * 2;             // ~535 pt usable width

// ─── Colour palette ───────────────────────────────────────────────────────────
const C_BLACK  = '#000000';
const C_DARK   = '#1A1A1A';
const C_GREY   = '#555555';
const C_BG_HDR = '#F0F0F0';            // section header background
const C_BG_ALT = '#F8F8F8';            // alternating row background
const C_BORDER = '#AAAAAA';

// ─── Low-level helpers ────────────────────────────────────────────────────────

function fmt(n, d = 2) { return parseFloat(n || 0).toFixed(d); }

function environmentLabel(env)  { return env  === '2' ? 'PRODUCCIÓN'                  : 'PRUEBAS'; }
function emissionLabel(code)    { return code === '2' ? 'INDISPONIBILIDAD DE SISTEMA' : 'NORMAL';  }

async function makeBarcodeBuffer(text) {
  try {
    return await bwipjs.toBuffer({
      bcid: 'code128', text, scale: 2, height: 10, includetext: false,
    });
  } catch { return null; }
}

/** Height of text when rendered at given width (does not draw). */
function mh(doc, text, w, { size = 8, bold = false } = {}) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
  return doc.heightOfString(String(text ?? ''), { width: w });
}

/** Render text at explicit (x, y). Never moves the PDFKit internal cursor. */
function wt(doc, text, x, y, w, { size = 8, bold = false, align = 'left', color = C_BLACK } = {}) {
  doc.save()
     .font(bold ? 'Helvetica-Bold' : 'Helvetica')
     .fontSize(size)
     .fillColor(color)
     .text(String(text ?? ''), x, y, { width: w, align, lineBreak: true })
     .restore();
}

function strokeBox(doc, x, y, w, h, color = C_BORDER) {
  doc.save().rect(x, y, w, h).stroke(color).restore();
}

function fillBox(doc, x, y, w, h, fill, stroke = C_BORDER) {
  doc.save().rect(x, y, w, h).fillAndStroke(fill, stroke).restore();
}

function hline(doc, x, y, w, color = C_BORDER) {
  doc.save().moveTo(x, y).lineTo(x + w, y).stroke(color).restore();
}

function vline(doc, x, y, h, color = C_BORDER) {
  doc.save().moveTo(x, y).lineTo(x, y + h).stroke(color).restore();
}

// ─── Section 1: Two-column issuer + document header ──────────────────────────
//
// LEFT  (42 %): logo · issuer name/trade name · addresses · accounting info
// RIGHT (58 %): RUC · FACTURA · No. · NÚMERO DE AUTORIZACIÓN · auth number ·
//               FECHA/HORA · AMBIENTE · EMISIÓN · ESTADO · CLAVE · barcode · key
//
async function drawHeader(doc, data, y) {
  const LEFT_W  = Math.round(CW * 0.42);
  const RIGHT_W = CW - LEFT_W;
  const lx = M;
  const rx = M + LEFT_W;
  const P  = 6;   // inner padding

  // ── Measure right column height exactly ──────────────────────────────────
  const rw       = RIGHT_W - P * 2;
  const halfRW   = Math.round(rw * 0.50);
  const valRW    = rw - halfRW - 3;

  const authDateStr = data.authorizationDate
    ? moment(data.authorizationDate).format('DD/MM/YYYY HH:mm:ss')
    : '';

  // Line heights for each row in the right column
  const rightRows = [
    P,                                                    // top padding
    Math.max(mh(doc, 'R.U.C.:', 36, { size: 8 }),
             mh(doc, data.ruc, rw - 40, { size: 10, bold: true })) + 4,
    mh(doc, 'FACTURA', rw, { size: 14, bold: true }) + 4,
    mh(doc, `No.    ${data.branchCode}-${data.issuePointCode}-${data.sequential}`, rw, { size: 8 }) + 4,
    mh(doc, 'NÚMERO DE AUTORIZACIÓN', rw, { size: 7 }) + 2,
    mh(doc, data.authorizationNumber || '', rw, { size: 7.5 }) + 5,
    Math.max(mh(doc, 'FECHA Y HORA DE\nAUTORIZACIÓN:', halfRW, { size: 7 }),
             mh(doc, authDateStr, valRW, { size: 7.5 })) + 4,
    Math.max(mh(doc, 'AMBIENTE:', halfRW, { size: 7.5 }),
             mh(doc, environmentLabel(data.environment), valRW, { size: 7.5 })) + 4,
    Math.max(mh(doc, 'EMISIÓN:', halfRW, { size: 7.5 }),
             mh(doc, emissionLabel(data.emissionType), valRW, { size: 7.5 })) + 4,
    Math.max(mh(doc, 'ESTADO:', halfRW, { size: 7.5, bold: true }),
             mh(doc, 'AUTORIZADO', valRW, { size: 7.5, bold: true })) + 4,
    mh(doc, 'CLAVE DE ACCESO', rw, { size: 7 }) + 2,
    38 + 4,   // barcode image (36pt) + gap
    mh(doc, data.accessKey || '', rw, { size: 6 }) + 2,
    P,        // bottom padding
  ];
  const HEADER_H = rightRows.reduce((s, v) => s + v, 0);

  // ── Draw outer boxes ──────────────────────────────────────────────────────
  strokeBox(doc, lx, y, LEFT_W,  HEADER_H, C_DARK);
  strokeBox(doc, rx, y, RIGHT_W, HEADER_H, C_DARK);

  // ── Left column content ───────────────────────────────────────────────────
  {
    const lw = LEFT_W - P * 2;
    let ly = y + P;

    // Logo
    if (data.logoPath) {
      try {
        if (fs.existsSync(data.logoPath)) {
          doc.image(data.logoPath, lx + P, ly, { fit: [lw, 60] });
          ly += 64;
        }
      } catch { /* unreadable — skip */ }
    }

    // Business name
    wt(doc, data.businessName || '', lx + P, ly, lw, { size: 9, bold: true });
    ly += mh(doc, data.businessName || '', lw, { size: 9, bold: true }) + 3;

    // Trade name
    if (data.tradeName) {
      wt(doc, data.tradeName, lx + P, ly, lw, { size: 8 });
      ly += mh(doc, data.tradeName, lw, { size: 8 }) + 3;
    }

    ly += 4;

    // Dirección Matriz
    const LBEW = 38;
    wt(doc, 'Dirección\nMatriz:', lx + P, ly, LBEW, { size: 7, color: C_GREY });
    wt(doc, data.mainAddress || '', lx + P + LBEW + 3, ly, lw - LBEW - 3, { size: 7 });
    const addrH = Math.max(
      mh(doc, 'Dirección\nMatriz:', LBEW, { size: 7 }),
      mh(doc, data.mainAddress || '', lw - LBEW - 3, { size: 7 })
    );
    ly += addrH + 5;

    // Dirección Sucursal
    if (data.branchAddress) {
      wt(doc, 'Dirección\nSucursal:', lx + P, ly, LBEW, { size: 7, color: C_GREY });
      wt(doc, data.branchAddress, lx + P + LBEW + 3, ly, lw - LBEW - 3, { size: 7 });
      const sucH = Math.max(
        mh(doc, 'Dirección\nSucursal:', LBEW, { size: 7 }),
        mh(doc, data.branchAddress, lw - LBEW - 3, { size: 7 })
      );
      ly += sucH + 5;
    }

    // Special taxpayer
    if (data.specialTaxpayer) {
      wt(doc, `CONTRIBUYENTE ESPECIAL Nro. ${data.specialTaxpayer}`, lx + P, ly, lw, { size: 7, bold: true });
      ly += mh(doc, `CONTRIBUYENTE ESPECIAL Nro. ${data.specialTaxpayer}`, lw, { size: 7, bold: true }) + 3;
    }

    ly += 4;

    // OBLIGADO A LLEVAR CONTABILIDAD
    const acctLabel = 'OBLIGADO A LLEVAR CONTABILIDAD';
    const acctValue = data.requiredAccounting === 'SI' ? 'SI' : 'NO';
    wt(doc, acctLabel, lx + P, ly, lw - 22, { size: 7 });
    wt(doc, acctValue, lx + LEFT_W - P - 18, ly, 18, { size: 7, bold: true, align: 'right' });
  }

  // ── Right column content ──────────────────────────────────────────────────
  {
    let ry = y;
    const ri = rx + P;

    ry += rightRows[0]; // top padding

    // R.U.C.
    wt(doc, 'R.U.C.:', ri, ry, 36, { size: 8, color: C_GREY });
    wt(doc, data.ruc, ri + 40, ry, rw - 40, { size: 10, bold: true });
    ry += rightRows[1];

    // FACTURA
    wt(doc, 'FACTURA', ri, ry, rw, { size: 14, bold: true });
    ry += rightRows[2];

    // No.
    wt(doc, `No.    ${data.branchCode}-${data.issuePointCode}-${data.sequential}`, ri, ry, rw, { size: 8 });
    ry += rightRows[3];

    // Divider
    hline(doc, rx + 3, ry, RIGHT_W - 6);

    // NÚMERO DE AUTORIZACIÓN
    wt(doc, 'NÚMERO DE AUTORIZACIÓN', ri, ry + 2, rw, { size: 7, color: C_GREY });
    ry += rightRows[4];

    // Auth number
    wt(doc, data.authorizationNumber || '', ri, ry, rw, { size: 7.5 });
    ry += rightRows[5];

    hline(doc, rx + 3, ry, RIGHT_W - 6);

    // FECHA Y HORA
    wt(doc, 'FECHA Y HORA DE\nAUTORIZACIÓN:', ri, ry + 2, halfRW, { size: 7, color: C_GREY });
    wt(doc, authDateStr, ri + halfRW + 3, ry + 2, valRW, { size: 7.5 });
    ry += rightRows[6];

    // AMBIENTE
    wt(doc, 'AMBIENTE:', ri, ry, halfRW, { size: 7.5, color: C_GREY });
    wt(doc, environmentLabel(data.environment), ri + halfRW + 3, ry, valRW, { size: 7.5 });
    ry += rightRows[7];

    // EMISIÓN
    wt(doc, 'EMISIÓN:', ri, ry, halfRW, { size: 7.5, color: C_GREY });
    wt(doc, emissionLabel(data.emissionType), ri + halfRW + 3, ry, valRW, { size: 7.5 });
    ry += rightRows[8];

    // ESTADO (mandatory field)
    wt(doc, 'ESTADO:', ri, ry, halfRW, { size: 7.5, bold: true, color: C_GREY });
    wt(doc, 'AUTORIZADO', ri + halfRW + 3, ry, valRW, { size: 7.5, bold: true });
    ry += rightRows[9];

    hline(doc, rx + 3, ry, RIGHT_W - 6);

    // CLAVE DE ACCESO
    wt(doc, 'CLAVE DE ACCESO', ri, ry + 2, rw, { size: 7, color: C_GREY });
    ry += rightRows[10];

    // Barcode
    const barBuf = await makeBarcodeBuffer(data.accessKey || '');
    if (barBuf) {
      doc.image(barBuf, ri, ry, { width: rw, height: 36 });
    }
    ry += rightRows[11];

    // Human-readable access key
    wt(doc, data.accessKey || '', ri, ry, rw, { size: 6, align: 'center', color: C_GREY });
  }

  return y + HEADER_H + 3;
}

// ─── Section 2: Buyer info ────────────────────────────────────────────────────
function drawBuyerSection(doc, data, y) {
  const P = 4;
  const issueDateStr = data.issueDate ? moment(data.issueDate).format('DD/MM/YYYY') : '';

  // Row heights
  const R1 = 16;  // Razón social row
  const R2 = 22;  // Identificación / Fecha / Placa / Guía row
  const R3 = 14;  // Dirección row
  const TOTAL = R1 + R2 + R3;

  strokeBox(doc, M, y, CW, TOTAL, C_DARK);
  hline(doc, M, y + R1, CW, C_DARK);
  hline(doc, M, y + R1 + R2, CW, C_DARK);

  // Row 1: Razón Social
  wt(doc, 'Razón Social / Nombres y Apellidos:', M + P, y + P, 168, { size: 7, color: C_GREY });
  wt(doc, data.buyerName || '', M + P + 170, y + P, CW - 176, { size: 8 });

  // Row 2: four equal sub-cells
  const CELL = Math.round(CW / 4);
  const r2y = y + R1;
  const cells = [
    { label: 'Identificación',     value: data.buyerId    || '' },
    { label: 'Fecha',              value: issueDateStr          },
    { label: 'Placa / Matrícula:', value: ''                    },
    { label: 'Guía',               value: ''                    },
  ];
  cells.forEach((c, i) => {
    const cx = M + i * CELL;
    if (i > 0) vline(doc, cx, r2y, R2 + R3, C_DARK);
    wt(doc, c.label, cx + P, r2y + 3, CELL - P * 2, { size: 6.5, color: C_GREY });
    wt(doc, c.value, cx + P, r2y + 12, CELL - P * 2, { size: 8 });
  });

  // Row 3: Dirección
  const r3y = y + R1 + R2;
  wt(doc, 'Dirección:', M + P, r3y + 3, 46, { size: 7, color: C_GREY });
  wt(doc, data.buyerAddress || '', M + P + 50, r3y + 3, CW - 58, { size: 7.5 });

  return y + TOTAL + 3;
}

// ─── Section 3: Line items table ─────────────────────────────────────────────
function drawItemsTable(doc, data, y) {
  const items = data.items || [];
  const P = 3;

  // Column definitions
  const COLS = [
    { label: 'Cod.\nPrincipal',      key: 'mainCode',    w: 44,  align: 'left'  },
    { label: 'Cod.\nAuxiliar',       key: 'auxCode',     w: 44,  align: 'left'  },
    { label: 'Cantidad',             key: 'quantity',    w: 38,  align: 'right' },
    { label: 'Descripción',          key: 'description', flex: true, align: 'left' },
    { label: 'Detalle\nAdicional',   key: 'detalle',     w: 68,  align: 'left'  },
    { label: 'Precio\nUnitario',     key: 'unitPrice',   w: 52,  align: 'right' },
    { label: 'Subsidio',             key: 'subsidio',    w: 36,  align: 'right' },
    { label: 'Precio sin\nSubsidio', key: 'sinSubs',     w: 52,  align: 'right' },
    { label: 'Descuento',            key: 'discount',    w: 40,  align: 'right' },
    { label: 'Precio\nTotal',        key: 'total',       w: 52,  align: 'right' },
  ];

  const fixedW = COLS.filter((c) => !c.flex).reduce((s, c) => s + c.w, 0);
  COLS.forEach((c) => { if (c.flex) c.w = CW - fixedW; });

  // Assign x positions
  let cx = M;
  COLS.forEach((c) => { c.x = cx; cx += c.w; });

  // Header
  const HDR_H = 22;
  fillBox(doc, M, y, CW, HDR_H, C_BG_HDR);
  COLS.forEach((c) => {
    wt(doc, c.label, c.x + P, y + 3, c.w - P * 2, { size: 6.5, bold: true, align: c.align });
    if (c.x > M) vline(doc, c.x, y, HDR_H, C_DARK);
  });
  strokeBox(doc, M, y, CW, HDR_H, C_DARK);
  y += HDR_H;

  // Rows
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const detalleEntries = Object.entries(item.detallesAdicionales || {});
    const detalleText    = detalleEntries.map(([k, v]) => `${k}: ${v}`).join('\n');
    const subtotal       = parseFloat(item.quantity  || 0) * parseFloat(item.unitPrice || 0)
                         - parseFloat(item.discount  || 0);

    const values = {
      mainCode:    item.mainCode    || '',
      auxCode:     item.auxCode     || '',
      quantity:    fmt(item.quantity),
      description: item.description || '',
      detalle:     detalleText,
      unitPrice:   fmt(item.unitPrice),
      subsidio:    '0.00',
      sinSubs:     '0.00',
      discount:    fmt(item.discount),
      total:       fmt(subtotal),
    };

    // Row height = tallest cell
    const descCol = COLS.find((c) => c.flex);
    const ROW_H = Math.max(
      14,
      ...COLS.map((c) => mh(doc, values[c.key] ?? '', c.w - P * 2, { size: 7.5 }) + 6)
    );

    if (i % 2 === 1) fillBox(doc, M, y, CW, ROW_H, C_BG_ALT);
    else             strokeBox(doc, M, y, CW, ROW_H, C_DARK);
    COLS.forEach((c) => {
      if (c.x > M) vline(doc, c.x, y, ROW_H, C_DARK);
      wt(doc, values[c.key] ?? '', c.x + P, y + 3, c.w - P * 2, { size: 7.5, align: c.align });
    });
    y += ROW_H;
  }

  return y + 3;
}

// ─── Section 4: Additional info + payments (left) / Tax totals (right) ───────
function drawBottomSection(doc, data, y) {
  const LEFT_W  = Math.round(CW * 0.54);
  const RIGHT_W = CW - LEFT_W;
  const lx = M;
  const rx = M + LEFT_W;
  const P  = 4;

  // additionalInfo is an array of {name, value} objects
  const addlEntries = Array.isArray(data.additionalInfo)
    ? data.additionalInfo.slice(0, 15)
    : [];
  const payments = data.payments || [];
  const totals   = buildTotalRows(data);

  const MIN_ROW  = 13;   // minimum row height in points
  const HDR_H    = 14;   // section header height

  // Column widths for adicional info (key | value)
  const KEY_W = Math.round(LEFT_W * 0.35);
  const VAL_W = LEFT_W - KEY_W - P * 3;

  // Column widths for payments (method label | amount)
  const PAY_VAL_W = 62;
  const PAY_LBL_W = LEFT_W - PAY_VAL_W;

  // Right column value/label widths
  const TVAL_W = 62;
  const TLBL_W = RIGHT_W - TVAL_W - P;

  // ── Pre-measure every row (values can wrap — must measure before sizing boxes) ──

  // Adicional: height = max(key height, value height) + padding
  const addlRowH = addlEntries.map((entry) => Math.max(
    MIN_ROW,
    mh(doc, `${entry.name}:`,    KEY_W - P,      { size: 7, bold: true }),
    mh(doc, String(entry.value), VAL_W,          { size: 7 })
  ) + 4);

  // Payments: height = max(method label height, amount height) + padding
  const payRowH = payments.map((p) => {
    const label = `${p.method} - ${(p.methodLabel || '').toUpperCase()}`;
    return Math.max(
      MIN_ROW,
      mh(doc, label,           PAY_LBL_W - P * 2, { size: 7 }),
      mh(doc, fmt(p.total),    PAY_VAL_W - P * 2, { size: 7 })
    ) + 4;
  });

  // Tax totals: height accounts for two-line labels (e.g. AHORRO POR SUBSIDIO)
  const totalRowH = totals.map((row) => Math.max(
    MIN_ROW,
    mh(doc, row.label, TLBL_W - P, { size: 7, bold: !!row.bold }),
    mh(doc, row.value, TVAL_W - P * 2, { size: 7, bold: !!row.bold })
  ) + 4);

  // Total heights for each column
  const addlBlockH = addlEntries.length > 0
    ? HDR_H + addlRowH.reduce((s, h) => s + h, 0)
    : 0;
  const payBlockH  = HDR_H + payRowH.reduce((s, h) => s + h, 0);
  const leftH      = addlBlockH + payBlockH;
  const rightH     = totalRowH.reduce((s, h) => s + h, 0);

  const SECTION_H  = Math.max(leftH, rightH);

  // ── Draw outer boxes (sized from measured heights) ────────────────────────
  strokeBox(doc, lx, y, LEFT_W,  SECTION_H, C_DARK);
  strokeBox(doc, rx, y, RIGHT_W, SECTION_H, C_DARK);

  // ── Left: Información Adicional ───────────────────────────────────────────
  let ly = y;

  if (addlEntries.length > 0) {
    fillBox(doc, lx, ly, LEFT_W, HDR_H, C_BG_HDR);
    wt(doc, 'Información Adicional', lx + P, ly + 3, LEFT_W - P * 2,
       { size: 7.5, bold: true, align: 'center' });
    ly += HDR_H;

    addlEntries.forEach((entry, i) => {
      const rh = addlRowH[i];
      hline(doc, lx, ly, LEFT_W, C_BORDER);
      wt(doc, `${entry.name}:`,    lx + P,          ly + 3, KEY_W - P, { size: 7, bold: true });
      wt(doc, String(entry.value), lx + KEY_W + P,  ly + 3, VAL_W,     { size: 7 });
      ly += rh;
    });
  }

  // ── Left: Forma de pago ───────────────────────────────────────────────────
  hline(doc, lx, ly, LEFT_W, C_DARK);
  fillBox(doc, lx, ly, LEFT_W, HDR_H, C_BG_HDR);
  wt(doc, 'Forma de pago', lx + P,          ly + 3, PAY_LBL_W - P,     { size: 7.5, bold: true });
  wt(doc, 'Valor',         lx + PAY_LBL_W + P, ly + 3, PAY_VAL_W - P * 2,
     { size: 7.5, bold: true, align: 'right' });
  vline(doc, lx + PAY_LBL_W, ly, HDR_H, C_DARK);
  ly += HDR_H;

  payments.forEach((p, i) => {
    const rh    = payRowH[i];
    const label = `${p.method} - ${(p.methodLabel || '').toUpperCase()}`;
    hline(doc, lx, ly, LEFT_W, C_BORDER);
    vline(doc, lx + PAY_LBL_W, ly, rh, C_DARK);
    wt(doc, label,        lx + P,           ly + 3, PAY_LBL_W - P * 2, { size: 7 });
    wt(doc, fmt(p.total), lx + PAY_LBL_W + P, ly + 3, PAY_VAL_W - P * 2,
       { size: 7, align: 'right' });
    ly += rh;
  });

  // ── Right: Tax totals ─────────────────────────────────────────────────────
  let ry = y;

  totals.forEach((row, i) => {
    const rh = totalRowH[i];
    if (row.fill) fillBox(doc, rx, ry, RIGHT_W, rh, C_BG_HDR);
    hline(doc, rx, ry, RIGHT_W, C_BORDER);
    vline(doc, rx + RIGHT_W - TVAL_W, ry, rh, C_DARK);
    wt(doc, row.label, rx + P,                    ry + 3, TLBL_W - P,
       { size: 7, bold: !!row.bold });
    wt(doc, row.value, rx + RIGHT_W - TVAL_W + P, ry + 3, TVAL_W - P * 2,
       { size: 7, bold: !!row.bold, align: 'right' });
    ry += rh;
  });

  return y + SECTION_H + 3;
}

// ─── SRI IVA rate code constants (mirrors cat_tax_rates, tax_code = '2') ─────
//
//  rate_code │ description       │ rate  │ bucket
//  ──────────┼───────────────────┼───────┼───────────────────────────────
//  '0'       │ 0%                │  0.00 │ SUBTOTAL 0%  (in IVA scope, zero-rated)
//  '2'       │ 15%               │ 15.00 │ SUBTOTAL 15% + IVA 15%
//  '3'       │ 14% (histórico)   │ 14.00 │ SUBTOTAL 14% + IVA 14%
//  '6'       │ No objeto de IVA  │  0.00 │ SUBTOTAL NO OBJETO DE IVA (outside IVA scope)
//  '7'       │ Exento de IVA     │  0.00 │ SUBTOTAL EXENTO DE IVA    (legally exempt)
//
// '0', '6', '7' all have rate=0 but represent DIFFERENT legal categories —
// they must never be merged. The rate_code is the authoritative classifier.
//
const RC_IVA_ZERO   = '0';  // zero-rated (0%) — still within IVA scope
const RC_NO_OBJETO  = '6';  // not subject to IVA — outside the taxable event
const RC_EXENTO     = '7';  // legally exempt from IVA

// Set of rate codes that do NOT generate a tax amount row
const NON_TAXABLE_RC = new Set([RC_IVA_ZERO, RC_NO_OBJETO, RC_EXENTO]);

// ─── Tax totals builder ───────────────────────────────────────────────────────
//
// In request_payload, each item.taxes[] entry has:
//   tax.code     — tax type  ('2'=IVA, '3'=ICE, '5'=IRBPNR)
//   tax.rateCode — rate code (see constants above)
//   tax.rate     — percentage value (0, 15, 14, …)
//
// Base and tax amounts are NOT pre-stored — computed here:
//   base   = qty × unitPrice − discount
//   taxAmt = base × rate / 100
//
// Row order (matches SRI official RIDE format):
//   SUBTOTAL {X}%            ← one per taxable IVA rate (15%, 14%…)
//   SUBTOTAL 0%
//   SUBTOTAL NO OBJETO DE IVA
//   SUBTOTAL EXENTO DE IVA
//   SUBTOTAL SIN IMPUESTOS   = sum of all IVA bases
//   TOTAL DESCUENTO
//   ICE
//   IVA {X}%                 ← one per taxable rate (actual tax amount)
//   IRBPNR
//   PROPINA
//   VALOR TOTAL              (bold)
//   VALOR TOTAL SIN SUBSIDIO
//   AHORRO POR SUBSIDIO
//
function buildTotalRows(data) {
  const items = data.items || [];

  // IVA accumulators keyed by rateCode
  const ivaBase = {};   // rateCode → cumulative pretax base
  const ivaAmt  = {};   // rateCode → cumulative tax amount
  const ivaDesc = {};   // rateCode → catalog description (e.g. '15%')

  let iceTotal    = 0;
  let irbpnrTotal = 0;
  let totalDisc   = 0;

  for (const item of items) {
    const qty   = parseFloat(item.quantity  || 0);
    const price = parseFloat(item.unitPrice || 0);
    const disc  = parseFloat(item.discount  || 0);
    const base  = qty * price - disc;   // pretax base for this line item
    totalDisc  += disc;

    for (const tax of item.taxes || []) {
      const taxCode  = String(tax.code);
      const rateCode = String(tax.rateCode);
      const rate     = parseFloat(tax.rate || 0);
      const taxAmt   = base * rate / 100;

      if (taxCode === '2') {
        // IVA — bucket by rateCode, not by rate value.
        // '0', '6', '7' all have rate=0 but go into separate rows.
        ivaBase[rateCode] = (ivaBase[rateCode] || 0) + base;
        ivaAmt[rateCode]  = (ivaAmt[rateCode]  || 0) + taxAmt;
        // Description comes from cat_tax_rates via taxDescriptions lookup
        ivaDesc[rateCode] = data.taxDescriptions[`2|${rateCode}`] || `${rate}%`;
      } else if (taxCode === '3') {
        iceTotal    += taxAmt;
      } else if (taxCode === '5') {
        irbpnrTotal += taxAmt;
      }
    }
  }

  // Rate codes that generate an actual IVA amount (non-zero rate, not exempt/no-object)
  const taxableRateCodes = Object.keys(ivaBase).filter(
    (rc) => !NON_TAXABLE_RC.has(rc)
  );

  // Named bucket values for the three zero-rate legal categories
  const subtotal0      = ivaBase[RC_IVA_ZERO]  || 0;
  const subtotalNoObj  = ivaBase[RC_NO_OBJETO]  || 0;
  const subtotalExento = ivaBase[RC_EXENTO]     || 0;

  // SUBTOTAL SIN IMPUESTOS = sum of ALL IVA bases regardless of category
  // = subtotal15% + subtotal0% + subtotalNoObj + subtotalExento + …
  const subtotalSinImp = Object.values(ivaBase).reduce((s, v) => s + v, 0);

  const propina = parseFloat(data.propina || 0);

  const rows = [];

  // One SUBTOTAL row per taxable rate (e.g. 15%, 14%)
  for (const rc of taxableRateCodes) {
    rows.push({ label: `SUBTOTAL ${ivaDesc[rc]}:`,  value: fmt(ivaBase[rc]) });
  }

  rows.push({ label: 'SUBTOTAL 0%:',                value: fmt(subtotal0)      });
  rows.push({ label: 'SUBTOTAL NO OBJETO DE IVA:',  value: fmt(subtotalNoObj)  });
  rows.push({ label: 'SUBTOTAL EXENTO DE IVA:',     value: fmt(subtotalExento) });
  rows.push({ label: 'SUBTOTAL SIN IMPUESTOS:',     value: fmt(subtotalSinImp) });
  rows.push({ label: 'TOTAL DESCUENTO:',            value: fmt(totalDisc)      });
  rows.push({ label: 'ICE:',                        value: fmt(iceTotal)       });

  // IVA amount rows sit between ICE and IRBPNR
  for (const rc of taxableRateCodes) {
    rows.push({ label: `IVA ${ivaDesc[rc]}:`,       value: fmt(ivaAmt[rc] || 0) });
  }

  rows.push({ label: 'IRBPNR:',                     value: fmt(irbpnrTotal)    });
  rows.push({ label: 'PROPINA:',                    value: fmt(propina)        });
  rows.push({ label: 'VALOR TOTAL:',                value: fmt(data.total), bold: true, fill: true });
  rows.push({ label: 'VALOR TOTAL SIN SUBSIDIO:',   value: '0.00'              });
  rows.push({ label: 'AHORRO POR SUBSIDIO:\n(Incluye IVA cuando corresponda)', value: '0.00' });

  return rows;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Build the RIDE PDF.
 * @param {object} rideData  assembled by ride.service.js
 * @returns {Promise<Buffer>}
 */
async function build(rideData) {
  const doc = new PDFDocument({
    size:        'A4',
    margins:     { top: M, bottom: M, left: M, right: M },
    bufferPages: true,
    info: {
      Title:   `RIDE - ${rideData.accessKey}`,
      Author:  rideData.businessName || '',
      Subject: 'Representación Impresa del Documento Electrónico',
    },
  });

  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  let y = M;
  y = await drawHeader(doc, rideData, y);
  y = drawBuyerSection(doc, rideData, y);
  y = drawItemsTable(doc, rideData, y);
  drawBottomSection(doc, rideData, y);

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

module.exports = { build };
