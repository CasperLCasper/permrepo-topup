import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.min.js';

const CHAIN_ID = '0x14a34'; // Base Sepolia
const RENDER_URL = window.location.origin;

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
            console.error('Neizdevās noparsēt failus no URL:', e);
            filesToUpload = [];
        }
    }
    
    if (!window.ethereum) {
        showError('Lūdzu instalē MetaMask vai citu Web3 maku, lai turpinātu.');
        return;
    }
    
    try {
        await window.ethereum.request({ 
            method: 'wallet_switchEthereumChain', 
            params: [{ chainId: CHAIN_ID }] 
        });
        
        const button = document.getElementById('payButton');
        button.disabled = false;
        button.textContent = 'Parakstīt un Augšupielādēt';
        button.onclick = signAndUpload;
        
        setStatus('Gatavs augšupielādei');
    } catch (e) {
        showError('Kļūda mainot tīklu: ' + (e.message || 'Nezināma kļūda'));
    }
}

async function signAndUpload() {
    let repo = document.getElementById('repoInput').value.trim();
    
    // Drošāka repozitorija nosaukuma iegūšana (pat ja ielīmē pilnu URL)
    repo = repo.replace(/^https?:\/\/(www\.)?github\.com\//i, '');
    repo = repo.replace(/^https?:\/\/permrepo\.pages\.dev\//i, '');
    const repoParts = repo.split('/');
    if (repoParts.length >= 2) {
        repo = `${repoParts[0]}/${repoParts[1]}`; // Paņem tikai lietotajs/repo
    }
    
    if (!repo || !repo.includes('/')) {
        showError('Lūdzu, ievadi pareizu repozitorija nosaukumu (piem., lietotajs/repo)');
        return;
    }

    if (filesToUpload.length === 0) {
        showError('Nav atpazītu failu augšupielādei.');
        return;
    }

    const button = document.getElementById('payButton');
    button.disabled = true;

    try {
        button.textContent = 'Lejupielādē failus...';
        setStatus('1/3: Lejupielādē failus no GitHub...');

        for (let i = 0; i < filesToUpload.length; i++) {
            const file = filesToUpload[i];
            try {
                const rawUrl = `https://raw.githubusercontent.com/${repo}/main/${file.path}`;
                const response = await fetch(rawUrl);
                if (response.ok) {
                    file.content = await response.text();
                } else {
                    console.warn(`Nevar lejupielādēt ${file.path} (Statuss: ${response.status})`);
                }
            } catch (e) {
                console.warn('Tīkla kļūda lejupielādējot:', file.path);
            }
        }

        const filesWithContent = filesToUpload.filter(f => f.content != null);
        if (filesWithContent.length === 0) {
            showError('Neizdevās lejupielādēt nevienu failu no GitHub (pārbaudi repozitorija nosaukumu un branch "main").');
            button.disabled = false;
            button.textContent = 'Mēģināt vēlreiz';
            return;
        }

        button.textContent = 'Augšupielādē Arweave...';
        setStatus('2/3: Sūta uz Render serveri augšupielādei...');

        const response = await fetch(`${RENDER_URL}/api/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: filesWithContent, repo })
        });

        if (!response.ok) {
            let errMsg = 'Servera kļūda';
            try {
                const errJson = await response.json();
                errMsg = errJson.error || errMsg;
            } catch (e) {
                errMsg = await response.text();
            }
            throw new Error(errMsg);
        }

        const result = await response.json();

        button.textContent = 'Paraksti autorizāciju...';
        setStatus('3/3: Lūdzu apstiprini (Sign) MetaMask logā...');

        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const userAddress = await signer.getAddress();

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

        setStatus('Gatavs! Novirzam uz GitHub Issue izveidi...');
        
        // Pagaidām sekundi, lai lietotājs redz veiksmīgo statusu
        setTimeout(() => {
            window.location.href = issueUrl;
        }, 1500);

    } catch (e) {
        if (e.code === 'ACTION_REJECTED') {
            showError('Transakcija/Paraksts atcelts MetaMask logā.');
        } else {
            showError('Kļūda: ' + e.message);
        }
        button.disabled = false;
        button.textContent = 'Mēģināt vēlreiz';
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

// Sākam procesu
init();
