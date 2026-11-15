// Uses the barcode writer/reader already installed by Expo's web camera tooling; no new dependency.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const load = createRequire(path.join(root, 'mobile/package.json'));
const writer = load('zxing-wasm/writer');
const reader = load('zxing-wasm/reader');
const labels = [
  ['EE987654321IN', 'India Post'],
  ['D87654321', 'DTDC'],
  ['FMPP9876543210', 'Ekart'],
  ['SF1234567890', 'Shadowfax'],
];

async function main() {
  const output = path.join(root, 'docs/test-labels');
  fs.mkdirSync(output, { recursive: true });
  for (const [kind, module] of [
    ['writer', writer],
    ['reader', reader],
  ]) {
    module.prepareZXingModule({
      overrides: { wasmBinary: fs.readFileSync(load.resolve(`zxing-wasm/${kind}/zxing_${kind}.wasm`)) },
    });
  }
  const cards = [];
  for (const [awb, carrier] of labels) {
    const barcode = await writer.writeBarcode(awb, { format: 'Code128', scale: 3, addQuietZones: true });
    if (barcode.error || !barcode.image) throw Error(`${awb}: ${barcode.error || 'No barcode image'}`);
    const decoded = await reader.readBarcodes(new Uint8Array(await barcode.image.arrayBuffer()));
    if (decoded.length !== 1 || decoded[0].text !== awb) throw Error(`Barcode round-trip failed for ${awb}`);
    fs.writeFileSync(path.join(output, `${awb}.svg`), barcode.svg);
    cards.push(
      `<article><header><strong>SMART MAILROOM</strong><span>TEST LABEL ${cards.length + 1}</span></header><h2>${carrier}</h2><p>Recipient: Test Member<br>Destination: College mailroom<br>Shelf suggestion: A1</p><img src="${awb}.svg" alt="Code 128 barcode encoding ${awb}"><div class="awb">${awb}</div><footer>SYNTHETIC TEST DATA · NOT A REAL SHIPMENT</footer></article>`,
    );
    console.log(`PASS: Code 128 decoded as ${awb}`);
  }
  fs.writeFileSync(
    path.join(output, 'labels.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Smart Mailroom barcode test labels</title><style>
  *{box-sizing:border-box}body{font:16px Arial,sans-serif;color:#111;background:#eee;margin:0;padding:24px}main{max-width:760px;margin:auto}.instructions{background:white;padding:20px;margin-bottom:20px}h1{font-size:24px;margin-top:0}.grid{display:grid;grid-template-columns:1fr;gap:18px}article{background:white;border:2px solid #111;padding:22px;break-inside:avoid}header{display:flex;justify-content:space-between;border-bottom:1px solid #111;padding-bottom:12px;font-size:12px}h2{font-size:22px;margin-bottom:8px}p{line-height:1.5}img{display:block;width:100%;height:100px;object-fit:contain;background:white;margin:20px auto 8px;image-rendering:pixelated}.awb{text-align:center;font:bold 22px monospace;letter-spacing:2px}footer{font-size:11px;text-align:center;margin-top:16px}button{padding:10px 20px;cursor:pointer}@page{size:A4;margin:12mm}@media print{body{background:white;padding:0}.instructions{display:none}.grid{gap:8mm}article{height:118mm;padding:6mm}img{height:27mm}article:nth-child(2n){break-after:page}}
  </style></head><body><main><section class="instructions"><h1>Scan these labels with the operator app</h1><p>Add the AWB as a request in your test member account, then sign in as operator on your phone and choose <strong>Scan barcode</strong>. Point the camera at one barcode on this screen or print this page at 100% scale.</p><p>The barcode contains only the AWB printed below it. Recipient text is synthetic; no label details are read automatically. Use request matching, and leave phone/email blank unless you deliberately want to test contact matching. Existing AWBs may show a duplicate warning.</p><p>No requests or parcels are created by this page.</p><button onclick="window.print()">Print labels</button></section><section class="grid">${cards.join('')}</section></main></body></html>`,
  );
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
