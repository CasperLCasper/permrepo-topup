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

// Svarīgi: Node_modules un statiskie faili jāapkalpo PIRMS datu plūsmas apstrādes
app.use(express.static(path.join(__dirname, 'public')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

// ==========================================
// TURBO STARPNIEKS (Bez ķermeņa pārveidošanas)
// ==========================================
// Izmantojam express.raw(), lai saglabātu precīzus baitus un nesabojātu Web3 parakstu!
app.use('/v1', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
    try {
        // req.url jau saturēs /balance un parametrus, tāpēc pievienojam tikai /v1
        const turboPath = '/v1' + req.url; 
        
        // Izvēlamies pareizo Turbo vārteju
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
        
        // Kopējam visus svarīgos ienākošos headerus no SDK
        const forwardHeaders = {};
        for (const [key, value] of Object.entries(req.headers)) {
            // Izlaižam headerus, kas var sabojāt savienojumu ar Ar-IO
            if (!['host', 'connection'].includes(key.toLowerCase())) {
                forwardHeaders[key] = value;
            }
        }

        // Pievienojam reālu User-Agent, lai Cloudflare nenobloķētu Render IP
        forwardHeaders['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

        const fetchOptions = {
            method: req.method,
            headers: forwardHeaders
        };
        
        // Pārsūtām neapstrādātu (raw) ķermeni, ja tāds ir nosūtīts POST/PUT formātā
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Buffer.isBuffer(req.body)) {
            fetchOptions.body = req.body;
        }
        
        const response = await fetch(turboUrl, fetchOptions);
        
        // Nolasām atbildi kā tekstu (vai neapstrādātu virkni), lai nemainītu saturu
        const data = await response.text(); 

        if (!response.ok) {
            console.error(`Ar-IO kļūda [${response.status}]: ${data}`);
        }
        
        // Atgriežam pareizo content-type, ko atsūtīja Ar-IO
        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('content-type', contentType);
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
