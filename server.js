import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Statiskie faili (Tavs HTML, CSS un JS, kas runās ar MetaMask)
app.use(express.static(path.join(__dirname, 'public')));

// Node_modules piekļuve pārlūkam, lai strādātu importmap (bez CDN)
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

// Visas lapas novirza uz HTML failu (SPA režīms)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'storage-pay.html'));
});

app.listen(PORT, () => console.log(`PermRepo statiskais serveris klausās uz porta ${PORT}`));
