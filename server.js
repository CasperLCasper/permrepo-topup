import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

// ==========================================
// TURBO STARPNIEKS (bez privātās atslēgas)
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
        
        const fetchOptions = {
            method: req.method,
            headers: {
                'Accept': 'application/json'
            }
        };
        
        if (req.method === 'POST') {
            fetchOptions.headers['Content-Type'] = 'application/octet-stream';
            fetchOptions.body = JSON.stringify(req.body);
        }
        
        const response = await fetch(turboUrl, fetchOptions);
        
        const contentType = response.headers.get('content-type');
        let data;
        
        if (contentType && contentType.includes('json')) {
            data = await response.json();
        } else {
            data = await response.text();
        }
        
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

app.listen(PORT, () => console.log(`PermRepo starpniekserveris klausās uz porta ${PORT}`));
