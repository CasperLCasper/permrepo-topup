import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Drošības nolūkos atstājam CORS, bet galvenokārt, lai apkalpotu failus
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Statisko failu maršruti (Node modules un public mape)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

// Visas lapas novirza uz storage-pay.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'storage-pay.html'));
});

app.listen(PORT, () => console.log(`PermRepo serveris klausās uz porta ${PORT} - Tiešais savienojums aktīvs!`));
