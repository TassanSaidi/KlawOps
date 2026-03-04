export function getStandaloneHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KlawOps</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #09090b; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>window.__KLAWOPS_STANDALONE__ = true;</script>
  <script src="/webview/unified.js"></script>
</body>
</html>`;
}
