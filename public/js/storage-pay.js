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
    if (timestampEl) timestampEl.textContent = new Date().toLocaleString();
    
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
        showError('Ludzu instale MetaMask vai citu Web3 maku, lai turpinatu.');
        return;
    }
    
    try {
        await window.ethereum.request({ 
            method: 'wallet_switchEthereumChain', 
            params: [{ chainId: CHAIN_ID }] 
        });
        
        const button = document.getElementById('payButton');
        button.disabled = false;
        button.textContent = 'Maksat ar MetaMask un Augsupieladet';
        button.onclick = signAndUpload;
        
        setStatus('Gatavs augsupieladei');
    } catch (e) {
        showError('Kluda mainot tiklu: ' + (e.message || 'Nezinama kluda'));
    }
}

async function signAndUpload() {
    let repo = document.getElementById('repoInput').value.trim();
    
    repo = repo.replace(/^https?:\/\/(www\.)?github\.com\//i, '');
    repo = repo.replace(/^https?:\/\/permrepo\.pages\.dev\//i, '');
    const repoParts = repo.split('/');
    if (repoParts.length >= 2) repo = `${repoParts[0]}/${repoParts[1]}`;
    
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
        // 1. Lejupielade
        button.textContent = 'Lejupielade failus...';
        setStatus('1/6: Lejupielade failus no GitHub...');

        for (let i = 0; i < filesToUpload.length; i++) {
            const file = filesToUpload[i];
            try {
                const rawUrl = `https://raw.githubusercontent.com/${repo}/main/${file.path}`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                const response = await fetch(rawUrl, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (response.ok) file.content = await response.text();
            } catch (e) {
                console.warn('Nevar lejupieladet:', file.path);
            }
        }

        const filesWithContent = filesToUpload.filter(f => f.content != null);
        if (filesWithContent.length === 0) {
            showError('Neizdevas lejupieladet nevienu failu.');
            button.disabled = false;
            button.textContent = 'Meginat velreiz';
            return;
        }

        // 2. Savienojamies ar MetaMask un inicializejam Turbo
        button.textContent = 'Savienojas ar MetaMask...';
        setStatus('2/6: Inicialize MetaMask...');

        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const userAddress = await signer.getAddress();

        const turboSigner = new EthereumSigner(signer);
        const selectedCurrency = document.getElementById('currencySelect').value;
        
        const turbo = TurboFactory.authenticated({
            signer: turboSigner,
            token: selectedCurrency,
            uploadServiceConfig: { url: 'https://upload.services.ar-io.dev' },
            paymentServiceConfig: { url: 'https://payment.services.ar-io.dev' }
        });

        // 3. Parbaudam kreditus
        setStatus('3/6: Parbauda kreditus...');
        button.textContent = 'Parbauda kreditus...';

        const textEncoder = new TextEncoder();
        let totalBytes = filesWithContent.reduce((sum, f) => sum + textEncoder.encode(f.content).length, 0);

        const { winc: currentBalance } = await turbo.getBalance();
        const uploadCosts = await turbo.getUploadCosts({ bytes: totalBytes });
        const costInfo = uploadCosts[0];

        if (costInfo && parseInt(currentBalance) < parseInt(costInfo.winc)) {
            const token = selectedCurrency === 'base-usdc' ? 'usdc' : 'ethereum';
            setStatus(`3/6: Nepietiek kreditu. Apstiprini maksajumu MetaMask...`);
            button.textContent = 'Apstiprini maksajumu...';
            await turbo.topUpWithTokens({
                tokenAmount: costInfo.tokenAmount,
                token: token
            });
            setStatus('Krediti papildinati! Turpinam...');
        } else {
            setStatus('3/6: Pietiekami kreditu. Turpinam...');
        }

        // 4. Augsupielade failus
        setStatus('4/6: Augsupielade failus Arweave...');
        button.textContent = 'Augsupielade...';
        
        const paths = {};
        for (const file of filesWithContent) {
            const fileData = textEncoder.encode(file.content);
            const result = await turbo.uploadFile({
                fileStreamFactory: () => fileData,
                fileSizeFactory: () => fileData.length,
                dataItemOpts: {
                    tags: [
                        { name: 'App-Name', value: 'PermRepo' },
                        { name: 'Repo', value: repo },
                        { name: 'File-Path', value: file.path },
                        { name: 'Content-Type', value: 'text/plain' },
                        { name: 'Unix-Time', value: String(Math.floor(Date.now() / 1000)) }
                    ]
                }
            });
            paths[file.path] = { id: result.id };
            file.txId = result.id;
        }

        // 5. Izveido manifestu un augsupielade
        setStatus('5/6: Veido manifestu...');
        button.textContent = 'Manifests...';

        const manifest = {
            manifest: 'arweave/paths', version: '0.2.0',
            index: { path: 'README.md' }, paths: paths,
            metadata: { repo, timestamp: new Date().toISOString(), generatedBy: 'PermRepo v1.0.0' }
        };
        if (!paths['README.md']) manifest.index.path = Object.keys(paths)[0];

        const manifestData = textEncoder.encode(JSON.stringify(manifest));
        const manifestResult = await turbo.uploadFile({
            fileStreamFactory: () => manifestData,
            fileSizeFactory: () => manifestData.length,
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
        const manifestTxId = manifestResult.id;

        // 6. Blockchain ieraksts ar EIP-712
        setStatus('6/6: Apstiprini blockchain ierakstu MetaMask...');
        button.textContent = 'Paraksti NFT ierakstu...';

        const manifestHash = ethers.id(manifestTxId);
        const merkleRoot = ethers.id(manifestTxId);
        const deadline = Math.floor(Date.now() / 1000) + 3600;
        const repoHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['string'], [repo]));
        
        const nftReadContract = new ethers.Contract(NFT_ADDRESS, NFT_ABI, provider);
        const tokenId = await nftReadContract.repositoryTokens(repoHash);

        if (tokenId && tokenId !== 0n) {
            try {
                const backupNumber = await nftReadContract.backupCount(tokenId);
                const nonce = await nftReadContract.nonces(tokenId);
                
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
                
                const nftWriteContract = new ethers.Contract(NFT_ADDRESS, NFT_ABI, signer);
                const tx = await nftWriteContract.addBackup(
                    tokenId, manifestHash, merkleRoot,
                    `ar://${manifestTxId}`, deadline, addBackupSignature
                );
                
                setStatus('Gaida blockchain transakcijas apstiprinajumu...');
                await tx.wait();
                console.log('Blockchain ieraksts veiksmigs!', tx.hash);
            } catch (blockchainError) {
                console.error('Blockchain ieraksts neizdevas:', blockchainError);
            }
        }

        // 7. Izveidot Issue
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
        if (e.code === 'ACTION_REJECTED') showError('Transakcija/Paraksts atcelts MetaMask loga.');
        else showError('Kluda: ' + e.message);
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
