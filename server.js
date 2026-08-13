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

// Uz priekšu — pārsūta visus pieprasījumus no /api/turbo uz Turbo
app.use('/api/turbo', async (req, res) => {
    try {
        // Noņemam /api/turbo no ceļa
        const turboPath = req.path;
        const queryString = new URLSearchParams(req.query).toString();
        
        // Izvēlamies pareizo Turbo URL
        let turboBaseUrl = 'https://upload.services.ar-io.dev';
        
        // Ja pieprasījums ir balance, costs, topup utt. — uz payment
        if (turboPath.includes('/balance') || turboPath.includes('/costs') || turboPath.includes('/topup') || turboPath.includes('/info') || turboPath.includes('/currencies')) {
            turboBaseUrl = 'https://payment.services.ar-io.dev';
        }
        
        const turboUrl = `${turboBaseUrl}${turboPath}${queryString ? '?' + queryString : ''}`;
        
        console.log(`Starpnieks: ${req.method} ${turboUrl}`);
        
        const response = await fetch(turboUrl, {
            method: req.method,
            headers: {
                'Content-Type': req.headers['content-type'] || 'application/octet-stream',
                'Accept': req.headers['accept'] || 'application/json'
            },
            body: req.method === 'GET' ? undefined : JSON.stringify(req.body)
        });
        
        const contentType = response.headers.get('content-type');
        const data = contentType && contentType.includes('json') 
            ? await response.json() 
            : await response.text();
        
        res.status(response.status).json(data);
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
