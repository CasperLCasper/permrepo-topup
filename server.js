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

// Iegūt kredītu atlikumu
app.get('/api/turbo/balance', async (req, res) => {
    try {
        const response = await fetch('https://payment.services.ar-io.dev/v1/balance', {
            headers: { 'Accept': 'application/json' }
        });
        const data = await response.json();
        res.json(data);
    } catch (e) {
        console.error('Balance error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Iegūt augšupielādes izmaksas
app.get('/api/turbo/costs', async (req, res) => {
    try {
        const { bytes } = req.query;
        const response = await fetch(`https://payment.services.ar-io.dev/v1/costs?bytes=${bytes}`, {
            headers: { 'Accept': 'application/json' }
        });
        const data = await response.json();
        res.json(data);
    } catch (e) {
        console.error('Costs error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Augšupielādēt datus
app.post('/api/turbo/upload', async (req, res) => {
    try {
        const { data, tags } = req.body;
        
        // Pārvērš atpakaļ par Buffer
        const buffer = Buffer.from(data, 'base64');
        
        const response = await fetch('https://upload.services.ar-io.dev/v1/tx', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream'
            },
            body: buffer
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Turbo upload error:', errorText);
            return res.status(response.status).json({ error: errorText });
        }
        
        // Turbo atgriež TX ID kā plain text
        const txId = await response.text();
        console.log('Upload successful, TX ID:', txId);
        
        res.json({ id: txId.trim() });
    } catch (e) {
        console.error('Upload error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Iegūt info par valūtām
app.get('/api/turbo/currencies', async (req, res) => {
    try {
        const response = await fetch('https://payment.services.ar-io.dev/v1/currencies');
        const data = await response.json();
        res.json(data);
    } catch (e) {
        console.error('Currencies error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Iegūt info par sistēmu
app.get('/api/turbo/info', async (req, res) => {
    try {
        const response = await fetch('https://payment.services.ar-io.dev/v1/info');
        const data = await response.json();
        res.json(data);
    } catch (e) {
        console.error('Info error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Top up kredītus (starpnieks priekš pārlūka)
app.post('/api/turbo/topup', async (req, res) => {
    try {
        const { amount, token, destinationAddress } = req.body;
        
        const response = await fetch('https://payment.services.ar-io.dev/v1/topup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount, token, destinationAddress })
        });
        
        const result = await response.json();
        res.json(result);
    } catch (e) {
        console.error('Topup error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Visas lapas novirza uz storage-pay.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'storage-pay.html'));
});

app.listen(PORT, () => console.log(`PermRepo starpniekserveris klausās uz porta ${PORT}`));
