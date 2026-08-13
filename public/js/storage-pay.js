import { ethers } from 'ethers';
import { TurboFactory } from '@ardrive/turbo-sdk/web';
import { InjectedEthereumSigner } from '@dha-team/arbundles';

const CHAIN_ID = '0x14a34';
const CHAIN_ID_DECIMAL = 84532;

const NFT_ADDRESS = '0xeD3eB455cAeb057a034d7bE2368cdCEA37Faa1d4';

const NFT_ABI = [
    'function addBackup(uint256 tokenId, bytes32 manifestHash, bytes32 merkleRoot, string calldata manifestURI, uint256 deadline, bytes calldata signature) external',
    'function repositoryTokens(bytes32 repoHash) external view returns (uint256)',
    'function backupCount(uint256) view returns (uint256)',
    'function nonces(uint256) view returns (uint256)'
];

const params = new URLSearchParams(window.location.search);

const repoFromUrl = params.get('repo') || '';
const filesParam = params.get('files') || '';

let filesToUpload = [];

/**
 * ============================================================
 * INIT
 * ============================================================
 */

async function init() {
    const repoInput = document.getElementById('repoInput');
    const timestampEl = document.getElementById('timestamp');

    if (repoInput) {
        repoInput.value = repoFromUrl;
    }

    if (timestampEl) {
        timestampEl.textContent = new Date().toLocaleString();
    }

    /**
     * --------------------------------------------------------
     * Failu saraksta ielāde no URL
     * --------------------------------------------------------
     */

    if (filesParam) {
        try {
            filesToUpload = JSON.parse(
                decodeURIComponent(filesParam)
            );

            const fileCountEl = document.getElementById('fileCount');

            if (fileCountEl) {
                fileCountEl.textContent =
                    `${filesToUpload.length} faili`;
            }

            const totalSize = filesToUpload.reduce(
                (sum, file) => sum + Number(file.size || 0),
                0
            );

            const totalSizeEl = document.getElementById('totalSize');

            if (totalSizeEl) {
                totalSizeEl.textContent =
                    `${(totalSize / 1024).toFixed(1)} KB`;
            }

        } catch (error) {
            console.error(
                'Neizdevās nolasīt failu sarakstu:',
                error
            );

            filesToUpload = [];

            showError(
                'Neizdevās nolasīt failu sarakstu.'
            );
        }
    }

    /**
     * --------------------------------------------------------
     * Pārbauda MetaMask
     * --------------------------------------------------------
     */

    if (!window.ethereum) {
        showError(
            'Lūdzu, instalē MetaMask vai citu Web3 maku, lai turpinātu.'
        );

        return;
    }

    /**
     * --------------------------------------------------------
     * Pārslēdz uz Base Sepolia
     * --------------------------------------------------------
     */

    try {
        await switchToBaseSepolia();

        const button = document.getElementById('payButton');

        if (!button) {
            throw new Error(
                'Netika atrasta payButton poga.'
            );
        }

        button.disabled = false;

        button.textContent =
            'Maksāt ar MetaMask un augšupielādēt';

        button.onclick = signAndUpload;

        setStatus(
            'Gatavs augšupielādei'
        );

    } catch (error) {
        console.error(
            'Kļūda mainot tīklu:',
            error
        );

        showError(
            'Kļūda mainot tīklu: ' +
            (error?.message || 'Nezināma kļūda')
        );
    }
}

/**
 * ============================================================
 * BASE SEPOLIA
 * ============================================================
 */

async function switchToBaseSepolia() {
    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [
                {
                    chainId: CHAIN_ID
                }
            ]
        });

    } catch (error) {

        /**
         * 4902 = tīkls nav pievienots MetaMask
         */

        if (error?.code === 4902) {

            await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [
                    {
                        chainId: CHAIN_ID,
                        chainName: 'Base Sepolia',
                        nativeCurrency: {
                            name: 'Ether',
                            symbol: 'ETH',
                            decimals: 18
                        },
                        rpcUrls: [
                            'https://sepolia.base.org'
                        ],
                        blockExplorerUrls: [
                            'https://sepolia-sepolia.blockscout.com'
                        ]
                    }
                ]
            });

        } else {
            throw error;
        }
    }
}

/**
 * ============================================================
 * NORMALIZĒ REPOZITORIJA NOSAUKUMU
 * ============================================================
 */

function normalizeRepository(repository) {
    let repo = repository.trim();

    repo = repo.replace(
        /^https?:\/\/(www\.)?github\.com\//i,
        ''
    );

    repo = repo.replace(
        /\/+$/,
        ''
    );

    const repoParts = repo.split('/');

    if (repoParts.length >= 2) {
        repo =
            `${repoParts[0]}/${repoParts[1]}`;
    }

    return repo;
}

/**
 * ============================================================
 * META MASK + ETHERS
 * ============================================================
 */

async function connectMetaMask() {
    if (!window.ethereum) {
        throw new Error(
            'MetaMask nav instalēts.'
        );
    }

    /**
     * Pieprasām lietotāja kontu.
     */

    const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
    });

    if (!accounts || accounts.length === 0) {
        throw new Error(
            'MetaMask konts nav pieejams.'
        );
    }

    /**
     * Dažiem browseriem window.ethereum var būt
     * vairāku provideru objekts.
     *
     * Ja pieejams MetaMask provideris, izmantojam to.
     */

    let ethereumProvider = window.ethereum;

    if (
        Array.isArray(window.ethereum.providers)
    ) {
        const metaMaskProvider =
            window.ethereum.providers.find(
                provider => provider.isMetaMask
            );

        if (metaMaskProvider) {
            ethereumProvider =
                metaMaskProvider;
        }
    }

    /**
     * Ethers BrowserProvider.
     */

    const provider =
        new ethers.BrowserProvider(
            ethereumProvider
        );

    /**
     * Pārbaudām tīklu.
     */

    const network =
        await provider.getNetwork();

    if (
        Number(network.chainId) !== CHAIN_ID_DECIMAL
    ) {
        throw new Error(
            'MetaMask nav pieslēgts Base Sepolia tīklam.'
        );
    }

    /**
     * Ethers signer.
     *
     * Šis signeris NEIET uz serveri.
     * Tas izmanto MetaMask.
     */

    const signer =
        await provider.getSigner();

    const userAddress =
        await signer.getAddress();

    return {
        provider,
        signer,
        userAddress
    };
}

/**
 * ============================================================
 * TURBO
 * ============================================================
 *
 * Šeit ir galvenā izmaiņa.
 *
 * NEIZMANTOJAM:
 *
 *     EthereumSigner(privateKey)
 *
 * NEIZMANTOJAM:
 *
 *     walletAdapter: {
 *         getSigner: () => signer
 *     }
 *
 * Izmantojam:
 *
 *     InjectedEthereumSigner
 *
 * ar MetaMask / ethers JsonRpcSigner.
 *
 * AR.IO browser dokumentācija tieši rāda šo modeli.
 * ============================================================
 */

async function createTurboClient(signer) {

    const selectedCurrencyElement =
        document.getElementById(
            'currencySelect'
        );

    if (!selectedCurrencyElement) {
        throw new Error(
            'Netika atrasts currencySelect.'
        );
    }

    const selectedCurrency =
        selectedCurrencyElement.value;

    /**
     * Atļautie Base token nosaukumi.
     *
     * Ja HTML select jau dod "base-eth"
     * vai "base-usdc", izmantojam to.
     *
     * Vecākā konfigurācijā var būt "ethereum";
     * to normalizējam uz Base ETH.
     */

    let turboToken = selectedCurrency;

    if (
        selectedCurrency === 'ethereum'
    ) {
        turboToken = 'base-eth';
    }

    if (
        selectedCurrency === 'eth'
    ) {
        turboToken = 'base-eth';
    }

    /**
     * Šobrīd PermRepo strādā Base Sepolia.
     *
     * Tāpēc nevajadzētu nejauši izvēlēties
     * Ethereum mainnet tokenu.
     */

    if (
        turboToken !== 'base-eth' &&
        turboToken !== 'base-usdc'
    ) {
        throw new Error(
            `Nepareizs Turbo token Base Sepolia plūsmai: ${turboToken}`
        );
    }

    /**
     * Turbo InjectedEthereumSigner.
     *
     * Šis ir MetaMask signer bridge uz Turbo SDK.
     */

    const turboSigner =
        new InjectedEthereumSigner({
            getSigner: () => signer
        });

    /**
     * Izveido authenticated Turbo client.
     *
     * PRIVATE KEY NAV NEPIECIEŠAMS.
     */

    const turbo =
        await TurboFactory.authenticated({
            signer: turboSigner,
            token: turboToken
        });

    return {
        turbo,
        turboSigner,
        turboToken
    };
}

/**
 * ============================================================
 * DOWNLOAD GITHUB FILE
 * ============================================================
 */

async function downloadGitHubFile(
    repo,
    file
) {
    const rawUrl =
        `https://raw.githubusercontent.com/${repo}/main/${file.path}`;

    const controller =
        new AbortController();

    const timeoutId =
        setTimeout(
            () => controller.abort(),
            10000
        );

    try {
        const response =
            await fetch(
                rawUrl,
                {
                    signal:
                        controller.signal
                }
            );

        if (!response.ok) {
            return null;
        }

        return await response.text();

    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * ============================================================
 * GALVENĀ FUNKCIJA
 * ============================================================
 */

async function signAndUpload() {

    let repo =
        normalizeRepository(
            document.getElementById(
                'repoInput'
            )?.value || ''
        );

    /**
     * --------------------------------------------------------
     * Validē repo
     * --------------------------------------------------------
     */

    if (
        !repo ||
        !repo.includes('/')
    ) {
        showError(
            'Lūdzu, ievadi pareizu repozitorija nosaukumu ' +
            '(piem., lietotajs/repo)'
        );

        return;
    }

    /**
     * --------------------------------------------------------
     * Validē failus
     * --------------------------------------------------------
     */

    if (
        !Array.isArray(filesToUpload) ||
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

    if (button) {
        button.disabled = true;
    }

    showError('');

    try {

        /**
         * ====================================================
         * 1. LEJUPIELĀDĒ FAILUS NO GITHUB
         * ====================================================
         */

        if (button) {
            button.textContent =
                'Lejupielādē failus...';
        }

        setStatus(
            '1/7: Lejupielādē failus no GitHub...'
        );

        for (
            let i = 0;
            i < filesToUpload.length;
            i++
        ) {

            const file =
                filesToUpload[i];

            try {

                const content =
                    await downloadGitHubFile(
                        repo,
                        file
                    );

                if (content !== null) {
                    file.content =
                        content;
                }

            } catch (error) {

                console.warn(
                    `Neizdevās lejupielādēt ${file.path}:`,
                    error
                );
            }
        }

        /**
         * Tikai faili, kuriem saturs tiešām
         * ir lejupielādēts.
         */

        const filesWithContent =
            filesToUpload.filter(
                file =>
                    file.content !== undefined &&
                    file.content !== null
            );

        if (
            filesWithContent.length === 0
        ) {
            throw new Error(
                'Neizdevās lejupielādēt nevienu failu.'
            );
        }

        /**
         * ====================================================
         * 2. METAMASK
         * ====================================================
         */

        if (button) {
            button.textContent =
                'Savienojas ar MetaMask...';
        }

        setStatus(
            '2/7: Inicializē MetaMask...'
        );

        const {
            provider,
            signer,
            userAddress
        } = await connectMetaMask();

        console.log(
            'MetaMask adrese:',
            userAddress
        );

        /**
         * ====================================================
         * 3. TURBO
         * ====================================================
         */

        if (button) {
            button.textContent =
                'Inicializē Turbo...';
        }

        setStatus(
            '3/7: Inicializē Turbo ar MetaMask...'
        );

        const {
            turbo,
            turboToken
        } = await createTurboClient(
            signer
        );

        console.log(
            'Turbo token:',
            turboToken
        );

        /**
         * ====================================================
         * 4. PĀRBAUDA TURBO KREDĪTUS
         * ====================================================
         */

        if (button) {
            button.textContent =
                'Pārbauda Turbo kredītus...';
        }

        setStatus(
            '4/7: Aprēķina Turbo izmaksas...'
        );

        const textEncoder =
            new TextEncoder();

        /**
         * Aprēķina kopējo failu izmēru.
         *
         * Svarīgi:
         * getUploadCosts sagaida bytes MASĪVU,
         * nevis vienu number.
         */

        const totalBytes =
            filesWithContent.reduce(
                (sum, file) =>
                    sum +
                    textEncoder.encode(
                        file.content
                    ).length,
                0
            );

        console.log(
            'Kopējais upload izmērs:',
            totalBytes,
            'bytes'
        );

        /**
         * Turbo balance.
         */

        const {
            winc: currentBalance
        } = await turbo.getBalance();

        console.log(
            'Turbo balance:',
            currentBalance
        );

        /**
         * SVARĪGI:
         *
         * bytes: [totalBytes]
         *
         * nevis:
         *
         * bytes: totalBytes
         *
         * Pretējā gadījumā SDK mēģina
         * izpildīt .map() uz number.
         */

        const uploadCosts =
            await turbo.getUploadCosts({
                bytes: [
                    totalBytes
                ]
            });

        if (
            !Array.isArray(uploadCosts) ||
            uploadCosts.length === 0
        ) {
            throw new Error(
                'Turbo neatgrieza upload izmaksu aprēķinu.'
            );
        }

        const costInfo =
            uploadCosts[0];

        if (!costInfo) {
            throw new Error(
                'Turbo izmaksu informācija nav pieejama.'
            );
        }

        console.log(
            'Turbo upload cost:',
            costInfo
        );

        /**
         * ====================================================
         * 5. JA NEPIETIEK KREDĪTU — METAMASK TOP-UP
         * ====================================================
         */

        if (
            BigInt(currentBalance) <
            BigInt(costInfo.winc)
        ) {

            if (button) {
                button.textContent =
                    'Apstiprini Turbo maksājumu MetaMask...';
            }

            setStatus(
                '5/7: Nepietiek Turbo kredītu — ' +
                'apstiprini maksājumu MetaMask...'
            );

            /**
             * topUpWithTokens:
             *
             * tokenAmount ir konkrētā tokena
             * mazākā vienība.
             *
             * Tokena tips jau ir noteikts
             * Turbo klientā ar:
             *
             * token: turboToken
             */

            if (
                costInfo.tokenAmount === undefined ||
                costInfo.tokenAmount === null
            ) {
                throw new Error(
                    'Turbo neatrada nepieciešamo tokenAmount.'
                );
            }

            console.log(
                'Turbo top-up token amount:',
                costInfo.tokenAmount
            );

            const topUpResult =
                await turbo.topUpWithTokens({
                    tokenAmount:
                        costInfo.tokenAmount
                });

            console.log(
                'Turbo top-up result:',
                topUpResult
            );

            setStatus(
                'Turbo kredīti papildināti. Turpinām...'
            );

        } else {

            setStatus(
                'Turbo kredītu pietiek. Turpinām...'
            );
        }

        /**
         * ====================================================
         * 6. AUGŠUPIELĀDE ARWEAVE
         * ====================================================
         */

        if (button) {
            button.textContent =
                'Augšupielādē Arweave...';
        }

        setStatus(
            '6/7: Augšupielādē failus Arweave...'
        );

        const paths = {};

        for (
            const file
            of filesWithContent
        ) {

            const fileData =
                textEncoder.encode(
                    file.content
                );

            const blob =
                new Blob([
                    fileData
                ]);

            const result =
                await turbo.uploadFile({
                    fileStreamFactory:
                        () => blob.stream(),

                    fileSizeFactory:
                        () => blob.size,

                    dataItemOpts: {
                        tags: [
                            {
                                name:
                                    'App-Name',
                                value:
                                    'PermRepo'
                            },
                            {
                                name:
                                    'Repo',
                                value:
                                    repo
                            },
                            {
                                name:
                                    'File-Path',
                                value:
                                    file.path
                            },
                            {
                                name:
                                    'Content-Type',
                                value:
                                    'text/plain'
                            },
                            {
                                name:
                                    'Unix-Time',
                                value:
                                    String(
                                        Math.floor(
                                            Date.now() /
                                            1000
                                        )
                                    )
                            }
                        ]
                    }
                });

            paths[file.path] = {
                id:
                    result.id
            };

            file.txId =
                result.id;

            console.log(
                'Uploaded:',
                file.path,
                result.id
            );
        }

        /**
         * ====================================================
         * MANIFEST
         * ====================================================
         */

        setStatus(
            '6/7: Veido manifestu...'
        );

        const manifest = {
            manifest:
                'arweave/paths',

            version:
                '0.2.0',

            index: {
                path:
                    'README.md'
            },

            paths:
                paths,

            metadata: {
                repo:
                    repo,

                timestamp:
                    new Date().toISOString(),

                generatedBy:
                    'PermRepo v1.0.0'
            }
        };

        /**
         * Ja README.md nav uploadēts,
         * izmantojam pirmo pieejamo failu.
         */

        if (
            !paths['README.md']
        ) {
            const uploadedPaths =
                Object.keys(paths);

            if (
                uploadedPaths.length === 0
            ) {
                throw new Error(
                    'Manifestam nav neviena faila.'
                );
            }

            manifest.index.path =
                uploadedPaths[0];
        }

        const manifestData =
            textEncoder.encode(
                JSON.stringify(
                    manifest
                )
            );

        const manifestBlob =
            new Blob([
                manifestData
            ]);

        const manifestResult =
            await turbo.uploadFile({
                fileStreamFactory:
                    () =>
                        manifestBlob.stream(),

                fileSizeFactory:
                    () =>
                        manifestBlob.size,

                dataItemOpts: {
                    tags: [
                        {
                            name:
                                'App-Name',
                            value:
                                'PermRepo'
                        },
                        {
                            name:
                                'Type',
                            value:
                                'path-manifest'
                        },
                        {
                            name:
                                'Repo',
                            value:
                                repo
                        },
                        {
                            name:
                                'Content-Type',
                            value:
                                'application/x.arweave-manifest+json'
                        },
                        {
                            name:
                                'Unix-Time',
                            value:
                                String(
                                    Math.floor(
                                        Date.now() /
                                        1000
                                    )
                                )
                        }
                    ]
                }
            });

        const manifestTxId =
            manifestResult.id;

        console.log(
            'Manifest TX:',
            manifestTxId
        );

        /**
         * ====================================================
         * 7. BLOCKCHAIN — ADD BACKUP
         * ====================================================
         */

        setStatus(
            '7/7: Apstiprini blockchain ierakstu MetaMask...'
        );

        if (button) {
            button.textContent =
                'Paraksti NFT ierakstu...';
        }

        /**
         * Manifest hash.
         *
         * Šeit saglabājam tavu esošo loģiku:
         * hash no manifest transaction ID.
         */

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

        /**
         * Read-only NFT contract.
         */

        const nftReadContract =
            new ethers.Contract(
                NFT_ADDRESS,
                NFT_ABI,
                provider
            );

        const tokenId =
            await nftReadContract
                .repositoryTokens(
                    repoHash
                );

        /**
         * Ja repository NFT eksistē,
         * pievienojam backup ierakstu.
         */

        if (
            tokenId &&
            tokenId !== 0n
        ) {

            const backupNumber =
                await nftReadContract
                    .backupCount(
                        tokenId
                    );

            const nonce =
                await nftReadContract
                    .nonces(
                        tokenId
                    );

            /**
             * EIP-712 domain.
             */

            const domain = {
                name:
                    'PermRepo',

                version:
                    '1',

                chainId:
                    CHAIN_ID_DECIMAL,

                verifyingContract:
                    NFT_ADDRESS
            };

            /**
             * EIP-712 type.
             */

            const types = {
                AddBackup: [
                    {
                        name:
                            'tokenId',
                        type:
                            'uint256'
                    },
                    {
                        name:
                            'backupNumber',
                        type:
                            'uint256'
                    },
                    {
                        name:
                            'manifestHash',
                        type:
                            'bytes32'
                    },
                    {
                        name:
                            'merkleRoot',
                        type:
                            'bytes32'
                    },
                    {
                        name:
                            'deadline',
                        type:
                            'uint256'
                    },
                    {
                        name:
                            'nonce',
                        type:
                            'uint256'
                    }
                ]
            };

            /**
             * EIP-712 value.
             */

            const value = {
                tokenId:
                    tokenId.toString(),

                backupNumber:
                    (
                        backupNumber + 1n
                    ).toString(),

                manifestHash:
                    manifestHash,

                merkleRoot:
                    merkleRoot,

                deadline:
                    deadline,

                nonce:
                    nonce.toString()
            };

            /**
             * Lietotājs paraksta AddBackup.
             */

            const addBackupSignature =
                await signer.signTypedData(
                    domain,
                    types,
                    value
                );

            console.log(
                'AddBackup EIP-712 signature:',
                addBackupSignature
            );

            /**
             * Write contract.
             *
             * Šī transakcija notiek tieši
             * no lietotāja MetaMask.
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

                    addBackupSignature
                );

            console.log(
                'Blockchain TX nosūtīts:',
                tx.hash
            );

            await tx.wait();

            console.log(
                'Blockchain ieraksts veiksmīgs:',
                tx.hash
            );

        } else {

            console.warn(
                'Šim repository nav atrasts PermRepo NFT.',
                repo
            );
        }

        /**
         * ====================================================
         * GITHUB REPORT
         * ====================================================
         */

        setStatus(
            'Ģenerē GitHub atskaiti...'
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

        /**
         * Paraksta lietotāja MetaMask.
         */

        const signature =
            await signer.signMessage(
                message
            );

        const payload = {
            address:
                userAddress,

            signature:
                signature,

            message:
                message,

            timestamp:
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

            manifestTxId:
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

    } catch (error) {

        console.error(
            'PermRepo backup kļūda:',
            error
        );

        if (
            error?.code ===
            'ACTION_REJECTED'
        ) {

            showError(
                'Transakcija vai paraksts tika atcelts MetaMask logā.'
            );

        } else if (
            error?.code ===
            4001
        ) {

            showError(
                'Darbība tika atcelta MetaMask logā.'
            );

        } else {

            showError(
                'Kļūda: ' +
                (
                    error?.message ||
                    'Nezināma kļūda'
                )
            );
        }

        if (button) {
            button.disabled = false;

            button.textContent =
                'Mēģināt vēlreiz';
        }
    }
}

/**
 * ============================================================
 * UI HELPERS
 * ============================================================
 */

function setStatus(message) {
    const status =
        document.getElementById(
            'status'
        );

    if (status) {
        status.textContent =
            message;
    }
}

function showError(message) {
    const error =
        document.getElementById(
            'error'
        );

    if (error) {
        error.textContent =
            message;
    }
}

/**
 * ============================================================
 * START
 * ============================================================
 */

init();
