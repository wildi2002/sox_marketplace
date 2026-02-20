const fs = require('fs');
const { execSync } = require('child_process');

// Simple markdown to HTML converter with better table handling
function markdownToHtml(md) {
    let html = md;
    
    // Headers
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
    
    // Tables - handle properly
    html = html.replace(/\|(.+)\|/g, (match, content) => {
        if (content.includes('---')) return '';
        const cells = content.split('|').map(c => c.trim()).filter(c => c);
        return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
    });
    
    // Wrap tables
    html = html.replace(/(<tr>.*?<\/tr>\n?)+/g, (match) => {
        if (match.includes('<tr>')) {
            return '<table>' + match + '</table>';
        }
        return match;
    });
    
    // Code blocks
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Bold and italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    
    // Horizontal rules
    html = html.replace(/^---$/gim, '<hr>');
    
    // Paragraphs
    html = html.split('\n\n').map(p => {
        p = p.trim();
        if (p && !p.startsWith('<') && !p.match(/^#/)) {
            return '<p>' + p + '</p>';
        }
        return p;
    }).join('\n');
    
    return html;
}

// Read markdown
const md = fs.readFileSync('GAS_COSTS_REPORT.md', 'utf8');

// Convert to HTML
const htmlContent = markdownToHtml(md);

// Create full HTML document
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
console.log('📄 You can now:');
console.log('   1. Open report.html in a browser');
console.log('   2. Print to PDF (Cmd+P / Ctrl+P)');
console.log('   3. Or use: npx -y @md-to-pdf/cli report.html --as-html');







