const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    const htmlPath = path.join(__dirname, 'report.html');
    const fileUrl = `file://${htmlPath}`;
    
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });
    
    await page.pdf({
        path: path.join(__dirname, 'GAS_COSTS_REPORT.pdf'),
        format: 'A4',
        margin: {
            top: '20mm',
            right: '20mm',
            bottom: '20mm',
            left: '20mm'
        },
        printBackground: true
    });
    
    await browser.close();
    console.log('✅ PDF créé: GAS_COSTS_REPORT.pdf');
})();







