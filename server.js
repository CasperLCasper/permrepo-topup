import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// CORS atbalsts (atļauj pieprasījumus no pārlūka)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

// ==========================================
// TURBO STARPNIEKS (izlabots)
// ==========================================

app.use('/api/turbo', async (req, res) => {
    try {
        const turboPath = req.path;
        const queryString = new URLSearchParams(req.query).toString();
        
        // Izvēlamies pareizo Turbo vārteju
        let turboBaseUrl;
        if (
            turboPath.includes('/balance') ||
            turboPath.includes('/costs') ||
            turboPath.includes('/topup') ||
            turboPath.includes('/info') ||
            turboPath.includes('/currencies') ||
            turboPath.includes('/pricing')
        ) {
            turboBaseUrl = 'https://payment.services.ar-io.dev';
        } else {
            turboBaseUrl = 'https://upload.services.ar-io.dev';
        }
        
        const turboUrl = `${turboBaseUrl}${turboPath}${queryString ? '?' + queryString : ''}`;
        
        console.log(`Starpnieks: ${req.method} ${turboUrl}`);
        
        // Kopējam visus svarīgos ienākošos headerus no SDK
        const forwardHeaders = {};
        for (const [key, value] of Object.entries(req.headers)) {
            // Izlaižam headerus, kas var sabojāt savienojumu ar Ar-IO
            if (!['host', 'connection', 'content-length'].includes(key.toLowerCase())) {
                forwardHeaders[key] = value;
            }
        }

        // Pievienojam reālu User-Agent, lai Cloudflare nenobloķētu Render IP
        forwardHeaders['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

        const fetchOptions = {
            method: req.method,
            headers: forwardHeaders
        };
        
        // Apstrādājam kermeņa (body) pārsūtīšanu POST / PUT gadījumā
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            if (Buffer.isBuffer(req.body)) {
                fetchOptions.body = req.body;
            } else if (typeof req.body === 'object' && Object.keys(req.body).length > 0) {
                fetchOptions.body = JSON.stringify(req.body);
            }
        }
        
        const response = await fetch(turboUrl, fetchOptions);
        
        const contentType = response.headers.get('content-type');
        let data;
        
        if (contentType && contentType.includes('json')) {
            data = await response.json();
        } else {
            data = await response.text();
        }

        if (!response.ok) {
            console.error(`Ar-IO kļūda [${response.status}]:`, data);
        }
        
        res.status(response.status).send(data);
        
    } catch (e) {
        console.error('Starpnieka kļūda:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Visas lapas novirza uz storage-pay.html (SPA režīms)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'storage-pay.html'));
});

app.listen(PORT, () => console.log(`PermRepo starpniekserveris klausās uz porta ${PORT}`));
