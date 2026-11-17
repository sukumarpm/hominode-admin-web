import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { DetailedFinancialReport, DetailedFinancialReportRow } from './actions';

type ReportMode = 'all' | 'individual';
type ReportFilters = { from: string; to: string; duesOnly: boolean; category: string; search: string; privacySafe: boolean };

export interface FinancialPdfInput {
  report: DetailedFinancialReport;
  rows: DetailedFinancialReportRow[];
  mode: ReportMode;
  communityName: string;
  generatedAt: Date;
  timeZone: string;
  filters: ReportFilters;
  logoDataUrl?: string;
}

export interface FinancialPdfResult {
  blob: Blob;
  pageCount: number;
}

function inrValue(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('Report contains an invalid INR amount.');
  const amount = BigInt(minor);
  const rupees = (amount / 100n).toLocaleString('en-IN');
  const paise = (amount % 100n).toString().padStart(2, '0');
  return `${rupees}.${paise}`;
}

const inr = (minor: number) => `INR ${inrValue(minor)}`;

function formatTimestamp(date: Date, timeZone: string): string {
  try {
    return `${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date)} (${timeZone})`;
  } catch {
    return `${date.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
  }
}

function sumMinor(values: number[]): number {
  const total = values.reduce((sum, value) => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Report contains an invalid INR amount.');
    return sum + BigInt(value);
  }, 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Report total exceeds the supported INR range.');
  return Number(total);
}

function displayLabel(value: string): string {
  const known: Record<string, string> = {
    corpus_fund: 'Corpus Fund',
    partially_paid: 'Partially Paid',
    maintenance: 'Maintenance',
    parking: 'Parking',
    bank_transfer: 'Bank Transfer',
    upi: 'UPI',
  };
  return known[value.toLowerCase()] || value.replaceAll(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function createFinancialReportPdf(input: FinancialPdfInput): Promise<FinancialPdfResult> {
  const { report, rows, mode, communityName, generatedAt, timeZone, filters } = input;
  const doc = new jsPDF({ orientation: mode === 'all' || filters.privacySafe ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true });
  // The approved RGB logo has no alpha channel; this navy matches its background.
  const navy: [number, number, number] = [1, 5, 20];
  const teal: [number, number, number] = [130, 226, 221];
  const bodyNavy: [number, number, number] = [18, 45, 78];
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;
  const title = mode === 'individual' ? 'Resident Statement' : 'Community Dues Register';
  const period = `${filters.from || 'All history'} to ${filters.to || 'Present'}`;
  const flatBills = rows.flatMap((resident) => resident.bills.map((bill) => ({ resident, bill })));
  const billed = sumMinor(flatBills.map(({ bill }) => bill.amountMinor));
  const allocated = sumMinor(flatBills.map(({ bill }) => bill.paidMinor));
  const credits = sumMinor(flatBills.map(({ bill }) => bill.creditAppliedMinor || 0));
  const outstanding = sumMinor(flatBills.map(({ bill }) => bill.outstandingMinor));
  const availableCredit = sumMinor(rows.map((resident) => resident.availableCreditMinor));

  // Full-width brand bar. The official RGB logo's square artwork is aspect-fit
  // inside its slot rather than stretched or cropped.
  const headerHeight = 42;
  doc.setFillColor(...navy);
  doc.rect(0, 0, pageWidth, headerHeight, 'F');
  const logoSlot = 30;
  const logoX = margin;
  const logoY = (headerHeight - logoSlot) / 2;
  let logoWidth = 0;
  let logoHeight = 0;
  if (input.logoDataUrl) {
    const imageSize = doc.getImageProperties(input.logoDataUrl);
    const scale = Math.min(logoSlot / imageSize.width, logoSlot / imageSize.height);
    logoWidth = imageSize.width * scale;
    logoHeight = imageSize.height * scale;
    doc.addImage(input.logoDataUrl, 'PNG', logoX + (logoSlot - logoWidth) / 2, logoY + (logoSlot - logoHeight) / 2, logoWidth, logoHeight);
  }
  const leftX = margin + logoSlot + 5;
  const rightX = pageWidth - margin;
  const rightWidth = Math.min(92, pageWidth * 0.42);
  const leftWidth = Math.max(44, rightX - rightWidth - leftX - 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(mode === 'individual' ? 14 : 16);
  doc.setTextColor(255, 255, 255);
  doc.text(title, leftX, 16, { maxWidth: leftWidth });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(mode === 'individual' ? 9 : 10);
  doc.setTextColor(...teal);
  doc.text(communityName || 'Community', leftX, mode === 'individual' ? 23 : 25, { maxWidth: leftWidth });
  doc.setFontSize(7.5);
  doc.setTextColor(205, 217, 228);
  doc.text(`Community ID: ${report.communityId}`, leftX, mode === 'individual' ? 30 : 32, { maxWidth: leftWidth });
  doc.setFontSize(8);
  doc.setTextColor(240, 245, 250);
  doc.text(`Reporting period: ${period}`, rightX, 14, { align: 'right', maxWidth: rightWidth });
  doc.text(`Generated: ${formatTimestamp(generatedAt, timeZone)}`, rightX, 23, { align: 'right', maxWidth: rightWidth });
  doc.setTextColor(...teal);
  doc.text(`Community timezone: ${timeZone}`, rightX, 32, { align: 'right', maxWidth: rightWidth });

  let bodyY = headerHeight + 6;
  if (mode === 'all') {
    const filterText = [filters.from && `From ${filters.from}`, filters.to && `To ${filters.to}`, filters.duesOnly && 'Outstanding only', filters.category !== 'all' && `Category ${displayLabel(filters.category)}`, filters.search && (filters.privacySafe ? 'Resident/unit search applied' : `Search ${filters.search}`)].filter(Boolean).join(' · ') || 'All accounts and charges';
    doc.setFillColor(242, 246, 249);
    doc.roundedRect(margin, bodyY, pageWidth - margin * 2, 11, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...bodyNavy);
    doc.text('APPLIED FILTERS', margin + 3, bodyY + 4);
    doc.setFont('helvetica', 'normal');
    doc.text(filterText, margin + 3, bodyY + 8.2, { maxWidth: pageWidth - margin * 2 - 6 });
    bodyY += 15;
  } else if (mode === 'individual' && !filters.privacySafe) {
    const resident = rows[0];
    doc.setFillColor(242, 246, 249);
    doc.roundedRect(margin, bodyY, pageWidth - margin * 2, 13, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...bodyNavy);
    doc.text(`${resident?.identity.name || 'Resident'}${resident?.identity.deleted ? ' (Deleted account)' : ''}`, margin + 3, bodyY + 5.2, { maxWidth: pageWidth - margin * 2 - 6 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Unit ${resident?.identity.unit || 'unavailable'}${resident?.identity.phone ? ` · ${resident.identity.phone}` : ''}`, margin + 3, bodyY + 10, { maxWidth: pageWidth - margin * 2 - 6 });
    bodyY += 17;
  }

  const summaryY = bodyY;
  const summaryHeight = filters.privacySafe ? 13 : 17;
  const summaryWidth = (pageWidth - margin * 2 - 8) / (filters.privacySafe ? 1 : 5);
  const summaryItems = filters.privacySafe
    ? [['Current dues', inr(outstanding)]]
    : [['Total billed', inr(billed)], ['Payments allocated', inr(allocated)], ['Credit applied', inr(credits)], ['Available credit', inr(availableCredit)], ['Current outstanding', inr(outstanding)]];
  summaryItems.forEach(([label, value], index) => {
    const x = margin + index * (summaryWidth + (filters.privacySafe ? 0 : 2));
    doc.setFillColor(index === summaryItems.length - 1 ? 232 : 242, index === summaryItems.length - 1 ? 242 : 246, index === summaryItems.length - 1 ? 244 : 249);
    doc.setDrawColor(208, 218, 226);
    doc.roundedRect(x, summaryY, summaryWidth, summaryHeight, 1.2, 1.2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(75, 91, 106);
    doc.text(label, x + 2, summaryY + 4.3, { maxWidth: summaryWidth - 4 });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(filters.privacySafe ? 9 : 8.5);
    doc.setTextColor(...bodyNavy);
    doc.text(value, x + 2, summaryY + 11.5, { maxWidth: summaryWidth - 4 });
  });
  bodyY += summaryHeight + 4;

  const disclosureLines = [
    'Current balances are as of report generation. Selected dates filter bills by creation date; historical cutoff balances are not reconstructed.',
    ...(report.coverageWarnings || []),
  ];
  const disclosureText = doc.splitTextToSize(disclosureLines.join('  '), pageWidth - margin * 2 - 8);
  const disclosureHeight = Math.max(9, disclosureText.length * 3.5 + 4);
  doc.setFillColor(247, 248, 250);
  doc.roundedRect(margin, bodyY, pageWidth - margin * 2, disclosureHeight, 1.2, 1.2, 'F');
  doc.setFillColor(report.coverageWarnings?.length ? 193 : 20, report.coverageWarnings?.length ? 124 : 113, report.coverageWarnings?.length ? 56 : 120);
  doc.rect(margin, bodyY, 1.2, disclosureHeight, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(76, 88, 99);
  doc.text(disclosureText, margin + 4, bodyY + 4.5);
  let tableStart = bodyY + disclosureHeight + 5;

  if (mode === 'all' || filters.privacySafe) {
    if (filters.privacySafe) {
      autoTable(doc, {
        startY: tableStart,
        head: [['Unit', 'Charge category', 'Billing period', 'Dues amount (INR)']],
        body: flatBills.map(({ resident, bill }) => [resident.identity.unit || '—', bill.chargeCategory || 'Other / Unclassified', bill.billingPeriod, inrValue(bill.outstandingMinor)]),
        theme: 'grid', margin: { left: margin, right: margin, bottom: 16 }, showHead: 'everyPage', rowPageBreak: 'avoid',
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.2, overflow: 'linebreak', textColor: [35, 45, 55], lineColor: [195, 204, 212] },
        headStyles: { fillColor: navy, textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 248, 250] },
        columnStyles: { 3: { halign: 'right', cellWidth: 32 } },
      });
    } else {
      autoTable(doc, {
        startY: tableStart,
        head: [['Unit', 'Resident / account', 'Category', 'Bill description', 'Period', 'Billed INR', 'Allocated INR', 'Credit INR', 'Outstanding INR', 'Status']],
        body: flatBills.map(({ resident, bill }) => [resident.identity.unit || '—', `${resident.identity.name || resident.residentId}${resident.identity.deleted ? ' (Deleted)' : ''}`, displayLabel(bill.chargeCategory || 'Other / Unclassified'), bill.description, bill.billingPeriod, inrValue(bill.amountMinor), inrValue(bill.paidMinor), inrValue(bill.creditAppliedMinor || 0), inrValue(bill.outstandingMinor), bill.status === 'overdue' ? 'Overdue' : bill.status === 'partially_paid' ? displayLabel(bill.status) : bill.outstandingMinor > 0 ? 'Outstanding' : 'Paid']),
        theme: 'grid', margin: { left: margin, right: margin, bottom: 16 }, showHead: 'everyPage', rowPageBreak: 'avoid',
        styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.8, overflow: 'linebreak', textColor: [35, 45, 55], lineColor: [195, 204, 212] },
        headStyles: { fillColor: navy, textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 248, 250] },
        columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
      });
    }
  } else {
    autoTable(doc, {
      startY: tableStart,
      head: [['Charge category', 'Description', 'Billing period', 'Billed INR', 'Allocated INR', 'Credit INR', 'Outstanding INR', 'Status']],
      body: flatBills.map(({ bill }) => [displayLabel(bill.chargeCategory || 'Other / Unclassified'), bill.description, bill.billingPeriod, inrValue(bill.amountMinor), inrValue(bill.paidMinor), inrValue(bill.creditAppliedMinor || 0), inrValue(bill.outstandingMinor), displayLabel(bill.status)]),
      theme: 'grid', margin: { left: margin, right: margin, bottom: 16 }, showHead: 'everyPage', rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, overflow: 'linebreak', textColor: [35, 45, 55], lineColor: [195, 204, 212] },
      headStyles: { fillColor: navy, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 248, 250] },
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    });
    const allocationRows = flatBills.flatMap(({ bill }) => bill.settlements.map((payment) => [bill.billId, payment.transactionId, inrValue(payment.amountMinor), payment.method, payment.reference || '—', formatTimestamp(new Date(payment.receivedAtMs), timeZone)]));
    const afterBills = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? tableStart + 10;
    autoTable(doc, {
      startY: afterBills + 8, head: [['Bill ID', 'Transaction ID', 'Allocated INR', 'Method', 'Reference', 'Received at']],
      body: allocationRows, theme: 'grid', margin: { left: margin, right: margin, bottom: 16 }, showHead: 'everyPage', rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, overflow: 'linebreak', textColor: [35, 45, 55], lineColor: [195, 204, 212] },
      headStyles: { fillColor: navy, textColor: [255, 255, 255], fontStyle: 'bold' },
    });
    const afterAllocations = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? afterBills + 8;
    const resident = rows[0];
    const receiptRows = resident?.payments.map((payment) => [payment.transactionId, inrValue(payment.receivedAmountMinor), inrValue(payment.amountMinor), payment.method, payment.reference || '—', formatTimestamp(new Date(payment.receivedAtMs), timeZone)]) ?? [];
    autoTable(doc, {
      startY: afterAllocations + 8, head: [['Transaction ID', 'Receipt INR', 'Allocated to selected bills INR', 'Method', 'Reference', 'Received at']],
      body: receiptRows, theme: 'grid', margin: { left: margin, right: margin, bottom: 16 }, showHead: 'everyPage', rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, overflow: 'linebreak', textColor: [35, 45, 55], lineColor: [195, 204, 212] },
      headStyles: { fillColor: teal, textColor: [255, 255, 255], fontStyle: 'bold' },
    });
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(80, 90, 100);
    doc.text(`${communityName || 'Community'} · ${period}`, margin, doc.internal.pageSize.getHeight() - 7);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 7, { align: 'right' });
  }
  return { blob: await doc.output('blob'), pageCount };
}
