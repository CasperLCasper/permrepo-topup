// ============================================
// PERMAREPO GLABASANAS APMAKSAS LAPA
// Sutra failus uz Render serveri augsupieladei
// ============================================

const CHAIN_ID = '0x14a34';

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
        showError('Instale MetaMask vai citu kripto maku');
        return;
    }
    
    try {
        await ethereum.request({ 
            method: 'wallet_switchEthereumChain', 
            params: [{ chainId: CHAIN_ID }] 
        });
        
        const button = document.getElementById('payButton');
        button.disabled = false;
        button.textContent = 'Parakstit un Augsupieladet';
        button.onclick = signAndUpload;
        
        setStatus('Gatavs augsupieladei');
    } catch (e) {
        showError('Kluda: ' + e.message);
    }
}

async function signAndUpload() {
    let repo = document.getElementById('repoInput').value.trim();
    repo = repo.replace(/^https?:\/\/permrepo\.pages\.dev\//, '');
    repo = repo.replace(/^https?:\/\/.+\//, '');
    
    if (!repo || repo.includes('http') || !repo.includes('/')) {
        showError('Ludzu, ievadi repozitorija nosaukumu (piem., lietotajs/repo)');
        return;
    }

    if (filesToUpload.length === 0) {
        showError('Nav failu augsupieladei');
        return;
    }

    const button = document.getElementById('payButton');
    button.disabled = true;

    try {
        button.textContent = 'Lejupielade failus...';
        setStatus('1/3: Lejupielade failus no GitHub...');

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

        const filesWithContent = filesToUpload.filter(f => f.content);
        if (filesWithContent.length === 0) {
            showError('Neizdevas lejupieladet nevienu failu.');
            button.disabled = false;
            return;
        }

        button.textContent = 'Augsupielade...';
        setStatus('2/3: Augsupielade uz Arweave...');

        const response = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: filesWithContent, repo })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Augsupielade neizdevas');
        }

        const result = await response.json();

        button.textContent = 'Paraksti autorizaciju...';
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
        else showError('Kluda: ' + e.message);
        button.disabled = false;
        button.textContent = 'Parakstit un Augsupieladet';
    }
}

function setStatus(msg) { document.getElementById('status').textContent = msg; }
function showError(msg) { document.getElementById('error').textContent = msg; }
init();
