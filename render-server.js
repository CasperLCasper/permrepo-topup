const express = require('express');
const cors = require('cors');
const path = require('path');
const { TurboFactory, EthereumSigner } = require('@ardrive/turbo-sdk');
const { ethers } = require('ethers');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const RPC_URL = 'https://sepolia.base.org';
const ARWEAVE_STORAGE_KEY = process.env.ARWEAVE_STORAGE_KEY;

// Statiskie faili
app.get('/storage-pay.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'storage-pay.html'));
});

app.get('/js/storage-pay.js', (req, res) => {
    res.type('application/javascript');
    res.sendFile(path.join(__dirname, 'public', 'js', 'storage-pay.js'));
});

app.get('/css/style.css', (req, res) => {
    res.type('text/css');
    res.sendFile(path.join(__dirname, 'public', 'css', 'style.css'));
});

// API — augsupielade
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
            signer, token: 'base-eth', gatewayUrl: RPC_URL,
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

// API — topup krediti
app.get('/api/topup-credits', async (req, res) => {
    try {
        if (!ARWEAVE_STORAGE_KEY) {
            return res.status(500).json({ error: 'ARWEAVE_STORAGE_KEY not configured' });
        }

        const topUpAmountEth = parseFloat(process.env.TOP_UP_AMOUNT || '0.01');
        const topUpAmountWei = ethers.parseEther(topUpAmountEth.toString());

        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const wallet = new ethers.Wallet(ARWEAVE_STORAGE_KEY, provider);
        const address = await wallet.getAddress();
        const ethBalance = await provider.getBalance(address);

        if (ethBalance < topUpAmountWei) {
            return res.status(400).json({ 
                error: 'Nepietiekami ETH.',
                address, balance: ethers.formatEther(ethBalance)
            });
        }

        const signer = new EthereumSigner(ARWEAVE_STORAGE_KEY);
        const turbo = TurboFactory.authenticated({
            signer, token: 'base-eth', gatewayUrl: RPC_URL,
            paymentServiceConfig: { url: 'https://payment.services.ar-io.dev' },
            uploadServiceConfig: { url: 'https://upload.services.ar-io.dev' }
        });

        const { winc: before } = await turbo.getBalance();
        await turbo.topUpWithTokens({ tokenAmount: topUpAmountWei });
        const { winc: after } = await turbo.getBalance();

        return res.json({
            success: true, address,
            topUpAmount: topUpAmountEth + ' ETH (Base Sepolia)',
            creditsAdded: (after - before).toString()
        });

    } catch (error) {
        console.error('Topup error:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => console.log(`Serveris klausas uz porta ${PORT}`));
