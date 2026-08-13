import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// CORS atbalsts
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Statiskie faili
app.use(express.static(path.join(__dirname, 'public')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

// ==========================================
// TURBO STARPNIEKS
// ==========================================
app.use('/v1', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
    try {
        const turboPath = '/v1' + req.url;
        
        let turboBaseUrl = 'https://upload.services.ar-io.dev';
        if (
            turboPath.includes('/balance') ||
            turboPath.includes('/costs') ||
            turboPath.includes('/topup') ||
            turboPath.includes('/info') ||
            turboPath.includes('/currencies') ||
            turboPath.includes('/pricing')
        ) {
            turboBaseUrl = 'https://payment.services.ar-io.dev';
        }
        
        const turboUrl = `${turboBaseUrl}${turboPath}`;
        console.log(`Starpnieks: ${req.method} ${turboUrl}`);
        
        const forwardHeaders = {};
        for (const [key, value] of Object.entries(req.headers)) {
            if (!['host', 'connection'].includes(key.toLowerCase())) {
                forwardHeaders[key] = value;
            }
        }
        forwardHeaders['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
        
        const fetchOptions = {
            method: req.method,
            headers: forwardHeaders
        };
        
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Buffer.isBuffer(req.body)) {
            fetchOptions.body = req.body;
        }
        
        const response = await fetch(turboUrl, fetchOptions);
        const data = await response.text();
        
        if (!response.ok) {
            console.error(`Ar-IO kļūda [${response.status}]: ${data}`);
        }
        
        const contentType = response.headers.get('content-type');
        if (contentType) res.setHeader('content-type', contentType);
        
        res.status(response.status).send(data);
    } catch (e) {
        console.error('Starpnieka kļūda:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Visas lapas novirza uz storage-pay.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'storage-pay.html'));
});

app.listen(PORT, () => console.log(`PermRepo serveris klausās uz porta ${PORT}`));
