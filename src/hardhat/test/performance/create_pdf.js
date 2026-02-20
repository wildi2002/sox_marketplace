const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
    try {
        console.log('🚀 Génération du PDF...');
        console.log('   Lancement du navigateur...');
        
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        const htmlPath = path.resolve(__dirname, 'report.html');
        const fileUrl = 'file://' + htmlPath;
        
        console.log('   Chargement du HTML...');
        await page.goto(fileUrl, { 
            waitUntil: 'networkidle0', 
            timeout: 30000 
        });
        
        const pdfPath = path.resolve(__dirname, 'GAS_COSTS_REPORT.pdf');
        console.log('   Génération du PDF...');
        
        await page.pdf({
            path: pdfPath,
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
        
        if (fs.existsSync(pdfPath)) {
            const stats = fs.statSync(pdfPath);
            console.log('');
            console.log('✅ PDF créé avec succès!');
            console.log('   Fichier:', pdfPath);
            console.log('   Taille:', (stats.size / 1024).toFixed(2), 'KB');
            console.log('');
        } else {
            console.log('❌ Erreur: Le fichier PDF n\'a pas été créé');
        }
    } catch (error) {
        console.error('❌ Erreur:', error.message);
        console.log('');
        console.log('💡 Alternative:');
        console.log('   1. Ouvrez report.html dans votre navigateur');
        console.log('   2. Imprimez en PDF (Cmd+P / Ctrl+P)');
        process.exit(1);
    }
})();
