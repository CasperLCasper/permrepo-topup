import { ethers } from "ethers";
import { TurboFactory } from "@ardrive/turbo-sdk";
import { InjectedEthereumSigner } from "@dha-team/arbundles";


// ============================================================
// KONFIGURĀCIJA
// ============================================================

const CHAIN_ID = "0x14a34"; // Base Sepolia

const CHAIN_ID_DECIMAL = 84532;

const NFT_ADDRESS =
    "0xeD3eB455cAeb057a034d7bE2368cdCEA37Faa1d4";


// ============================================================
// NFT ABI
// ============================================================

const NFT_ABI = [
    "function addBackup(uint256 tokenId, bytes32 manifestHash, bytes32 merkleRoot, string calldata manifestURI, uint256 deadline, bytes calldata signature) external",

    "function repositoryTokens(bytes32 repoHash) external view returns (uint256)",

    "function backupCount(uint256 tokenId) external view returns (uint256)",

    "function nonces(uint256 tokenId) external view returns (uint256)"
];


// ============================================================
// URL PARAMETRI
// ============================================================

const params =
    new URLSearchParams(window.location.search);

const repoFromUrl =
    params.get("repo") || "";

const filesParam =
    params.get("files") || "";


// ============================================================
// GLOBĀLAIS STĀVOKLIS
// ============================================================

let filesToUpload = [];

let provider = null;

let metamaskSigner = null;

let turboSigner = null;

let turbo = null;

let userAddress = null;


// ============================================================
// DOM PALĪGPROGRAMMAS
// ============================================================

function setStatus(message) {

    const element =
        document.getElementById("status");

    if (element) {
        element.textContent = message;
    }
}


function showError(message) {

    const element =
        document.getElementById("error");

    if (element) {
        element.textContent = message || "";
    }
}


function setButtonText(message) {

    const button =
        document.getElementById("payButton");

    if (button) {
        button.textContent = message;
    }
}


function setButtonDisabled(value) {

    const button =
        document.getElementById("payButton");

    if (button) {
        button.disabled = value;
    }
}


function formatAddress(address) {

    if (!address) {
        return "-";
    }

    return (
        address.substring(0, 6) +
        "..." +
        address.substring(address.length - 4)
    );
}


function formatBytes(bytes) {

    if (!Number.isFinite(bytes) || bytes <= 0) {
        return "0 B";
    }

    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}


// ============================================================
// REPO NORMALIZĀCIJA
// ============================================================

function normalizeRepository(repository) {

    let repo =
        String(repository || "").trim();

    repo =
        repo.replace(
            /^https?:\/\/(www\.)?github\.com\//i,
            ""
        );

    repo =
        repo.replace(/^\/+|\/+$/g, "");

    const parts =
        repo.split("/").filter(Boolean);

    if (parts.length < 2) {
        throw new Error(
            "Lūdzu, ievadi pareizu GitHub repozitoriju, piemēram: lietotajs/repo"
        );
    }

    return `${parts[0]}/${parts[1]}`;
}


// ============================================================
// FAILU PARAMETRU IELĀDE
// ============================================================

function loadFilesFromURL() {

    if (!filesParam) {
        filesToUpload = [];
        return;
    }

    try {

        const decoded =
            decodeURIComponent(filesParam);

        const parsed =
            JSON.parse(decoded);

        if (!Array.isArray(parsed)) {
            throw new Error(
                "Failu parametrs nav masīvs."
            );
        }

        filesToUpload =
            parsed.map((file) => ({
                path: String(file.path || ""),
                size: Number(file.size || 0),
                content: file.content,
                txId: null
            }));

    } catch (error) {

        console.error(
            "Neizdevās nolasīt failu parametrus:",
            error
        );

        filesToUpload = [];

        showError(
            "Neizdevās nolasīt failu sarakstu no URL."
        );
    }
}


// ============================================================
// UI FAILU INFORMĀCIJA
// ============================================================

function updateFileInformation() {

    const fileCountElement =
        document.getElementById("fileCount");

    const totalSizeElement =
        document.getElementById("totalSize");

    if (!fileCountElement || !totalSizeElement) {
        return;
    }

    fileCountElement.textContent =
        `${filesToUpload.length} faili`;

    const totalSize =
        filesToUpload.reduce(
            (sum, file) =>
                sum + Number(file.size || 0),
            0
        );

    totalSizeElement.textContent =
        formatBytes(totalSize);
}


// ============================================================
// META MASK SAVIENOŠANA
// ============================================================

async function connectMetaMask() {

    if (!window.ethereum) {

        throw new Error(
            "MetaMask nav atrasts. Lūdzu, instalē MetaMask."
        );
    }


    setStatus(
        "Savienojas ar MetaMask..."
    );


    // Pieprasām kontu

    const accounts =
        await window.ethereum.request({
            method: "eth_requestAccounts"
        });


    if (
        !accounts ||
        accounts.length === 0
    ) {

        throw new Error(
            "MetaMask neatgrieza nevienu kontu."
        );
    }


    // Pārbaudām tīklu

    const currentChainId =
        await window.ethereum.request({
            method: "eth_chainId"
        });


    if (
        currentChainId.toLowerCase() !==
        CHAIN_ID.toLowerCase()
    ) {

        try {

            await window.ethereum.request({
                method: "wallet_switchEthereumChain",
                params: [
                    {
                        chainId: CHAIN_ID
                    }
                ]
            });

        } catch (switchError) {

            console.error(
                "Tīkla maiņas kļūda:",
                switchError
            );

            throw new Error(
                "Lūdzu, pārslēdz MetaMask uz Base Sepolia."
            );
        }
    }


    // Ethers BrowserProvider

    provider =
        new ethers.BrowserProvider(
            window.ethereum
        );


    // Ethers signer

    metamaskSigner =
        await provider.getSigner();


    userAddress =
        await metamaskSigner.getAddress();


    // UI

    const walletRow =
        document.getElementById("walletRow");

    const walletAddress =
        document.getElementById("walletAddress");

    if (walletRow) {
        walletRow.style.display = "flex";
    }

    if (walletAddress) {
        walletAddress.textContent =
            formatAddress(userAddress);
    }


    return {
        provider,
        signer: metamaskSigner,
        address: userAddress
    };
}


// ============================================================
// TURBO INICIALIZĀCIJA
// ============================================================

async function initializeTurbo() {

    if (!window.ethereum) {
        throw new Error(
            "MetaMask nav pieejams."
        );
    }


    if (!metamaskSigner) {
        await connectMetaMask();
    }


    setStatus(
        "Inicializē Turbo MetaMask parakstītāju..."
    );


    /*
     * SVARĪGI:
     *
     * Mēs NEIZMANTOJAM:
     *
     * walletAdapter: {
     *     getSigner: () => signer
     * }
     *
     * Mēs izmantojam tieši:
     *
     * InjectedEthereumSigner
     *
     * Tas ļauj Turbo SDK izmantot MetaMask
     * bez privātās atslēgas serverī.
     */

    const providerWrapper = {

        getSigner: () => ({

            signMessage: async (
                message
            ) => {

                if (!window.ethereum) {

                    throw new Error(
                        "MetaMask vairs nav pieejams."
                    );
                }


                const accounts =
                    await window.ethereum.request({
                        method: "eth_accounts"
                    });


                if (
                    !accounts ||
                    accounts.length === 0
                ) {

                    throw new Error(
                        "MetaMask konts nav pievienots."
                    );
                }


                let messageToSign;


                /*
                 * Turbo/arbundles var nodot:
                 *
                 * string
                 *
                 * vai
                 *
                 * Uint8Array
                 */

                if (
                    typeof message === "string"
                ) {

                    messageToSign =
                        message;

                } else {

                    const bytes =
                        new Uint8Array(message);

                    messageToSign =
                        "0x" +
                        Array.from(bytes)
                            .map(
                                (byte) =>
                                    byte
                                        .toString(16)
                                        .padStart(2, "0")
                            )
                            .join("");
                }


                return await window.ethereum.request({

                    method: "personal_sign",

                    params: [
                        messageToSign,
                        accounts[0]
                    ]

                });
            }

        })

    };


    /*
     * ŠIS ir galvenais punkts.
     *
     * InjectedEthereumSigner pats izmanto MetaMask.
     * Nekādas privateKey vērtības šeit nav.
     */

    turboSigner =
        new InjectedEthereumSigner(
            providerWrapper
        );


    /*
     * Publiskā atslēga jāinicializē pirms
     * Turbo authenticated klienta izmantošanas.
     */

    if (
        typeof turboSigner.setPublicKey ===
        "function"
    ) {

        await turboSigner.setPublicKey();
    }


    const selectedCurrency =
        document.getElementById(
            "currencySelect"
        ).value;


    if (
        selectedCurrency !== "base-eth" &&
        selectedCurrency !== "base-usdc"
    ) {

        throw new Error(
            "Neatbalstīta Base valūta."
        );
    }


    /*
     * Base Sepolia:
     *
     * base-eth
     * base-usdc
     *
     * Šeit nav privateKey.
     */

    turbo =
        TurboFactory.authenticated({

            signer: turboSigner,

            token: selectedCurrency,

            paymentServiceConfig: {
                url:
                    "https://payment.services.ar-io.dev"
            },

            uploadServiceConfig: {
                url:
                    "https://upload.services.ar-io.dev"
            }

        });


    return turbo;
}


// ============================================================
// GITHUB FAILU LEJUPIELĀDE
// ============================================================

async function downloadRepositoryFiles(repo) {

    setStatus(
        "1/7: Lejupielādē failus no GitHub..."
    );

    setButtonText(
        "Lejupielādē failus..."
    );


    let downloadedCount = 0;


    for (
        let i = 0;
        i < filesToUpload.length;
        i++
    ) {

        const file =
            filesToUpload[i];


        if (!file.path) {
            continue;
        }


        try {

            /*
             * Vispirms mēģinām main branch.
             */

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
                        signal:
                            controller.signal
                    }
                );


            clearTimeout(timeoutId);


            if (response.ok) {

                file.content =
                    await response.text();

                downloadedCount++;

                continue;
            }


            /*
             * Ja main nav pieejams,
             * mēģinām master.
             */

            const masterUrl =
                `https://raw.githubusercontent.com/${repo}/master/${file.path}`;


            const masterController =
                new AbortController();


            const masterTimeoutId =
                setTimeout(
                    () =>
                        masterController.abort(),
                    10000
                );


            const masterResponse =
                await fetch(
                    masterUrl,
                    {
                        signal:
                            masterController.signal
                    }
                );


            clearTimeout(masterTimeoutId);


            if (
                masterResponse.ok
            ) {

                file.content =
                    await masterResponse.text();

                downloadedCount++;
            }

        } catch (error) {

            console.warn(
                `Neizdevās lejupielādēt ${file.path}:`,
                error
            );
        }
    }


    const filesWithContent =
        filesToUpload.filter(
            (file) =>
                file.content !== undefined &&
                file.content !== null
        );


    if (
        filesWithContent.length === 0
    ) {

        throw new Error(
            "Neizdevās lejupielādēt nevienu repozitorija failu."
        );
    }


    console.log(
        `Lejupielādēti ${downloadedCount}/${filesToUpload.length} faili.`
    );


    return filesWithContent;
}


// ============================================================
// TURBO KREDĪTU APRĒĶINS
// ============================================================

async function calculateBackupCost(
    filesWithContent
) {

    setStatus(
        "3/7: Aprēķina Turbo izmaksas..."
    );

    setButtonText(
        "Aprēķina izmaksas..."
    );


    const encoder =
        new TextEncoder();


    /*
     * Aprēķinām faktiskos failu baitus.
     */

    let totalBytes = 0;


    for (
        const file of filesWithContent
    ) {

        const bytes =
            encoder.encode(
                String(file.content)
            );

        totalBytes +=
            bytes.length;
    }


    /*
     * Manifesta aptuvenais izmērs.
     *
     * Mēs vēlāk ģenerēsim manifestu,
     * tāpēc pievienojam rezervi.
     */

    const estimatedManifestBytes =
        Math.max(
            4096,
            filesWithContent.length * 160
        );


    /*
     * Turbo par katru DataItem ir arī
     * paraksta/metadatu overhead.
     *
     * Pievienojam drošu rezervi.
     */

    const estimatedTotalBytes =
        totalBytes +
        estimatedManifestBytes +
        (
            filesWithContent.length *
            2048
        );


    console.log(
        "Turbo estimated bytes:",
        estimatedTotalBytes
    );


    /*
     * getUploadCosts sagaida:
     *
     * bytes: [number]
     *
     * nevis:
     *
     * bytes: number
     */

    const costs =
        await turbo.getUploadCosts({

            bytes: [
                estimatedTotalBytes
            ]

        });


    if (
        !Array.isArray(costs) ||
        costs.length === 0
    ) {

        throw new Error(
            "Turbo neatgrieza augšupielādes izmaksas."
        );
    }


    const cost =
        costs[0];


    if (!cost || !cost.winc) {

        throw new Error(
            "Turbo izmaksu atbilde nav derīga."
        );
    }


    console.log(
        "Estimated Turbo credits:",
        cost.winc
    );


    /*
     * Noskaidrojam cenu tieši izvēlētajā
     * maksājuma tokenā.
     *
     * Tas dod token cenu, ko var izmantot
     * topUpWithTokens().
     */

    const tokenPrice =
        await turbo.getTokenPriceForBytes({

            byteCount:
                estimatedTotalBytes

        });


    if (
        !tokenPrice ||
        tokenPrice.tokenPrice === undefined
    ) {

        throw new Error(
            "Turbo neatgrieza tokena cenu."
        );
    }


    let tokenAmount =
        tokenPrice.tokenPrice;


    /*
     * Dažādās SDK versijās vērtība var būt
     * string vai BigNumber tipa objekts.
     *
     * Normalizējam uz string.
     */

    tokenAmount =
        String(tokenAmount);


    /*
     * Drošības rezerve.
     *
     * Turbo dokumentācija on-demand plūsmai
     * izmanto 1.1 buffer.
     *
     * Šeit top-up gadījumā izmantojam
     * 20% rezervi, jo mēs maksājam vienu
     * reizi par visu backupu.
     */

    const rawTokenAmount =
        BigInt(tokenAmount);


    const bufferedTokenAmount =
        (
            rawTokenAmount * 120n
        ) / 100n;


    console.log(
        "Turbo token price:",
        tokenAmount
    );

    console.log(
        "Turbo token amount with buffer:",
        bufferedTokenAmount.toString()
    );


    return {

        totalBytes:
            estimatedTotalBytes,

        uploadWinc:
            String(cost.winc),

        tokenAmount:
            bufferedTokenAmount.toString()

    };
}


// ============================================================
// TURBO TOP-UP — TIEŠI AR METAMASK
// ============================================================

async function payForBackup(
    tokenAmount
) {

    setStatus(
        "4/7: Apstiprini Turbo maksājumu MetaMask..."
    );

    setButtonText(
        "Apstiprini maksājumu MetaMask..."
    );


    /*
     * ŠEIT notiek reālais maksājums.
     *
     * turbo.topUpWithTokens()
     *
     * izmanto InjectedEthereumSigner,
     * kas izmanto MetaMask.
     *
     * Servera private key nav.
     */

    const result =
        await turbo.topUpWithTokens({

            tokenAmount:
                tokenAmount

        });


    console.log(
        "Turbo top-up result:",
        result
    );


    if (
        !result ||
        !result.id
    ) {

        throw new Error(
            "Turbo maksājums neatgrieza transakcijas ID."
        );
    }


    setStatus(
        "Turbo maksājums apstiprināts. Gaidām kredītu..."
    );


    setButtonText(
        "Gaida Turbo kredītus..."
    );


    /*
     * topUpWithTokens atgriež rezultātu,
     * bet kredītu balanss var kļūt pieejams
     * pēc blockchain/payment service
     * apstiprināšanas.
     *
     * Pārbaudām balance vairākas reizes.
     */

    const maxAttempts = 30;

    for (
        let attempt = 0;
        attempt < maxAttempts;
        attempt++
    ) {

        try {

            const balance =
                await turbo.getBalance();


            console.log(
                "Turbo balance:",
                balance
            );


            if (
                balance &&
                balance.winc
            ) {

                return {
                    ...result,
                    balance
                };
            }

        } catch (balanceError) {

            console.warn(
                "Turbo balance check failed:",
                balanceError
            );
        }


        await new Promise(
            (resolve) =>
                setTimeout(
                    resolve,
                    3000
                )
        );
    }


    /*
     * Pat ja balance polling beidzās,
     * maksājuma transakcija ir izveidota.
     *
     * Turpinām tikai tad, ja Turbo jau
     * ir atgriezis funding rezultātu.
     */

    return result;
}


// ============================================================
// FAILU AUGŠUPIELĀDE
// ============================================================

async function uploadFilesToTurbo(
    repo,
    filesWithContent
) {

    setStatus(
        "5/7: Augšupielādē failus Arweave..."
    );

    setButtonText(
        "Augšupielādē failus..."
    );


    const encoder =
        new TextEncoder();


    const paths = {};


    for (
        let i = 0;
        i < filesWithContent.length;
        i++
    ) {

        const file =
            filesWithContent[i];


        setStatus(
            `5/7: Augšupielādē failu ${i + 1}/${filesWithContent.length}: ${file.path}`
        );


        const fileData =
            encoder.encode(
                String(file.content)
            );


        const blob =
            new Blob([
                fileData
            ], {
                type:
                    "text/plain"
            });


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
                                "App-Name",

                            value:
                                "PermRepo"
                        },

                        {
                            name:
                                "Repo",

                            value:
                                repo
                        },

                        {
                            name:
                                "File-Path",

                            value:
                                file.path
                        },

                        {
                            name:
                                "Content-Type",

                            value:
                                "text/plain"
                        },

                        {
                            name:
                                "Unix-Time",

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


        if (
            !result ||
            !result.id
        ) {

            throw new Error(
                `Turbo neatgrieza ID failam ${file.path}.`
            );
        }


        paths[file.path] = {

            id:
                result.id

        };


        file.txId =
            result.id;


        console.log(
            `Uploaded ${file.path}:`,
            result.id
        );
    }


    return paths;
}


// ============================================================
// MANIFESTA IZVEIDE UN AUGŠUPIELĀDE
// ============================================================

async function uploadManifest(
    repo,
    paths
) {

    setStatus(
        "6/7: Izveido un augšupielādē manifestu..."
    );

    setButtonText(
        "Augšupielādē manifestu..."
    );


    const pathNames =
        Object.keys(paths);


    if (
        pathNames.length === 0
    ) {

        throw new Error(
            "Nav neviena augšupielādēta faila manifesta izveidei."
        );
    }


    const indexPath =
        paths["README.md"]
            ? "README.md"
            : pathNames[0];


    const manifest = {

        manifest:
            "arweave/paths",

        version:
            "0.2.0",

        index: {

            path:
                indexPath

        },

        paths,

        metadata: {

            repo,

            timestamp:
                new Date().toISOString(),

            generatedBy:
                "PermRepo v1.0.0"

        }

    };


    const encoder =
        new TextEncoder();


    const manifestJSON =
        JSON.stringify(
            manifest
        );


    const manifestData =
        encoder.encode(
            manifestJSON
        );


    const manifestBlob =
        new Blob(
            [manifestData],
            {
                type:
                    "application/json"
            }
        );


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
                            "App-Name",

                        value:
                            "PermRepo"
                    },

                    {
                        name:
                            "Type",

                        value:
                            "path-manifest"
                    },

                    {
                        name:
                            "Repo",

                        value:
                            repo
                    },

                    {
                        name:
                            "Content-Type",

                        value:
                            "application/x.arweave-manifest+json"
                    },

                    {
                        name:
                            "Unix-Time",

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


    if (
        !manifestResult ||
        !manifestResult.id
    ) {

        throw new Error(
            "Manifesta augšupielāde neizdevās."
        );
    }


    console.log(
        "Manifest transaction:",
        manifestResult.id
    );


    return {

        manifest,

        manifestTxId:
            manifestResult.id

    };
}


// ============================================================
// BLOCKCHAIN — ADD BACKUP
// ============================================================

async function registerBackupOnBlockchain(
    repo,
    manifestTxId
) {

    setStatus(
        "7/7: Apstiprini backup ierakstu MetaMask..."
    );

    setButtonText(
        "Apstiprini blockchain ierakstu..."
    );


    if (!provider || !metamaskSigner) {

        throw new Error(
            "MetaMask signer nav inicializēts."
        );
    }


    /*
     * Hash funkcija precīzi atbilst Solidity:
     *
     * keccak256(abi.encode(repository))
     *
     * Tāpēc izmantojam AbiCoder.encode()
     * un nevis ethers.solidityPacked().
     */

    const repoHash =
        ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["string"],
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
        tokenId === 0n
    ) {

        throw new Error(
            `Repo ${repo} vēl nav piesaistīts PermRepo NFT. Vispirms jāizveido NFT šim repozitorijam.`
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


    const nextBackupNumber =
        backupNumber + 1n;


    const deadline =
        BigInt(
            Math.floor(
                Date.now() / 1000
            ) + 3600
        );


    /*
     * Šeit izmantojam manifest transaction ID
     * kā deterministisku hash avotu.
     */

    const manifestHash =
        ethers.id(
            manifestTxId
        );


    const merkleRoot =
        ethers.id(
            manifestTxId
        );


    /*
     * EIP-712 domain
     *
     * Solidity:
     *
     * EIP712("PermRepo", "1")
     */

    const domain = {

        name:
            "PermRepo",

        version:
            "1",

        chainId:
            CHAIN_ID_DECIMAL,

        verifyingContract:
            NFT_ADDRESS

    };


    /*
     * Solidity ADD_BACKUP_TYPEHASH:
     *
     * AddBackup(
     *   uint256 tokenId,
     *   uint256 backupNumber,
     *   bytes32 manifestHash,
     *   bytes32 merkleRoot,
     *   uint256 deadline,
     *   uint256 nonce
     * )
     */

    const types = {

        AddBackup: [

            {
                name:
                    "tokenId",

                type:
                    "uint256"
            },

            {
                name:
                    "backupNumber",

                type:
                    "uint256"
            },

            {
                name:
                    "manifestHash",

                type:
                    "bytes32"
            },

            {
                name:
                    "merkleRoot",

                type:
                    "bytes32"
            },

            {
                name:
                    "deadline",

                type:
                    "uint256"
            },

            {
                name:
                    "nonce",

                type:
                    "uint256"
            }

        ]

    };


    const value = {

        tokenId:
            tokenId.toString(),

        backupNumber:
            nextBackupNumber.toString(),

        manifestHash,

        merkleRoot,

        deadline:
            deadline.toString(),

        nonce:
            nonce.toString()

    };


    console.log(
        "EIP-712 domain:",
        domain
    );

    console.log(
        "EIP-712 value:",
        value
    );


    /*
     * MetaMask paraksta EIP-712.
     *
     * Tas NAV Turbo paraksts.
     *
     * Tas ir atsevišķs PermRepo blockchain
     * ieraksta paraksts.
     */

    const addBackupSignature =
        await metamaskSigner.signTypedData(
            domain,
            types,
            value
        );


    setStatus(
        "Nosūta PermRepo backup ierakstu blockchain..."
    );

    setButtonText(
        "Nosūta blockchain transakciju..."
    );


    const nftWriteContract =
        new ethers.Contract(
            NFT_ADDRESS,
            NFT_ABI,
            metamaskSigner
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
        "PermRepo backup transaction:",
        tx.hash
    );


    await tx.wait();


    console.log(
        "PermRepo backup transaction confirmed:",
        tx.hash
    );


    return {

        tokenId,

        backupNumber:
            nextBackupNumber,

        manifestHash,

        merkleRoot,

        deadline,

        nonce,

        signature:
            addBackupSignature,

        transactionHash:
            tx.hash

    };
}


// ============================================================
// GITHUB ISSUE ATSKAITE
// ============================================================

async function createGitHubIssue(
    repo,
    filesWithContent,
    manifestTxId,
    blockchainResult
) {

    setStatus(
        "Izveido GitHub atskaiti..."
    );

    setButtonText(
        "Izveido GitHub atskaiti..."
    );


    const timestamp =
        Math.floor(
            Date.now() / 1000
        );


    const uploadedFiles =
        filesWithContent.map(
            (file) => ({

                path:
                    file.path,

                txId:
                    file.txId,

                size:
                    file.size

            })
        );


    const messageLines = [

        "PermRepo Backup Authorization",

        `Repository: ${repo}`,

        `Timestamp: ${timestamp}`,

        `Address: ${userAddress}`,

        `UploadedFiles: ${uploadedFiles.length}`,

        `ManifestTxId: ${manifestTxId}`,

        `NFTAddress: ${NFT_ADDRESS}`,

        `TokenId: ${blockchainResult.tokenId.toString()}`,

        `BackupNumber: ${blockchainResult.backupNumber.toString()}`,

        `BlockchainTransaction: ${blockchainResult.transactionHash}`

    ];


    const message =
        messageLines.join("\n");


    /*
     * Šis ir lietotāja paraksts GitHub atskaitei.
     *
     * Tas nav Turbo signer paraksts.
     */

    const signature =
        await metamaskSigner.signMessage(
            message
        );


    const payload = {

        address:
            userAddress,

        signature,

        message,

        timestamp,

        repository:
            repo,

        uploadedFiles,

        manifestTxId,

        nftAddress:
            NFT_ADDRESS,

        tokenId:
            blockchainResult.tokenId.toString(),

        backupNumber:
            blockchainResult.backupNumber.toString(),

        blockchainTransaction:
            blockchainResult.transactionHash

    };


    const jsonBody =
        JSON.stringify(
            payload,
            null,
            2
        );


    const body =
        "```json\n" +
        jsonBody +
        "\n```";


    const issueTitle =
        `[PermRepo Backup] ${userAddress.substring(0, 10)}...`;


    const issueUrl =
        `https://github.com/${repo}/issues/new` +
        `?title=${encodeURIComponent(issueTitle)}` +
        `&body=${encodeURIComponent(body)}`;


    return issueUrl;
}


// ============================================================
// GALVENĀ BACKUP FUNKCIJA
// ============================================================

async function signAndUpload() {

    showError("");

    setButtonDisabled(true);


    try {

        // ------------------------------------------------------
        // 1. REPO
        // ------------------------------------------------------

        const repoInput =
            document.getElementById(
                "repoInput"
            );


        const repo =
            normalizeRepository(
                repoInput.value
            );


        if (
            filesToUpload.length === 0
        ) {

            throw new Error(
                "Nav norādīts neviens fails augšupielādei."
            );
        }


        // ------------------------------------------------------
        // 2. META MASK
        // ------------------------------------------------------

        setStatus(
            "2/7: Savienojas ar MetaMask..."
        );

        setButtonText(
            "Savienojas ar MetaMask..."
        );


        await connectMetaMask();


        // ------------------------------------------------------
        // 3. LEJUPIELĀDE
        // ------------------------------------------------------

        const filesWithContent =
            await downloadRepositoryFiles(
                repo
            );


        // ------------------------------------------------------
        // 4. TURBO
        // ------------------------------------------------------

        setStatus(
            "3/7: Inicializē Turbo..."
        );

        setButtonText(
            "Inicializē Turbo..."
        );


        await initializeTurbo();


        // ------------------------------------------------------
        // 5. CENA + MAKSĀJUMS
        // ------------------------------------------------------

        const cost =
            await calculateBackupCost(
                filesWithContent
            );


        console.log(
            "Backup cost:",
            cost
        );


        /*
         * Šis ir VIENS Turbo top-up maksājums
         * par šo backup.
         *
         * MetaMask atvērsies.
         *
         * Servera private key nav.
         */

        await payForBackup(
            cost.tokenAmount
        );


        // ------------------------------------------------------
        // 6. FAILI
        // ------------------------------------------------------

        const paths =
            await uploadFilesToTurbo(
                repo,
                filesWithContent
            );


        // ------------------------------------------------------
        // 7. MANIFESTS
        // ------------------------------------------------------

        const manifestResult =
            await uploadManifest(
                repo,
                paths
            );


        const manifestTxId =
            manifestResult.manifestTxId;


        // ------------------------------------------------------
        // 8. BLOCKCHAIN
        // ------------------------------------------------------

        const blockchainResult =
            await registerBackupOnBlockchain(
                repo,
                manifestTxId
            );


        // ------------------------------------------------------
        // 9. GITHUB ISSUE
        // ------------------------------------------------------

        const issueUrl =
            await createGitHubIssue(
                repo,
                filesWithContent,
                manifestTxId,
                blockchainResult
            );


        // ------------------------------------------------------
        // 10. PABEIGTS
        // ------------------------------------------------------

        setStatus(
            "Backup veiksmīgi pabeigts!"
        );

        setButtonText(
            "✓ Backup pabeigts"
        );


        console.log(
            "PermRepo backup completed:",
            {
                repository:
                    repo,

                manifestTxId,

                tokenId:
                    blockchainResult.tokenId.toString(),

                backupNumber:
                    blockchainResult.backupNumber.toString(),

                blockchainTransaction:
                    blockchainResult.transactionHash,

                issueUrl

            }
        );


        /*
         * Pēc īsas pauzes aizvedam lietotāju
         * uz GitHub Issue.
         */

        setTimeout(
            () => {

                window.location.href =
                    issueUrl;

            },
            1500
        );

    } catch (error) {

        console.error(
            "PermRepo backup error:",
            error
        );


        let message =
            error?.message ||
            "Nezināma kļūda.";


        /*
         * MetaMask lietotāja atcelšana.
         */

        if (
            error?.code ===
            "ACTION_REJECTED"
        ) {

            message =
                "MetaMask transakcija vai paraksts tika atcelts.";

        } else if (
            error?.code ===
            4001
        ) {

            message =
                "MetaMask pieprasījums tika atcelts.";

        }


        showError(
            "Kļūda: " + message
        );


        setStatus(
            "Backup neizdevās."
        );


        setButtonText(
            "Mēģināt vēlreiz"
        );


        setButtonDisabled(false);
    }
}


// ============================================================
// SĀKOTNĒJĀ INICIALIZĀCIJA
// ============================================================

async function init() {

    try {

        // ------------------------------------------------------
        // Repo
        // ------------------------------------------------------

        const repoInput =
            document.getElementById(
                "repoInput"
            );


        if (repoInput) {

            repoInput.value =
                repoFromUrl;

        }


        // ------------------------------------------------------
        // Timestamp
        // ------------------------------------------------------

        const timestampElement =
            document.getElementById(
                "timestamp"
            );


        if (timestampElement) {

            timestampElement.textContent =
                new Date().toLocaleString(
                    "lv-LV"
                );

        }


        // ------------------------------------------------------
        // Faili
        // ------------------------------------------------------

        loadFilesFromURL();

        updateFileInformation();


        // ------------------------------------------------------
        // MetaMask
        // ------------------------------------------------------

        if (!window.ethereum) {

            showError(
                "Lūdzu, instalē MetaMask vai citu EVM Web3 maku."
            );

            setStatus(
                "MetaMask nav atrasts."
            );

            return;
        }


        // ------------------------------------------------------
        // Tīkla pārbaude
        // ------------------------------------------------------

        setStatus(
            "Pārbauda MetaMask tīklu..."
        );


        const currentChainId =
            await window.ethereum.request({

                method:
                    "eth_chainId"

            });


        if (
            currentChainId.toLowerCase() !==
            CHAIN_ID.toLowerCase()
        ) {

            try {

                await window.ethereum.request({

                    method:
                        "wallet_switchEthereumChain",

                    params: [

                        {
                            chainId:
                                CHAIN_ID
                        }

                    ]

                });

            } catch (error) {

                console.error(
                    "Network switch failed:",
                    error
                );

                showError(
                    "Lūdzu, pārslēdz MetaMask uz Base Sepolia."
                );

                setStatus(
                    "Nepareizs tīkls."
                );

                return;
            }
        }


        // ------------------------------------------------------
        // Poga
        // ------------------------------------------------------

        const button =
            document.getElementById(
                "payButton"
            );


        if (!button) {

            throw new Error(
                "payButton elements nav atrasts."
            );
        }


        button.disabled =
            false;


        button.textContent =
            "💳 Maksāt ar MetaMask un augšupielādēt";


        button.onclick =
            signAndUpload;


        setStatus(
            "Gatavs backup izveidei."
        );


    } catch (error) {

        console.error(
            "PermRepo initialization error:",
            error
        );


        showError(
            "Inicializācijas kļūda: " +
            (
                error?.message ||
                "Nezināma kļūda."
            )
        );


        setStatus(
            "Inicializācija neizdevās."
        );
    }
}


// ============================================================
// METAMASK EVENTI
// ============================================================

if (window.ethereum) {

    window.ethereum.on?.(
        "accountsChanged",
        (
            accounts
        ) => {

            if (
                !accounts ||
                accounts.length === 0
            ) {

                userAddress =
                    null;

                const walletRow =
                    document.getElementById(
                        "walletRow"
                    );

                if (walletRow) {
                    walletRow.style.display =
                        "none";
                }

                setStatus(
                    "MetaMask konts atvienots."
                );

                return;
            }


            userAddress =
                accounts[0];


            const walletAddress =
                document.getElementById(
                    "walletAddress"
                );


            if (walletAddress) {

                walletAddress.textContent =
                    formatAddress(
                        userAddress
                    );

            }

        }
    );


    window.ethereum.on?.(
        "chainChanged",
        () => {

            /*
             * Pēc tīkla maiņas ethers provider
             * var būt jāizveido no jauna.
             */

            provider =
                null;

            metamaskSigner =
                null;

            turboSigner =
                null;

            turbo =
                null;


            setStatus(
                "Tīkls mainīts. Lūdzu, turpini ar pareizo tīklu."
            );

        }
    );

}


// ============================================================
// START
// ============================================================

init();
