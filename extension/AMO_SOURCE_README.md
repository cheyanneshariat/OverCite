OverCite Firefox source package

This archive contains the source used to build the Firefox extension package.

Build environment
- Operating system: macOS or Linux
- Node.js: 20+ recommended
- npm: 10+ recommended

Build steps
1. Change into the extension directory:
   cd extension
2. Install dependencies:
   npm install
3. Run the browser build:
   npm run build

Build output
- The Firefox package is generated in:
  dist/firefox/

Packaging
- To reproduce the Firefox upload ZIP, create an archive from the contents of dist/firefox so that manifest.json is at the ZIP root.

Notes
- The extension source is plain JavaScript and HTML.
- The build step copies the source files and browser-specific manifest into dist/chrome and dist/firefox.
