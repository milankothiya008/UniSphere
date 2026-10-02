const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { env } = require("../config/env");
const { formatDate } = require("./CampusTime");

// PDF documents students download: certificates and the participation record. Built-in fonts only, so
// nothing has to be fetched or installed on the server.

const NAVY = "#1b2a6b";
const GOLD = "#c89211";
const INK = "#1d2333";
const MUTED = "#6b7285";

/** Renders a PDFKit document into a Buffer. draw(doc) does the drawing. */
const renderPdf = (options, draw) =>
    new Promise((resolve, reject) => {
        const doc = new PDFDocument({ ...options, info: { Producer: "CampusConnect", Creator: "CampusConnect", ...(options.info || {}) } });
        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
        Promise.resolve(draw(doc))
            .then(() => doc.end())
            .catch(reject);
    });

const dateRange = (start, end) => (formatDate(start) === formatDate(end) ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`);

/** A4 landscape certificate with a verification QR code. */
const certificatePdf = async (certificate, { president = null, mentor = null } = {}) => {
    const verifyUrl = `${env.clientUrl.replace(/\/$/, "")}/verify/${certificate.code}`;
    const qr = await QRCode.toBuffer(verifyUrl, { margin: 0, width: 220, color: { dark: NAVY, light: "#ffffff" } });
    const merit = certificate.kind === "MERIT";

    return renderPdf({ size: "A4", layout: "landscape", margin: 0, info: { Title: `${certificate.recipientName} — ${certificate.eventTitle}` } }, (doc) => {
        const { width, height } = doc.page;
        doc.rect(0, 0, width, height).fill("#fffdf8");
        doc.lineWidth(4).strokeColor(NAVY).rect(22, 22, width - 44, height - 44).stroke();
        doc.lineWidth(1).strokeColor(GOLD).rect(32, 32, width - 64, height - 64).stroke();
        // Corner accents.
        [
            [32, 32],
            [width - 32, 32],
            [32, height - 32],
            [width - 32, height - 32]
        ].forEach(([x, y]) => doc.circle(x, y, 5).fill(GOLD));

        doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(10).text(env.universityName.toUpperCase(), 0, 62, { width, align: "center", characterSpacing: 2 });
        doc.fillColor(NAVY).font("Helvetica").fontSize(11).text(certificate.clubName, 0, 80, { width, align: "center" });

        doc.fillColor(NAVY).font("Times-Bold").fontSize(40).text(merit ? "Certificate of Merit" : "Certificate of Participation", 0, 118, { width, align: "center" });
        doc.moveTo(width / 2 - 70, 170).lineTo(width / 2 + 70, 170).lineWidth(2).strokeColor(GOLD).stroke();

        doc.fillColor(INK).font("Times-Italic").fontSize(16).text("This is to certify that", 0, 192, { width, align: "center" });
        doc.fillColor(NAVY).font("Times-Bold").fontSize(34).text(certificate.recipientName, 60, 218, { width: width - 120, align: "center" });

        const when = dateRange(certificate.eventStartAt, certificate.eventEndAt);
        const team = certificate.teamName ? ` as part of team “${certificate.teamName}”` : "";
        const body = merit
            ? `has been awarded ${certificate.awardTitle}${team} at ${certificate.eventTitle}, organised by ${certificate.clubName} on ${when}.`
            : `has successfully participated${team} in ${certificate.eventTitle}, organised by ${certificate.clubName} on ${when}.`;
        doc.fillColor(INK).font("Times-Roman").fontSize(16).text(body, 110, 270, { width: width - 220, align: "center", lineGap: 4 });

        // Signatures.
        const signY = height - 140;
        const signature = (x, name, role) => {
            doc.moveTo(x, signY).lineTo(x + 190, signY).lineWidth(0.8).strokeColor(MUTED).stroke();
            doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(name || " ", x, signY + 8, { width: 190, align: "center" });
            doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(role, x, signY + 24, { width: 190, align: "center" });
        };
        signature(90, president, `President, ${certificate.clubName}`);
        signature(width - 280, mentor, "Faculty mentor");

        // Verification.
        const qrSize = 74;
        doc.image(qr, width / 2 - qrSize / 2, signY - 46, { width: qrSize });
        doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`Verify: ${verifyUrl}`, 0, signY + 34, { width, align: "center" });
        doc.text(`Certificate ID ${certificate.code} · Issued ${formatDate(certificate.issuedAt)}`, 0, signY + 46, { width, align: "center" });
    });
};

/** A simple multi-page table helper for the participation record. */
const table = (doc, { x, columns, rows, empty }) => {
    const rowHeight = (row) => Math.max(...columns.map((column, index) => doc.heightOfString(String(row[index] ?? ""), { width: column.width - 8 }))) + 10;
    const header = () => {
        let cx = x;
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(MUTED);
        const y = doc.y;
        columns.forEach((column) => {
            doc.text(column.label.toUpperCase(), cx + 4, y, { width: column.width - 8, characterSpacing: 0.5 });
            cx += column.width;
        });
        doc.y = y + 16;
        doc.moveTo(x, doc.y - 3).lineTo(x + columns.reduce((sum, column) => sum + column.width, 0), doc.y - 3).lineWidth(0.6).strokeColor("#d8dce6").stroke();
    };
    if (!rows.length) {
        doc.font("Helvetica-Oblique").fontSize(10).fillColor(MUTED).text(empty, x, doc.y);
        doc.moveDown(0.8);
        return;
    }
    header();
    rows.forEach((row) => {
        doc.font("Helvetica").fontSize(9.5);
        const h = rowHeight(row);
        if (doc.y + h > doc.page.height - 60) {
            doc.addPage();
            header();
        }
        const y = doc.y;
        let cx = x;
        columns.forEach((column, index) => {
            doc.fillColor(index === 0 ? INK : "#2f3647").font(column.bold ? "Helvetica-Bold" : "Helvetica").text(String(row[index] ?? ""), cx + 4, y + 4, { width: column.width - 8 });
            cx += column.width;
        });
        doc.y = y + h;
        doc.moveTo(x, doc.y).lineTo(cx, doc.y).lineWidth(0.4).strokeColor("#eceef3").stroke();
    });
    doc.moveDown(1);
};

module.exports = { renderPdf, certificatePdf, table, dateRange, NAVY, GOLD, INK, MUTED };
