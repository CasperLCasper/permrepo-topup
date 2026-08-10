import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.min.js';

const CHAIN_ID = '0x14a34'; // Base Sepolia
const RENDER_URL = window.location.origin;

const params = new URLSearchParams(window.location.search);
const repoFromUrl = params.get('repo') || '';
const filesParam = params.get('files') || '';

let filesToUpload = [];

async function init() {
    document.getElementById('repoInput').value = repoFromUrl;
    document.getElementById('timestamp').textContent = new Date().toLocaleString();
    
    if (filesParam) {
        try {
            filesToUpload = JSON.parse(decodeURIComponent(filesParam));
            document.getElementById('fileCount').textContent = filesToUpload.length + ' faili';
            const totalSize = filesToUpload.reduce((s, f) => s + f.size, 0);
            document.getElementById('totalSize').textContent = `${(totalSize / 1024).toFixed(1)} KB`;
        } catch (e) {
            filesToUpload = [];
        }
    }
    
    if (!window.ethereum) {
        showError('Instalē MetaMask vai citu Web3 maku');
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
        showError('Kļūda: ' + e.message);
    }
}

async function signAndUpload() {
    let repo = document.getElementById('repoInput').value.trim();
    repo = repo.replace(/^https?:\/\/permrepo\.pages\.dev\//, '');
    repo = repo.replace(/^https?:\/\/.+\//, '');
    
    if (!repo || repo.includes('http') || !repo.includes('/')) {
        showError('Lūdzu, ievadi repozitorija nosaukumu (piem., lietotājs/repo)');
        return;
    }

    if (filesToUpload.length === 0) {
        showError('Nav failu augšupielādei');
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
                }
            } catch (e) {
                console.warn('Nevar lejupielādēt:', file.path);
            }
        }

        const filesWithContent = filesToUpload.filter(f => f.content);
        if (filesWithContent.length === 0) {
            showError('Neizdevās lejupielādēt nevienu failu.');
            button.disabled = false;
            return;
        }

        button.textContent = 'Augšupielādē...';
        setStatus('2/3: Sūta uz serveri...');

        const response = await fetch(`${RENDER_URL}/api/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: filesWithContent, repo })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Augšupielāde neizdevās');
        }

        const result = await response.json();

        button.textContent = 'Paraksti autorizāciju...';
        setStatus('3/3: Paraksti ar MetaMask...');

        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const userAddress = await signer.getAddress();

        const timestamp = Math.floor(Date.now() / 1000);
        const message = [
            'PermRepo Backup Authorization',
            `Repository: ${repo}`, `Timestamp: ${timestamp}`, `Address: ${userAddress}`,
            `UploadedFiles: ${result.uploadedFiles.length}`, `ManifestTxId: ${result.manifestTxId}`
        ].join('\n');

        const signature = await signer.signMessage(message);
        const payload = {
            address: userAddress, signature, message, timestamp,
            uploadedFiles: result.uploadedFiles, manifestTxId: result.manifestTxId
        };

        const jsonBody = JSON.stringify(payload, null, 2);
        const body = '```json\n' + jsonBody + '\n```';
        const issueTitle = `[PermRepo Backup] ${userAddress.substring(0, 10)}...`;
        const issueUrl = `https://github.com/${repo}/issues/new?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(body)}`;

        setStatus('Gatavs! Novirzam uz GitHub...');
        window.location.href = issueUrl;

    } catch (e) {
        if (e.code === 'ACTION_REJECTED') showError('Transakcija atcelta');
        else showError('Kļūda: ' + e.message);
        button.disabled = false;
        button.textContent = 'Parakstīt un Augšupielādēt';
    }
}

function setStatus(msg) { document.getElementById('status').textContent = msg; }
function showError(msg) { document.getElementById('error').textContent = msg; }

init();
