import { ethers } from 'ethers';
import { TurboFactory } from '@ardrive/turbo-sdk';
import { InjectedEthereumSigner } from '@dha-team/arbundles';

const CHAIN_ID = '0x14a34';

const NFT_ADDRESS =
    '0xeD3eB455cAeb057a034d7bE2368cdCEA37Faa1d4';

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

/* =========================================================
   INIT
========================================================= */

async function init() {
    document.getElementById('repoInput').value = repoFromUrl;

    const timestampEl = document.getElementById('timestamp');

    if (timestampEl) {
        timestampEl.textContent = new Date().toLocaleString();
    }

    if (filesParam) {
        try {
            filesToUpload = JSON.parse(
                decodeURIComponent(filesParam)
            );

            document.getElementById('fileCount').textContent =
                filesToUpload.length + ' faili';

            const totalSize = filesToUpload.reduce(
                (sum, file) => sum + Number(file.size || 0),
                0
            );

            document.getElementById('totalSize').textContent =
                `${(totalSize / 1024).toFixed(1)} KB`;

        } catch (error) {
            console.error('Failu parametra kļūda:', error);
            filesToUpload = [];
        }
    }

    if (!window.ethereum) {
        showError(
            'Lūdzu, instalē MetaMask vai citu Web3 maku, lai turpinātu.'
        );
        return;
    }

    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [
                {
                    chainId: CHAIN_ID
                }
            ]
        });

        const button = document.getElementById('payButton');

        button.disabled = false;
        button.textContent =
            'Maksāt ar MetaMask un augšupielādēt';

        button.onclick = signAndUpload;

        setStatus('Gatavs augšupielādei');

    } catch (error) {
        console.error(error);

        showError(
            'Kļūda mainot tīklu: ' +
            (error?.message || 'Nezināma kļūda')
        );
    }
}


/* =========================================================
   META MASK
========================================================= */

async function connectMetaMask() {

    if (!window.ethereum) {
        throw new Error(
            'MetaMask nav atrasts.'
        );
    }

    await window.ethereum.request({
        method: 'eth_requestAccounts'
    });

    const provider = new ethers.BrowserProvider(
        window.ethereum
    );

    const signer = await provider.getSigner();

    const address = await signer.getAddress();

    return {
        provider,
        signer,
        address
    };
}


/* =========================================================
   TURBO
========================================================= */

async function createTurboClient(signer, selectedCurrency) {

    /*
     * SVARĪGI:
     *
     * Mēs vairs NEizmantojam:
     *
     * walletAdapter: {
     *     getSigner: () => signer
     * }
     *
     * EVM MetaMask gadījumā izmantojam
     * InjectedEthereumSigner.
     */

    const injectedSigner =
        new InjectedEthereumSigner({
            getSigner: () => signer
        });

    const turbo = TurboFactory.authenticated({
        signer: injectedSigner,
        token: selectedCurrency
    });

    return turbo;
}


/* =========================================================
   DOWNLOAD GITHUB FILES
========================================================= */

async function downloadRepositoryFiles(repo) {

    for (let i = 0; i < filesToUpload.length; i++) {

        const file = filesToUpload[i];

        try {

            const rawUrl =
                `https://raw.githubusercontent.com/${repo}/main/${file.path}`;

            const controller =
                new AbortController();

            const timeoutId =
                setTimeout(
                    () => controller.abort(),
                    10000
                );

            const response =
                await fetch(
                    rawUrl,
                    {
                        signal: controller.signal
                    }
                );

            clearTimeout(timeoutId);

            if (response.ok) {
                file.content =
                    await response.text();
            }

        } catch (error) {

            console.warn(
                `Neizdevās lejupielādēt ${file.path}`,
                error
            );
        }
    }

    return filesToUpload.filter(
        file => file.content != null
    );
}


/* =========================================================
   TURBO BALANCE + TOP UP
========================================================= */

async function ensureTurboCredits(
    turbo,
    filesWithContent,
    selectedCurrency
) {

    const textEncoder =
        new TextEncoder();

    const totalBytes =
        filesWithContent.reduce(
            (sum, file) => {

                const bytes =
                    textEncoder.encode(
                        file.content
                    ).length;

                return sum + bytes;

            },
            0
        );

    setStatus(
        '3/6: Pārbauda Turbo kredītus...'
    );

    /*
     * Esošais Turbo kredītu atlikums.
     */

    const balance =
        await turbo.getBalance();

    const currentBalance =
        BigInt(balance.winc);


    /*
     * Aprēķina nepieciešamo cenu.
     */

    const uploadCosts =
        await turbo.getUploadCosts({
            bytes: totalBytes
        });


    /*
     * SDK var atgriezt masīvu.
     */

    if (!Array.isArray(uploadCosts) ||
        uploadCosts.length === 0) {

        throw new Error(
            'Turbo neatgrieza augšupielādes izmaksas.'
        );
    }


    const costInfo =
        uploadCosts[0];


    if (!costInfo ||
        costInfo.winc == null) {

        throw new Error(
            'Turbo izmaksu dati nav derīgi.'
        );
    }


    const requiredCredits =
        BigInt(costInfo.winc);


    /*
     * Pietiek kredītu.
     */

    if (currentBalance >= requiredCredits) {

        setStatus(
            '3/6: Turbo kredītu pietiek.'
        );

        return;
    }


    /*
     * Nepietiek kredītu.
     *
     * Šeit notiek ĪSTA lietotāja MetaMask
     * maksājuma transakcija.
     */

    setStatus(
        '3/6: Nepietiek kredītu — atver MetaMask...'
    );

    const tokenAmount =
        costInfo.tokenAmount;


    if (tokenAmount == null) {

        throw new Error(
            'Turbo neatgrieza tokenAmount.'
        );
    }


    /*
     * token jau ir:
     *
     * base-eth
     * base-usdc
     *
     * Tāpēc topUpWithTokens izmantojam
     * tieši ar šo token tipu.
     */

    await turbo.topUpWithTokens({
        tokenAmount
    });


    setStatus(
        '3/6: Turbo kredīti papildināti.'
    );
}


/* =========================================================
   UPLOAD FILE
========================================================= */

async function uploadFile(
    turbo,
    file,
    repo,
    textEncoder
) {

    const fileData =
        textEncoder.encode(
            file.content
        );

    const blob =
        new Blob(
            [fileData],
            {
                type: 'text/plain'
            }
        );


    const result =
        await turbo.uploadFile({

            fileStreamFactory:
                () => blob.stream(),

            fileSizeFactory:
                () => blob.size,

            dataItemOpts: {

                tags: [

                    {
                        name: 'App-Name',
                        value: 'PermRepo'
                    },

                    {
                        name: 'Repo',
                        value: repo
                    },

                    {
                        name: 'File-Path',
                        value: file.path
                    },

                    {
                        name: 'Content-Type',
                        value: 'text/plain'
                    },

                    {
                        name: 'Unix-Time',
                        value:
                            String(
                                Math.floor(
                                    Date.now() / 1000
                                )
                            )
                    }

                ]
            }
        });


    return result;
}


/* =========================================================
   UPLOAD ALL FILES
========================================================= */

async function uploadRepositoryFiles(
    turbo,
    filesWithContent,
    repo
) {

    const textEncoder =
        new TextEncoder();

    const paths = {};


    for (
        const file
        of filesWithContent
    ) {

        setStatus(
            `4/6: Augšupielādē ${file.path}...`
        );


        const result =
            await uploadFile(
                turbo,
                file,
                repo,
                textEncoder
            );


        if (!result ||
            !result.id) {

            throw new Error(
                `Turbo neizdevās augšupielādēt ${file.path}.`
            );
        }


        paths[file.path] = {
            id: result.id
        };


        file.txId =
            result.id;
    }


    return paths;
}


/* =========================================================
   CREATE + UPLOAD MANIFEST
========================================================= */

async function createAndUploadManifest(
    turbo,
    repo,
    paths
) {

    setStatus(
        '5/6: Veido manifestu...'
    );


    let indexPath = 'README.md';


    if (!paths[indexPath]) {

        const availablePaths =
            Object.keys(paths);


        if (availablePaths.length === 0) {

            throw new Error(
                'Nav neviena augšupielādēta faila manifestam.'
            );
        }


        indexPath =
            availablePaths[0];
    }


    const manifest = {

        manifest:
            'arweave/paths',

        version:
            '0.2.0',

        index: {
            path: indexPath
        },

        paths,

        metadata: {

            repo,

            timestamp:
                new Date().toISOString(),

            generatedBy:
                'PermRepo v1.0.0'
        }
    };


    const manifestJSON =
        JSON.stringify(
            manifest
        );


    const textEncoder =
        new TextEncoder();


    const manifestData =
        textEncoder.encode(
            manifestJSON
        );


    const manifestBlob =
        new Blob(
            [manifestData],
            {
                type:
                    'application/x.arweave-manifest+json'
            }
        );


    const result =
        await turbo.uploadFile({

            fileStreamFactory:
                () => manifestBlob.stream(),

            fileSizeFactory:
                () => manifestBlob.size,

            dataItemOpts: {

                tags: [

                    {
                        name: 'App-Name',
                        value: 'PermRepo'
                    },

                    {
                        name: 'Type',
                        value: 'path-manifest'
                    },

                    {
                        name: 'Repo',
                        value: repo
                    },

                    {
                        name: 'Content-Type',
                        value:
                            'application/x.arweave-manifest+json'
                    },

                    {
                        name: 'Unix-Time',
                        value:
                            String(
                                Math.floor(
                                    Date.now() / 1000
                                )
                            )
                ]
            }
        });


    if (!result ||
        !result.id) {

        throw new Error(
            'Manifesta augšupielāde neizdevās.'
        );
    }


    return {
        manifest,
        manifestTxId: result.id
    };
}


/* =========================================================
   ADD BACKUP TO NFT
========================================================= */

async function addBackupToNFT(
    provider,
    signer,
    repo,
    manifestTxId
) {

    setStatus(
        '6/6: Pārbauda PermRepo NFT...'
    );


    const manifestHash =
        ethers.id(
            manifestTxId
        );


    const merkleRoot =
        ethers.id(
            manifestTxId
        );


    const deadline =
        Math.floor(
            Date.now() / 1000
        ) + 3600;


    const repoHash =
        ethers.keccak256(
            ethers.AbiCoder
                .defaultAbiCoder()
                .encode(
                    ['string'],
                    [repo]
                )
        );


    const nftReadContract =
        new ethers.Contract(
            NFT_ADDRESS,
            NFT_ABI,
            provider
        );


    const tokenId =
        await nftReadContract.repositoryTokens(
            repoHash
        );


    if (
        !tokenId ||
        tokenId === 0n
    ) {

        throw new Error(
            'Šim repozitorijam nav PermRepo NFT.'
        );
    }


    const backupNumber =
        await nftReadContract.backupCount(
            tokenId
        );


    const nonce =
        await nftReadContract.nonces(
            tokenId
        );


    const domain = {

        name: 'PermRepo',

        version: '1',

        chainId:
            parseInt(
                CHAIN_ID,
                16
            ),

        verifyingContract:
            NFT_ADDRESS
    };


    const types = {

        AddBackup: [

            {
                name: 'tokenId',
                type: 'uint256'
            },

            {
                name: 'backupNumber',
                type: 'uint256'
            },

            {
                name: 'manifestHash',
                type: 'bytes32'
            },

            {
                name: 'merkleRoot',
                type: 'bytes32'
            },

            {
                name: 'deadline',
                type: 'uint256'
            },

            {
                name: 'nonce',
                type: 'uint256'
            }

        ]
    };


    const value = {

        tokenId:
            tokenId.toString(),

        backupNumber:
            (
                backupNumber + 1n
            ).toString(),

        manifestHash,

        merkleRoot,

        deadline,

        nonce:
            nonce.toString()
    };


    setStatus(
        '6/6: Apstiprini NFT ierakstu MetaMask...'
    );


    /*
     * Lietotājs pats paraksta EIP-712.
     */

    const signature =
        await signer.signTypedData(
            domain,
            types,
            value
        );


    /*
     * Lietotājs pats nosūta blockchain
     * transakciju.
     */

    const nftWriteContract =
        new ethers.Contract(
            NFT_ADDRESS,
            NFT_ABI,
            signer
        );


    const tx =
        await nftWriteContract.addBackup(

            tokenId,

            manifestHash,

            merkleRoot,

            `ar://${manifestTxId}`,

            deadline,

            signature
        );


    await tx.wait();


    console.log(
        'Backup blockchain ieraksts:',
        tx.hash
    );


    return tx.hash;
}


/* =========================================================
   GITHUB ISSUE
========================================================= */

async function createGitHubIssue(
    repo,
    userAddress,
    signer,
    filesWithContent,
    manifestTxId
) {

    setStatus(
        'Veido GitHub atskaiti...'
    );


    const timestamp =
        Math.floor(
            Date.now() / 1000
        );


    const message = [

        'PermRepo Backup Authorization',

        `Repository: ${repo}`,

        `Timestamp: ${timestamp}`,

        `Address: ${userAddress}`,

        `UploadedFiles: ${filesWithContent.length}`,

        `ManifestTxId: ${manifestTxId}`

    ].join('\n');


    const signature =
        await signer.signMessage(
            message
        );


    const payload = {

        address:
            userAddress,

        signature,

        message,

        timestamp,

        uploadedFiles:
            filesWithContent.map(
                file => ({

                    path:
                        file.path,

                    txId:
                        file.txId,

                    size:
                        file.size

                })
            ),

        manifestTxId
    };


    const jsonBody =
        JSON.stringify(
            payload,
            null,
            2
        );


    const body =
        '```json\n' +
        jsonBody +
        '\n```';


    const issueTitle =
        `[PermRepo Backup] ${userAddress.substring(0, 10)}...`;


    const issueUrl =
        `https://github.com/${repo}/issues/new` +
        `?title=${encodeURIComponent(issueTitle)}` +
        `&body=${encodeURIComponent(body)}`;


    setStatus(
        'Gatavs! Novirzām uz GitHub...'
    );


    setTimeout(
        () => {
            window.location.href =
                issueUrl;
        },
        1500
    );
}


/* =========================================================
   MAIN PROCESS
========================================================= */

async function signAndUpload() {

    let repo =
        document
            .getElementById('repoInput')
            .value
            .trim();


    repo =
        repo.replace(
            /^https?:\/\/(www\.)?github\.com\//i,
            ''
        );


    const repoParts =
        repo.split('/');


    if (
        repoParts.length >= 2
    ) {

        repo =
            `${repoParts[0]}/${repoParts[1]}`;
    }


    if (
        !repo ||
        !repo.includes('/')
    ) {

        showError(
            'Lūdzu, ievadi pareizu repozitorija nosaukumu.'
        );

        return;
    }


    if (
        filesToUpload.length === 0
    ) {

        showError(
            'Nav atpazītu failu augšupielādei.'
        );

        return;
    }


    const button =
        document.getElementById(
            'payButton'
        );


    button.disabled = true;

    showError('');


    try {

        /* -----------------------------------------
           1. GITHUB FILES
        ----------------------------------------- */

        button.textContent =
            'Lejupielādē failus...';

        setStatus(
            '1/6: Lejupielādē failus no GitHub...'
        );


        const filesWithContent =
            await downloadRepositoryFiles(
                repo
            );


        if (
            filesWithContent.length === 0
        ) {

            throw new Error(
                'Neizdevās lejupielādēt nevienu failu.'
            );
        }


        /* -----------------------------------------
           2. METAMASK
        ----------------------------------------- */

        button.textContent =
            'Savienojas ar MetaMask...';

        setStatus(
            '2/6: Savienojas ar MetaMask...'
        );


        const {
            provider,
            signer,
            address
        } =
            await connectMetaMask();


        const selectedCurrency =
            document
                .getElementById(
                    'currencySelect'
                )
                .value;


        /* -----------------------------------------
           3. TURBO
        ----------------------------------------- */

        const turbo =
            await createTurboClient(
                signer,
                selectedCurrency
            );


        await ensureTurboCredits(
            turbo,
            filesWithContent,
            selectedCurrency
        );


        /* -----------------------------------------
           4. FILE UPLOAD
        ----------------------------------------- */

        setStatus(
            '4/6: Augšupielādē failus Arweave...'
        );


        const paths =
            await uploadRepositoryFiles(
                turbo,
                filesWithContent,
                repo
            );


        /* -----------------------------------------
           5. MANIFEST
        ----------------------------------------- */

        const {
            manifestTxId
        } =
            await createAndUploadManifest(
                turbo,
                repo,
                paths
            );


        /* -----------------------------------------
           6. NFT
        ----------------------------------------- */

        await addBackupToNFT(
            provider,
            signer,
            repo,
            manifestTxId
        );


        /* -----------------------------------------
           GITHUB REPORT
        ----------------------------------------- */

        await createGitHubIssue(
            repo,
            address,
            signer,
            filesWithContent,
            manifestTxId
        );


    } catch (error) {

        console.error(
            'PermRepo backup error:',
            error
        );


        if (
            error?.code ===
            'ACTION_REJECTED'
        ) {

            showError(
                'Transakcija vai paraksts tika atcelts MetaMask.'
            );

        } else {

            showError(
                'Kļūda: ' +
                (
                    error?.shortMessage ||
                    error?.message ||
                    'Nezināma kļūda'
                )
            );
        }


        button.disabled = false;

        button.textContent =
            'Mēģināt vēlreiz';
    }
}


/* =========================================================
   UI HELPERS
========================================================= */

function setStatus(message) {

    const element =
        document.getElementById(
            'status'
        );


    if (element) {
        element.textContent =
            message;
    }
}


function showError(message) {

    const element =
        document.getElementById(
            'error'
        );


    if (element) {
        element.textContent =
            message;
    }
}


/* =========================================================
   START
========================================================= */

init();
