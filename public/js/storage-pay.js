import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.min.js';
import { TurboFactory, EthereumSigner } from 'https://esm.sh/@ardrive/turbo-sdk@1.12.0/web';

const CHAIN_ID = '0x14a34'; // Base Sepolia (84532)
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
        showError('Lūdzu instalē MetaMask, lai turpinātu.');
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
        
        setStatus('Gatavs augšupielādei (100% MetaMask)');
    } catch (e) {
        showError('Kļūda mainot tīklu: ' + (e.message || 'Nezināma kļūda'));
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
        showError('Lūdzu, ievadi pareizu repozitorija nosaukumu (piem., lietotajs/repo)');
        return;
    }

    if (filesToUpload.length === 0) {
        showError('Nav atpazītu failu augšupielādei.');
        return;
    }

    const button = document.getElementById('payButton');
    button.disabled = true;
    showError(''); // Notīra iepriekšējās kļūdas

    try {
        // 1. LEJUPIELĀDE NO GITHUB
        button.textContent = 'Lejupielādē failus...';
        setStatus('1/6: Lejupielādē koda failus no GitHub...');

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

        const filesWithContent = filesToUpload.filter(f => f.content != null);
        if (filesWithContent.length === 0) {
            throw new Error('Neizdevās lejupielādēt nevienu failu no GitHub.');
        }

        // 2. SAGATAVO METAMASK UN TURBO SDK
        setStatus('2/6: Pārbauda glabāšanas izmaksas...');
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const userAddress = await signer.getAddress();

        // Ethers v6 un Turbo SDK savietojamības fiksējums
        if (typeof signer.signTypedData === 'function' && !signer._signTypedData) {
            signer._signTypedData = signer.signTypedData.bind(signer);
        }

        const turboSigner = new EthereumSigner(signer);
        const turbo = TurboFactory.authenticated({ signer: turboSigner });

        // Aprēķina kopējo baitos (Faili + Manifesta rezerve)
        const textEncoder = new TextEncoder();
        let totalBytes = filesWithContent.reduce((sum, f) => sum + textEncoder.encode(f.content).length, 0);
        totalBytes += 2048; 

        const { winc: currentBalance } = await turbo.getBalance();
        const uploadCosts = await turbo.getUploadCosts({ bytes: totalBytes });
        
        const selectedCurrency = document.getElementById('currencySelect').value === 'base-usdc' ? 'usdc' : 'ethereum';
        const costInfo = uploadCosts.find(c => c.token === selectedCurrency);

        // 3. APMAKSĀ JA NEPIECIEŠAMS
        if (costInfo && parseInt(currentBalance) < parseInt(costInfo.winc)) {
            const amountToPay = (parseFloat(costInfo.tokenAmount) * 1.05).toFixed(6); // 5% drošības rezerve kursa svārstībām
            setStatus(`3/6: Nepietiek kredītu. Apmaksā ${amountToPay} ${selectedCurrency.toUpperCase()} MetaMask logā...`);
            button.textContent = 'Apstiprini maksājumu...';
            
            await turbo.topUpWithTokens({
                tokenAmount: amountToPay,
                token: selectedCurrency
            });
            setStatus('Glabāšana apmaksāta! Turpinām ar augšupielādi...');
        } else {
            setStatus('3/6: Izmanto bezmaksas kvotu / esošos Turbo kredītus...');
        }

        // 4. AUGŠUPIELĀDĒ FAILUS ARWEAVE
        setStatus('4/6: Augšupielādē failus Arweave tīklā...');
        button.textContent = 'Augšupielādē...';
        
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
            file.txId = receipt.id; // Saglabā ID priekš GitHub Issue
        }

        // 5. IZVEIDO PATH MANIFESTU
        setStatus('5/6: Veido struktūras manifestu...');
        const manifest = {
            manifest: "arweave/paths",
            version: "0.1.0",
            index: { path: "README.md" },
            paths: paths
        };
        // Ja repozitorijā nav README.md, izmantojam pirmo pieejamo failu kā sākumlapu
        if (!paths["README.md"]) {
            manifest.index.path = Object.keys(paths)[0];
        }
        
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

        // 6. BLOCKCHAIN NFT IERAKSTS
        setStatus('6/6: Apstiprini blockchain NFT ierakstu MetaMaskā...');
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
                    name: 'PermRepo',
                    version: '1',
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
                    manifestHash: manifestHash,
                    merkleRoot: merkleRoot,
                    deadline: deadline,
                    nonce: nonce.toString()
                };
                
                const addBackupSignature = await signer.signTypedData(domain, types, value);
                
                const tx = await nftContract.addBackup(
                    tokenId,
                    manifestHash,
                    merkleRoot,
                    `ar://${manifestTxId}`,
                    deadline,
                    addBackupSignature
                );
                
                setStatus('Gaida blockchain transakcijas apstiprinājumu...');
                await tx.wait();
                
            } catch (blockchainError) {
                console.error('Blockchain ieraksts neizdevās:', blockchainError);
                // Turpinām uz GitHub Issue pat ja NFT ieraksts neizdevās
            }
        }

        // 7. PARAKSTS UN GITHUB ISSUE
        setStatus('Ģenerē GitHub atskaiti...');
        button.textContent = 'Veido Issue...';

        const timestamp = Math.floor(Date.now() / 1000);
        const message = [
            'PermRepo Backup Authorization',
            `Repository: ${repo}`, 
            `Timestamp: ${timestamp}`, 
            `Address: ${userAddress}`,
            `UploadedFiles: ${filesWithContent.length}`, 
            `ManifestTxId: ${manifestTxId}`
        ].join('\n');

        const signature = await signer.signMessage(message);
        
        const payload = {
            address: userAddress, 
            signature, 
            message, 
            timestamp,
            uploadedFiles: filesWithContent.map(f => ({ path: f.path, txId: f.txId, size: f.size })), 
            manifestTxId: manifestTxId
        };

        const jsonBody = JSON.stringify(payload, null, 2);
        const body = '```json\n' + jsonBody + '\n```';
        const issueTitle = `[PermRepo Backup] ${userAddress.substring(0, 10)}...`;
        const issueUrl = `https://github.com/${repo}/issues/new?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(body)}`;

        setStatus('Gatavs! Novirzām uz GitHub...');
        
        setTimeout(() => {
            window.location.href = issueUrl;
        }, 1500);

    } catch (e) {
        if (e.code === 'ACTION_REJECTED' || (e.message && e.message.includes('rejected'))) {
            showError('Transakcija vai paraksts tika atcelts MetaMask logā.');
        } else {
            showError('Kļūda: ' + (e.message || e));
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

init();
