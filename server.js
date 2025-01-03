const express = require('express');
const serveStatic = require('serve-static');
const path = require('path');

const app = express();

// Serve static files
app.use(serveStatic(path.join(__dirname)));

// Handle all routes by serving index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});