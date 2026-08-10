import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.min.js';

const CHAIN_ID = '0x14a34';
const RENDER_URL = window.location.origin;
const NFT_ADDRESS = '0xeD3eB455cAeb057a034d7bE2368cdCEA37Faa1d4';
const NFT_ABI = [
    "function addBackup(uint256 tokenId, bytes32 manifestHash, bytes32 merkleRoot, string calldata manifestURI, uint256 deadline, bytes calldata signature) external",
    "function repositoryTokens(bytes32 repoHash) external view returns (uint256)"
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
        button.textContent = 'Parakstit un Augsupieladet';
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

    try {
        // 1. Lejupielade
        button.textContent = 'Lejupielade failus...';
        setStatus('1/5: Lejupielade failus no GitHub...');

        for (let i = 0; i < filesToUpload.length; i++) {
            const file = filesToUpload[i];
            try {
                const rawUrl = `https://raw.githubusercontent.com/${repo}/main/${file.path}`;
                const response = await fetch(rawUrl);
                if (response.ok) {
                    file.content = await response.text();
                }
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

        // 2. Augsupielade
        button.textContent = 'Augsupielade Arweave...';
        setStatus('2/5: Augsupielade uz Arweave...');

        const response = await fetch(`${RENDER_URL}/api/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: filesWithContent, repo })
        });

        if (!response.ok) {
            let errMsg = 'Servera kluda';
            try {
                const errJson = await response.json();
                errMsg = errJson.error || errMsg;
            } catch (e) {
                errMsg = await response.text();
            }
            throw new Error(errMsg);
        }

        const result = await response.json();

        // 3. Blockchain ieraksts
        button.textContent = 'Ieraksta blockchain...';
        setStatus('3/5: Apstiprini blockchain ierakstu MetaMask...');

        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const userAddress = await signer.getAddress();

        const manifestHash = ethers.id(result.manifestTxId);
        const merkleRoot = ethers.id(result.manifestTxId);
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        // Iegust tokenId no NFT liguma
        const repoHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['string'], [repo]));
        const nftReadContract = new ethers.Contract(NFT_ADDRESS, NFT_ABI, provider);
        const tokenId = await nftReadContract.repositoryTokens(repoHash);

        if (tokenId && tokenId !== 0n) {
            try {
                const nftWriteContract = new ethers.Contract(NFT_ADDRESS, NFT_ABI, signer);
                const tx = await nftWriteContract.addBackup(
                    tokenId,
                    manifestHash,
                    merkleRoot,
                    `ar://${result.manifestTxId}`,
                    deadline,
                    '0x' + '00'.repeat(65)
                );
                await tx.wait();
                console.log('Blockchain ieraksts veiksmigs!', tx.hash);
            } catch (blockchainError) {
                console.warn('Blockchain ieraksts neizdevas:', blockchainError.message);
            }
        }

        // 4. Paraksts
        button.textContent = 'Paraksti autorizaciju...';
        setStatus('4/5: Apstiprini parakstu MetaMask...');

        const timestamp = Math.floor(Date.now() / 1000);
        const message = [
            'PermRepo Backup Authorization',
            `Repository: ${repo}`, 
            `Timestamp: ${timestamp}`, 
            `Address: ${userAddress}`,
            `UploadedFiles: ${result.uploadedFiles.length}`, 
            `ManifestTxId: ${result.manifestTxId}`
        ].join('\n');

        const signature = await signer.signMessage(message);
        
        // 5. Izveidot Issue
        setStatus('5/5: Izveido GitHub Issue...');

        const payload = {
            address: userAddress, 
            signature, 
            message, 
            timestamp,
            uploadedFiles: result.uploadedFiles, 
            manifestTxId: result.manifestTxId
        };

        const jsonBody = JSON.stringify(payload, null, 2);
        const body = '```json\n' + jsonBody + '\n```';
        const issueTitle = `[PermRepo Backup] ${userAddress.substring(0, 10)}...`;
        const issueUrl = `https://github.com/${repo}/issues/new?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(body)}`;

        setStatus('Gatavs! Novirzam uz GitHub...');
        
        setTimeout(() => {
            window.location.href = issueUrl;
        }, 1500);

    } catch (e) {
        if (e.code === 'ACTION_REJECTED') {
            showError('Transakcija/Paraksts atcelts MetaMask loga.');
        } else {
            showError('Kluda: ' + e.message);
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
