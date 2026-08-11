import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));

// Statiskie faili
app.use(express.static(path.join(__dirname, 'public')));

// Node_modules piekļuve pārlūkam
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

// API — augsupielade (Render serveris veic smago darbu)
app.post('/api/upload', async (req, res) => {
    try {
        const { files, repo } = req.body;
        if (!files || !files.length) {
            return res.status(400).json({ error: 'Nav failu' });
        }

        // Dinamiski importējam Turbo SDK tikai servera pusē
        const { TurboFactory, EthereumSigner } = await import('@ardrive/turbo-sdk');
        
        const privateKey = process.env.ARWEAVE_STORAGE_KEY;
        let turbo;
        
        if (privateKey) {
            const signer = new EthereumSigner(privateKey);
            turbo = TurboFactory.authenticated({
                signer,
                token: 'base-eth',
                uploadServiceConfig: { url: 'https://upload.services.ar-io.dev' },
                paymentServiceConfig: { url: 'https://payment.services.ar-io.dev' }
            });
        } else {
            turbo = TurboFactory.unauthenticated({
                token: 'base-eth',
                uploadServiceConfig: { url: 'https://upload.services.ar-io.dev' },
                paymentServiceConfig: { url: 'https://payment.services.ar-io.dev' }
            });
        }

        const uploadResults = [];
        for (const file of files) {
            const fileData = Buffer.from(file.content, 'utf-8');
            const result = await turbo.upload({
                data: fileData,
                dataItemOpts: {
                    tags: [
                        { name: 'App-Name', value: 'PermRepo' },
                        { name: 'Repo', value: repo },
                        { name: 'File-Path', value: file.path },
                        { name: 'Unix-Time', value: String(Math.floor(Date.now() / 1000)) }
                    ]
                }
            });
            uploadResults.push({ path: file.path, txId: result.id, size: fileData.length });
        }

        // Manifests
        const manifest = {
            manifest: 'arweave/paths', version: '0.2.0',
            index: { path: 'README.md' }, paths: {},
            metadata: { repo, timestamp: new Date().toISOString(), generatedBy: 'PermRepo v1.0.0' }
        };
        for (const f of uploadResults) manifest.paths[f.path] = { id: f.txId };

        const manifestData = Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8');
        const manifestResult = await turbo.upload({
            data: manifestData,
            dataItemOpts: {
                tags: [
                    { name: 'App-Name', value: 'PermRepo' },
                    { name: 'Type', value: 'path-manifest' },
                    { name: 'Repo', value: repo },
                    { name: 'Content-Type', value: 'application/x.arweave-manifest+json' },
                    { name: 'Unix-Time', value: String(Math.floor(Date.now() / 1000)) }
                ]
            }
        });

        return res.json({
            success: true,
            uploadedFiles: uploadResults,
            manifestTxId: manifestResult.id
        });

    } catch (error) {
        console.error('Upload error:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

// Visas lapas novirza uz storage-pay.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'storage-pay.html'));
});

app.listen(PORT, () => console.log(`PermRepo serveris klausas uz porta ${PORT}`));
