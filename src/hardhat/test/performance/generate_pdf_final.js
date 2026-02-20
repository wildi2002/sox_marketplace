const fs = require('fs');
const { execSync } = require('child_process');

// Read markdown
const md = fs.readFileSync('GAS_COSTS_REPORT.md', 'utf8');

// Simple but effective markdown to HTML converter
function markdownToHtml(md) {
    let html = md;
    
    // Headers
    html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // Code blocks (do before inline code)
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    
    // Inline code
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    
    // Italic
    html = html.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
    
    // Horizontal rules
    html = html.replace(/^---$/gim, '<hr>');
    
    // Tables - more robust handling
    const lines = html.split('\n');
    let inTable = false;
    let tableRows = [];
    let result = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
            if (!inTable) {
                inTable = true;
                tableRows = [];
            }
            
            // Skip separator rows
            if (trimmed.match(/\|[\s-:]+\|/)) {
                continue;
            }
            
            const cells = trimmed.split('|')
                .map(c => c.trim())
                .filter(c => c);
            
            if (cells.length > 0) {
                tableRows.push(cells);
            }
        } else {
            if (inTable && tableRows.length > 0) {
                // Close table
                let tableHtml = '<table>\n';
                tableRows.forEach((row, idx) => {
                    const tag = idx === 0 ? 'th' : 'td';
                    tableHtml += '<tr>' + row.map(cell => `<${tag}>${cell}</${tag}>`).join('') + '</tr>\n';
                });
                tableHtml += '</table>';
                result.push(tableHtml);
                tableRows = [];
                inTable = false;
            }
            result.push(line);
        }
    }
    
    // Handle table at end of file
    if (inTable && tableRows.length > 0) {
        let tableHtml = '<table>\n';
        tableRows.forEach((row, idx) => {
            const tag = idx === 0 ? 'th' : 'td';
            tableHtml += '<tr>' + row.map(cell => `<${tag}>${cell}</${tag}>`).join('') + '</tr>\n';
        });
        tableHtml += '</table>';
        result.push(tableHtml);
    }
    
    html = result.join('\n');
    
    // Lists
    html = html.replace(/^\* (.+)$/gim, '<li>$1</li>');
    html = html.replace(/^(\d+)\. (.+)$/gim, '<li>$2</li>');
    
    // Wrap consecutive list items
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
        return '<ul>' + match + '</ul>';
    });
    
    // Paragraphs (lines that don't start with HTML tags)
    html = html.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('<')) return line;
        if (trimmed.match(/^[#\*\-]/)) return line;
        return '<p>' + trimmed + '</p>';
    }).join('\n');
    
    return html;
}

// Convert markdown to HTML
const htmlContent = markdownToHtml(md);

// Create full HTML document with styling
const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>SOX Protocol Gas Cost Measurements</title>
    <style>
        @page {
            margin: 2cm;
            size: A4;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 100%;
        }
        h1 {
            color: #2c3e50;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
            page-break-after: avoid;
        }
        h2 {
            color: #34495e;
            border-bottom: 2px solid #ecf0f1;
            padding-bottom: 8px;
            margin-top: 30px;
            page-break-after: avoid;
        }
        h3 {
            color: #555;
            margin-top: 25px;
            page-break-after: avoid;
        }
        h4 {
            color: #666;
            margin-top: 20px;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 20px 0;
            page-break-inside: avoid;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 12px;
            text-align: left;
        }
        th {
            background-color: #3498db;
            color: white;
            font-weight: bold;
        }
        tr:nth-child(even) {
            background-color: #f9f9f9;
        }
        code {
            background-color: #f4f4f4;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: "Courier New", monospace;
            font-size: 0.9em;
        }
        pre {
            background-color: #f4f4f4;
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
            page-break-inside: avoid;
        }
        pre code {
            background: none;
            padding: 0;
        }
        blockquote {
            border-left: 4px solid #3498db;
            margin: 20px 0;
            padding-left: 20px;
            color: #555;
        }
        strong {
            color: #2c3e50;
        }
        hr {
            border: none;
            border-top: 2px solid #ecf0f1;
            margin: 30px 0;
        }
        p {
            margin: 10px 0;
        }
        ul, ol {
            margin: 10px 0;
            padding-left: 30px;
        }
        li {
            margin: 5px 0;
        }
    </style>
</head>
<body>
${htmlContent}
</body>
</html>`;

fs.writeFileSync('report.html', html);
console.log('✅ HTML created: report.html');

// Try to generate PDF using puppeteer if available
try {
    const puppeteer = require('puppeteer');
    (async () => {
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        await page.goto(`file://${process.cwd()}/report.html`, { waitUntil: 'networkidle0' });
        await page.pdf({
            path: 'GAS_COSTS_REPORT.pdf',
            format: 'A4',
            margin: {
                top: '20mm',
                right: '20mm',
                bottom: '20mm',
                left: '20mm'
            }
        });
        await browser.close();
        console.log('✅ PDF created: GAS_COSTS_REPORT.pdf');
    })();
} catch (e) {
    console.log('⚠️  Puppeteer not available. Please:');
    console.log('   1. Open report.html in your browser');
    console.log('   2. Print to PDF (Cmd+P / Ctrl+P)');
    console.log('   3. Or install puppeteer: npm install puppeteer');
}







