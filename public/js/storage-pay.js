import { ethers } from 'ethers';
import { TurboFactory, EthereumSigner } from '@ardrive/turbo-sdk';

const CHAIN_ID = '0x14a34';
const NFT_ADDRESS = '0xeD3eB455cAeb057a034d7bE2368cdCEA37Faa1d4';
const NFT_ABI = [
    "function addBackup(uint256 tokenId, bytes32 manifestHash, bytes32 merkleRoot, string calldata manifestURI, uint256 deadline, bytes calldata signature) external",
    "function repositoryTokens(bytes32 repoHash) external view returns (uint256)",
    "function backupCount(uint256) view returns (uint256)",
    "function nonces(uint256) view returns (uint256)"
];

const params = new URLSearchParams(window.location.search);
const repoFromUrl = params.get('repo') || '';
const filesParam = params.get('files') || '';

let filesToUpload = [];

async function init() {
    document.getElementById('repoInput').value = repoFromUrl;
    
    const timestampEl = document.getElementById('timestamp');
    if (timestampEl) {
        timestampEl.textContent = new Date().toLocaleString();
    }
    
    if (filesParam) {
        try {
            filesToUpload = JSON.parse(decodeURIComponent(filesParam));
            document.getElementById('fileCount').textContent = filesToUpload.length + ' faili';
            const totalSize = filesToUpload.reduce((s, f) => s + f.size, 0);
            document.getElementById('totalSize').textContent = `${(totalSize / 1024).toFixed(1)} KB`;
        } catch (e) {
            console.error('Neizdevas noparset failus no URL:', e);
            filesToUpload = [];
        }
    }
    
    if (!window.ethereum) {
        showError('Ludzu instale MetaMask, lai turpinatu.');
        return;
    }
    
    try {
        await window.ethereum.request({ 
            method: 'wallet_switchEthereumChain', 
            params: [{ chainId: CHAIN_ID }] 
        });
        
        const button = document.getElementById('payButton');
        button.disabled = false;
        button.textContent = 'Parakstit un Augsupieladet';
        button.onclick = signAndUpload;
        
        setStatus('Gatavs augsupieladei (Lokali Node.js moduli)');
    } catch (e) {
        showError('Kluda mainot tiklu: ' + (e.message || 'Nezinama kluda'));
    }
}

async function signAndUpload() {
    let repo = document.getElementById('repoInput').value.trim();
    
    repo = repo.replace(/^https?:\/\/(www\.)?github\.com\//i, '');
    repo = repo.replace(/^https?:\/\/permrepo\.pages\.dev\//i, '');
    const repoParts = repo.split('/');
    if (repoParts.length >= 2) {
        repo = `${repoParts[0]}/${repoParts[1]}`;
    }
    
    if (!repo || !repo.includes('/')) {
        showError('Ludzu, ievadi pareizu repozitorija nosaukumu (piem., lietotajs/repo)');
        return;
    }

    if (filesToUpload.length === 0) {
        showError('Nav atpazitu failu augsupieladei.');
        return;
    }

    const button = document.getElementById('payButton');
    button.disabled = true;
    showError('');

    try {
        button.textContent = 'Lejupielade failus...';
        setStatus('1/6: Lejupielade koda failus no GitHub...');

        for (let i = 0; i < filesToUpload.length; i++) {
            const file = filesToUpload[i];
            let downloaded = false;

            for (const branch of ['main', 'master']) {
                if (downloaded) break;
                try {
                    const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${file.path}`;
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 5000);
                    const response = await fetch(rawUrl, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    if (response.ok) {
                        file.content = await response.text();
                        downloaded = true;
                    }
                } catch (e) {
                    console.warn(`Neizdevas lejupieladet no ${branch}: ${file.path}`);
                }
            }
        }

        const filesWithContent = filesToUpload.filter(f => f.content != null);
        if (filesWithContent.length === 0) {
            throw new Error('Neizdevas lejupieladet failus no GitHub.');
        }

        setStatus('2/6: Parbauda glabasanas izmaksas...');
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const userAddress = await signer.getAddress();

        const turboSigner = new EthereumSigner(signer);
        const turbo = TurboFactory.authenticated({ 
            signer: turboSigner,
            token: 'base-eth',
            uploadServiceConfig: { url: 'https://upload.services.ar-io.dev' },
            paymentServiceConfig: { url: 'https://payment.services.ar-io.dev' }
        });

        const textEncoder = new TextEncoder();
        let totalBytes = filesWithContent.reduce((sum, f) => sum + textEncoder.encode(f.content).length, 0);

        const uploadCosts = await turbo.getUploadCosts({ bytes: totalBytes });
        const costInfo = uploadCosts[0];

        if (costInfo && parseFloat(costInfo.winc) > 0) {
            setStatus('3/6: Apstiprini maksajumu MetaMask...');
            button.textContent = 'Apstiprini maksajumu...';
            await turbo.topUpWithTokens({
                tokenAmount: costInfo.tokenAmount,
                token: 'ethereum'
            });
        } else {
            setStatus('3/6: Izmanto bezmaksas limeni...');
        }

        setStatus('4/6: Augsupielade failus Arweave...');
        button.textContent = 'Augsupielade...';
        
        const paths = {};
        for (const file of filesWithContent) {
            const data = textEncoder.encode(file.content);
            const receipt = await turbo.uploadFile({
                fileStreamFactory: () => data,
                dataItemOpts: {
                    tags: [
                        { name: 'Content-Type', value: 'text/plain' },
                        { name: 'File-Name', value: file.path }
                    ]
                }
            });
            paths[file.path] = { id: receipt.id };
            file.txId = receipt.id;
        }

        setStatus('5/6: Veido strukturas manifestu...');
        const manifest = {
            manifest: "arweave/paths", version: "0.1.0",
            index: { path: "README.md" }, paths: paths
        };
        if (!paths["README.md"]) manifest.index.path = Object.keys(paths)[0];
        
        const manifestData = textEncoder.encode(JSON.stringify(manifest));
        const manifestReceipt = await turbo.uploadFile({
            fileStreamFactory: () => manifestData,
            dataItemOpts: {
                tags: [
                    { name: 'Content-Type', value: 'application/x.arweave-manifest+json' },
                    { name: 'Type', value: 'manifest' }
                ]
            }
        });
        const manifestTxId = manifestReceipt.id;

        setStatus('6/6: Apstiprini blockchain NFT ierakstu MetaMask...');
        button.textContent = 'Paraksti NFT ierakstu...';

        const manifestHash = ethers.id(manifestTxId);
        const merkleRoot = ethers.id(manifestTxId);
        const deadline = Math.floor(Date.now() / 1000) + 3600;
        const repoHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['string'], [repo]));
        
        const nftContract = new ethers.Contract(NFT_ADDRESS, NFT_ABI, signer);
        const tokenId = await nftContract.repositoryTokens(repoHash);

        if (tokenId && tokenId !== 0n) {
            try {
                const backupNumber = await nftContract.backupCount(tokenId);
                const nonce = await nftContract.nonces(tokenId);
                
                const domain = {
                    name: 'PermRepo', version: '1',
                    chainId: parseInt(CHAIN_ID, 16),
                    verifyingContract: NFT_ADDRESS
                };
                const types = {
                    AddBackup: [
                        { name: 'tokenId', type: 'uint256' },
                        { name: 'backupNumber', type: 'uint256' },
                        { name: 'manifestHash', type: 'bytes32' },
                        { name: 'merkleRoot', type: 'bytes32' },
                        { name: 'deadline', type: 'uint256' },
                        { name: 'nonce', type: 'uint256' }
                    ]
                };
                const value = {
                    tokenId: tokenId.toString(),
                    backupNumber: (backupNumber + 1n).toString(),
                    manifestHash, merkleRoot, deadline,
                    nonce: nonce.toString()
                };
                
                const addBackupSignature = await signer.signTypedData(domain, types, value);
                const tx = await nftContract.addBackup(
                    tokenId, manifestHash, merkleRoot,
                    `ar://${manifestTxId}`, deadline, addBackupSignature
                );
                setStatus('Gaida blockchain transakcijas apstiprinajumu...');
                await tx.wait();
            } catch (blockchainError) {
                console.error('Blockchain ieraksts neizdevas:', blockchainError);
            }
        }

        setStatus('Genere GitHub atskaiti...');
        button.textContent = 'Veido Issue...';

        const timestamp = Math.floor(Date.now() / 1000);
        const message = [
            'PermRepo Backup Authorization',
            `Repository: ${repo}`, `Timestamp: ${timestamp}`, `Address: ${userAddress}`,
            `UploadedFiles: ${filesWithContent.length}`, `ManifestTxId: ${manifestTxId}`
        ].join('\n');

        const signature = await signer.signMessage(message);
        const payload = {
            address: userAddress, signature, message, timestamp,
            uploadedFiles: filesWithContent.map(f => ({ path: f.path, txId: f.txId, size: f.size })), 
            manifestTxId
        };

        const jsonBody = JSON.stringify(payload, null, 2);
        const body = '```json\n' + jsonBody + '\n```';
        const issueTitle = `[PermRepo Backup] ${userAddress.substring(0, 10)}...`;
        const issueUrl = `https://github.com/${repo}/issues/new?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(body)}`;

        setStatus('Gatavs! Novirzam uz GitHub...');
        setTimeout(() => { window.location.href = issueUrl; }, 1500);

    } catch (e) {
        if (e.code === 'ACTION_REJECTED' || (e.message && e.message.includes('rejected'))) {
            showError('Transakcija vai paraksts tika atcelts MetaMask loga.');
        } else {
            showError('Kluda: ' + (e.message || e));
        }
        button.disabled = false;
        button.textContent = 'Meginat velreiz';
    }
}

function setStatus(msg) { 
    const el = document.getElementById('status');
    if (el) el.textContent = msg; 
}

function showError(msg) { 
    const el = document.getElementById('error');
    if (el) el.textContent = msg; 
}

init();
