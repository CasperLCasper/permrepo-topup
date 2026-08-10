const express = require('express');
const { TurboFactory, EthereumSigner } = require('@ardrive/turbo-sdk');
const { ethers } = require('ethers');

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;
const RPC_URL = 'https://sepolia.base.org';
const ARWEAVE_STORAGE_KEY = process.env.ARWEAVE_STORAGE_KEY;

app.post('/api/upload', async (req, res) => {
    try {
        if (!ARWEAVE_STORAGE_KEY) {
            return res.status(500).json({ error: 'ARWEAVE_STORAGE_KEY not configured' });
        }

        const { files, repo } = req.body;
        if (!files || !files.length) {
            return res.status(400).json({ error: 'Nav failu' });
        }

        const signer = new EthereumSigner(ARWEAVE_STORAGE_KEY);
        const turbo = TurboFactory.authenticated({
            signer,
            token: 'base-eth',
            gatewayUrl: RPC_URL,
            paymentServiceConfig: { url: 'https://payment.services.ar-io.dev' },
            uploadServiceConfig: { url: 'https://upload.services.ar-io.dev' }
        });

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

app.listen(PORT, () => console.log(`Serveris klausas uz porta ${PORT}`));
